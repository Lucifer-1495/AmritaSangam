import hashlib
from datetime import datetime, timezone

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Request, Response

from ..database import serialize_document
from ..auth import (
    SESSION_COOKIE,
    clear_auth_cookies,
    create_club_session,
    create_mongo_session,
    current_profile,
    profile_for_auth_user,
    revoke_club_sessions,
    supabase_request,
)
from ..services.common import (
    as_oid,
    club_mentor_ids,
    collection,
    verify_shared_password,
)


router = APIRouter()


def _auth_error(response):
    try:
        result = response.json()
    except ValueError:
        result = {}
    detail = (
        result.get("msg")
        or result.get("message")
        or result.get("error_description")
        or result.get("error")
        or "Supabase could not complete the authentication request."
    )
    return HTTPException(status_code=response.status_code, detail=detail)


@router.post("/auth/login")
def login(request: Request, body: dict, response: Response):
    email = str(body.get("email", "")).strip().lower()
    password = body.get("password")
    if not email or not isinstance(password, str) or not password:
        raise HTTPException(status_code=400, detail="Enter your email and password.")
    result = supabase_request(
        "POST",
        "/auth/v1/token?grant_type=password",
        json={"email": email, "password": password},
    )
    if not result.is_success:
        raise _auth_error(result)
    session = result.json()
    user = session.get("user") or {}
    if not user.get("id") or not user.get("email"):
        raise HTTPException(status_code=502, detail="Supabase returned an incomplete user identity.")
    club_credential = request.app.state.db["clubcredentials"].find_one({"supabaseId": user["id"]})
    if club_credential:
        _finish_club_login(request, response, club_credential, user["email"])
        return {"user": {"id": user["id"], "email": user["email"]}}
    profile = profile_for_auth_user(request.app.state.db, user)
    create_mongo_session(request.app.state.db, profile, response)
    return {"user": {"id": user["id"], "email": user["email"]}}


@router.post("/auth/club-login")
def club_login(request: Request, body: dict, response: Response):
    email = str(body.get("email", "")).strip().lower()
    password = body.get("password")
    if not email or not isinstance(password, str) or not password or len(password) > 256:
        raise HTTPException(status_code=400, detail="Enter the club email and password.")
    db = request.app.state.db
    credential = collection(db, "club_credentials").find_one({"email": email})
    if not credential:
        raise HTTPException(status_code=401, detail="The user ID or password is wrong.")
    if credential.get("supabaseId"):
        result = supabase_request(
            "POST",
            "/auth/v1/token?grant_type=password",
            json={"email": email, "password": password},
        )
        if not result.is_success:
            raise _auth_error(result)
        user = (result.json() or {}).get("user") or {}
        if user.get("id") != credential["supabaseId"]:
            raise HTTPException(status_code=401, detail="The user ID or password is wrong.")
        _finish_club_login(request, response, credential, email)
        return {"user": {"id": user["id"], "email": email}}
    if not verify_shared_password(password, credential.get("passwordHash")):
        raise HTTPException(status_code=401, detail="The password is wrong.")
    _finish_club_login(request, response, credential, email)
    return {"user": {"id": f"club-account:{credential['clubId']}", "email": email}}


def _finish_club_login(request, response, credential, email):
    db = request.app.state.db
    club_id = credential["clubId"]
    club = collection(db, "clubs").find_one({"_id": club_id}, {"name": 1, "mentor": 1, "mentorIds": 1})
    if club is None:
        raise HTTPException(status_code=401, detail="The club account is no longer active.")
    recipient_ids = {
        str(member["profileId"])
        for member in collection(db, "members").find({
            "clubId": club_id,
            "membershipStatus": "active",
            "$or": [
                {"position": {"$in": ["office_bearer", "president", "vice_president", "treasurer", "secretary"]}},
                {"position": "executive", "officeBearerGroup": True},
            ],
        }, {"profileId": 1})
    }
    recipient_ids.update(str(identity) for identity in club_mentor_ids(club))
    notification_time = datetime.now(timezone.utc)
    notifications = collection(db, "notifications")
    for recipient in recipient_ids:
        notifications.insert_one({
            "recipientId": ObjectId(recipient),
            "clubId": club_id,
            "clubName": (club or {}).get("name", "Club"),
            "type": "club_ob_login",
            "actorName": f"{(club or {}).get('name', 'Club')} shared account",
            "message": "The shared club account was used. The person using the shared credentials is not individually identified.",
            "eventAt": notification_time,
            "createdAt": notification_time,
            "readAt": None,
        })
    create_club_session(db, club_id, response)


@router.get("/notifications")
def list_notifications(request: Request, profile=Depends(current_profile)):
    records = list(collection(request.app.state.db, "notifications").find(
        {"recipientId": as_oid(profile["_id"])}
    ).sort("createdAt", -1).limit(50))
    return [serialize_document(record) for record in records]


@router.patch("/notifications/{identity}/read")
def mark_notification_read(request: Request, identity: str, profile=Depends(current_profile)):
    result = collection(request.app.state.db, "notifications").update_one(
        {"_id": as_oid(identity), "recipientId": as_oid(profile["_id"])},
        {"$set": {"readAt": datetime.now(timezone.utc)}},
    )
    if not result.matched_count:
        raise HTTPException(status_code=404, detail="Notification not found.")
    return {"message": "Notification marked as read."}


@router.get("/auth/session")
def get_session(profile=Depends(current_profile)):
    return {"user": {"id": profile.get("supabaseId"), "email": profile.get("email")}}


@router.post("/auth/logout")
def logout(request: Request, response: Response):
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        request.app.state.db["auth_sessions"].delete_one({
            "tokenHash": hashlib.sha256(token.encode("utf-8")).hexdigest()
        })
    clear_auth_cookies(response)
    return {"message": "Signed out."}


@router.post("/auth/password")
def change_password(request: Request, body: dict, profile=Depends(current_profile)):
    if profile.get("isClubAccount"):
        raise HTTPException(status_code=403, detail="Club account passwords can only be changed through the approved ICTS process.")
    current_password = body.get("currentPassword")
    new_password = body.get("newPassword")
    if not isinstance(current_password, str) or not isinstance(new_password, str):
        raise HTTPException(status_code=400, detail="Enter your current and new passwords.")
    if len(new_password) < 8:
        raise HTTPException(status_code=400, detail="New password must be at least 8 characters.")
    if new_password == current_password:
        raise HTTPException(status_code=400, detail="Choose a password different from the current one.")

    verified = supabase_request(
        "POST",
        "/auth/v1/token?grant_type=password",
        json={"email": profile["email"], "password": current_password},
    )
    if not verified.is_success:
        if verified.status_code in (400, 401, 403):
            raise HTTPException(status_code=400, detail="Your current password is not correct.")
        raise HTTPException(status_code=502, detail="Supabase could not verify the current password.")
    session = verified.json()
    access_token = session.get("access_token")
    if not access_token:
        raise HTTPException(status_code=502, detail="Supabase returned an incomplete password verification.")

    updated = supabase_request(
        "PUT",
        "/auth/v1/user",
        headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"},
        json={"password": new_password},
    )
    if not updated.is_success:
        raise _auth_error(updated)

    token = request.cookies.get(SESSION_COOKIE)
    session_filter = {"profileId": ObjectId(profile["_id"])}
    if token:
        session_filter["tokenHash"] = {"$ne": hashlib.sha256(token.encode("utf-8")).hexdigest()}
    request.app.state.db["auth_sessions"].delete_many(session_filter)
    return {"message": "Password updated."}


@router.post("/auth/password-reset/request")
def request_password_reset(body: dict):
    email = str(body.get("email", "")).strip().lower()
    if not email or "@" not in email or len(email) > 254:
        raise HTTPException(status_code=400, detail="Enter the email address for your account.")
    result = supabase_request(
        "POST",
        "/auth/v1/recover",
        json={"email": email},
    )
    if not result.is_success:
        if result.status_code == 429:
            raise HTTPException(status_code=429, detail="Too many reset requests. Wait a while and try again.")
        if result.status_code not in (400, 404):
            raise HTTPException(status_code=502, detail=f"Supabase could not send the reset email (status {result.status_code}).")
    return {"message": "If an account exists for that email, a password reset code has been sent."}


@router.post("/auth/password-reset/confirm")
def confirm_password_reset(request: Request, body: dict):
    email = str(body.get("email", "")).strip().lower()
    token = body.get("otp")
    password = body.get("password")
    if not email or "@" not in email or len(email) > 254:
        raise HTTPException(status_code=400, detail="Enter the email address for your account.")
    if not isinstance(token, str) or not token.isdigit() or not 6 <= len(token) <= 12:
        raise HTTPException(status_code=400, detail="Enter the reset code from your email.")
    if not isinstance(password, str) or len(password) < 8:
        raise HTTPException(status_code=400, detail="Your new password must be at least 8 characters.")

    verified = supabase_request(
        "POST",
        "/auth/v1/verify",
        json={"email": email, "token": token, "type": "recovery"},
    )
    if not verified.is_success:
        if verified.status_code == 429:
            raise HTTPException(status_code=429, detail="Too many verification attempts. Request a new code later.")
        if verified.status_code in (400, 401, 404):
            raise HTTPException(status_code=400, detail="That reset code is invalid or expired. Request a new code and try again.")
        raise HTTPException(status_code=502, detail=f"Supabase could not verify the reset code (status {verified.status_code}).")
    access_token = verified.json().get("access_token")
    if not access_token:
        raise HTTPException(status_code=502, detail="Supabase returned an incomplete reset verification.")

    updated = supabase_request(
        "PUT",
        "/auth/v1/user",
        headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"},
        json={"password": password},
    )
    if not updated.is_success:
        raise _auth_error(updated)

    profile = request.app.state.db["profiles"].find_one({"email": email}, {"_id": 1})
    if profile:
        request.app.state.db["auth_sessions"].delete_many({"profileId": profile["_id"]})
    return {"message": "Password reset complete. Sign in with your new password."}
