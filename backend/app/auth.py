import hashlib
import logging
import secrets
from datetime import datetime, timedelta, timezone

import httpx
from bson import ObjectId
from fastapi import Depends, HTTPException, Request, Response
from pymongo import ReturnDocument

from .config import settings
from .database import serialize_document
from .models import Role


logger = logging.getLogger(__name__)
SESSION_COOKIE = "__Host-campussphere_session"
SESSION_MAX_AGE = 60 * 60 * 24 * 30
LEGACY_AUTH_COOKIES = ("__Host-campussphere_access", "__Host-campussphere_refresh")


def _cookie_options():
    return {
        "max_age": SESSION_MAX_AGE,
        "httponly": True,
        "secure": True,
        "samesite": settings.cookie_samesite,
        "path": "/",
    }


def set_auth_cookie(response: Response, token: str):
    response.set_cookie(SESSION_COOKIE, token, **_cookie_options())
    for legacy_cookie in LEGACY_AUTH_COOKIES:
        response.delete_cookie(
            legacy_cookie,
            path="/",
            secure=True,
            httponly=True,
            samesite=settings.cookie_samesite,
        )


def clear_auth_cookies(response: Response):
    for cookie_name in (SESSION_COOKIE, *LEGACY_AUTH_COOKIES):
        response.delete_cookie(
            cookie_name,
            path="/",
            secure=True,
            httponly=True,
            samesite=settings.cookie_samesite,
        )


def create_mongo_session(database, profile: dict, response: Response) -> None:
    token = secrets.token_urlsafe(32)
    database["auth_sessions"].insert_one({
        "tokenHash": hashlib.sha256(token.encode("utf-8")).hexdigest(),
        "profileId": ObjectId(profile["_id"]),
        "supabaseId": profile["supabaseId"],
        "createdAt": datetime.now(timezone.utc),
        "expiresAt": datetime.now(timezone.utc) + timedelta(seconds=SESSION_MAX_AGE),
    })
    set_auth_cookie(response, token)


def supabase_request(method: str, path: str, **kwargs):
    if not settings.supabase_url or not settings.supabase_anon_key:
        raise HTTPException(status_code=503, detail="Supabase authentication is not configured on the server.")
    headers = {"apikey": settings.supabase_anon_key, **kwargs.pop("headers", {})}
    try:
        return httpx.request(
            method, f"{settings.supabase_url}{path}", headers=headers, timeout=10, **kwargs
        )
    except httpx.HTTPError as error:
        logger.warning("Supabase Auth request failed: %s", error)
        raise HTTPException(status_code=502, detail="Could not reach Supabase Auth.") from error


def profile_for_auth_user(database, auth_user: dict):
    email = str(auth_user.get("email", "")).lower()
    user_id = auth_user.get("id")
    if not user_id or not email:
        raise HTTPException(status_code=401, detail="The session has no valid user.")

    profiles = database["profiles"]
    is_icts = bool(settings.icts_email and email == settings.icts_email)
    name = (
        (auth_user.get("user_metadata") or {}).get("full_name")
        or (auth_user.get("user_metadata") or {}).get("name")
        or email.split("@")[0]
    )
    if is_icts and not profiles.find_one({"supabaseId": user_id}, {"_id": 1}):
        profiles.update_one(
            {"email": email},
            {"$set": {"supabaseId": user_id, "role": Role.ICTS.value}},
        )
    profile = profiles.find_one_and_update(
        {"supabaseId": user_id},
        {"$setOnInsert": {
            "name": name,
            "email": email,
            "role": Role.ICTS.value,
            "createdAt": datetime.now(timezone.utc),
            "updatedAt": datetime.now(timezone.utc),
        }},
        upsert=is_icts,
        return_document=ReturnDocument.AFTER,
    )
    if profile is None:
        raise HTTPException(
            status_code=403,
            detail="This account has not been issued by ICTS. Ask ICTS to create your my AMRITA account.",
        )
    if is_icts and profile.get("role") != Role.ICTS.value:
        profiles.update_one({"_id": profile["_id"]}, {"$set": {"role": Role.ICTS.value}})
        profile["role"] = Role.ICTS.value
    return profile


def current_profile(request: Request, response: Response):
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise HTTPException(status_code=401, detail="Sign in to continue.")
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    database = request.app.state.db
    now = datetime.now(timezone.utc)
    session = database["auth_sessions"].find_one({
        "tokenHash": token_hash,
        "expiresAt": {"$gt": now},
    })
    if session is None:
        clear_auth_cookies(response)
        raise HTTPException(status_code=401, detail="Your session has expired. Sign in again.")

    profile = database["profiles"].find_one({
        "_id": session["profileId"],
        "supabaseId": session["supabaseId"],
    })
    if profile is None:
        database["auth_sessions"].delete_one({"_id": session["_id"]})
        clear_auth_cookies(response)
        raise HTTPException(status_code=401, detail="This account is no longer active. Sign in again.")
    return serialize_document(profile)


def require_roles(*roles: str):
    def dependency(profile=Depends(current_profile)):
        if profile.get("role") not in roles:
            raise HTTPException(status_code=403, detail="You do not have permission to perform this action.")
        return profile

    return dependency


def object_id(profile: dict) -> ObjectId:
    return ObjectId(profile["_id"])
