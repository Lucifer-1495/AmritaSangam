import hashlib

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Request, Response

from ..auth import (
    SESSION_COOKIE,
    clear_auth_cookies,
    create_mongo_session,
    current_profile,
    profile_for_auth_user,
    supabase_request,
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
    profile = profile_for_auth_user(request.app.state.db, user)
    create_mongo_session(request.app.state.db, profile, response)
    return {"user": {"id": user["id"], "email": user["email"]}}


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
