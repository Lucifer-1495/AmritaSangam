import logging
import base64
import hashlib
from urllib.parse import quote

import httpx
from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException

from ..config import settings


logger = logging.getLogger(__name__)


def _credential_cipher():
    key = settings.supabase_service_role_key
    if not key:
        raise HTTPException(
            status_code=503,
            detail="Supabase account provisioning is not configured. Add SUPABASE_SERVICE_ROLE_KEY to backend/.env.",
        )
    # Derive a stable server-only encryption key without adding another deployment secret.
    derived_key = base64.urlsafe_b64encode(hashlib.sha256(key.encode("utf-8")).digest())
    return Fernet(derived_key)


def encrypt_pending_password(password):
    return _credential_cipher().encrypt(password.encode("utf-8")).decode("ascii")


def decrypt_pending_password(ciphertext):
    try:
        return _credential_cipher().decrypt(ciphertext.encode("ascii")).decode("utf-8")
    except (InvalidToken, TypeError, ValueError) as error:
        raise HTTPException(
            status_code=409,
            detail="This pending password cannot be decrypted. Submit a new credential change request.",
        ) from error


def _service_headers(extra=None):
    key = settings.supabase_service_role_key
    if not settings.supabase_url or not key:
        raise HTTPException(
            status_code=503,
            detail="Account provisioning is not configured. Add SUPABASE_SERVICE_ROLE_KEY to backend/.env.",
        )
    headers = {"apikey": key, **(extra or {})}
    if key.startswith("eyJ"):
        headers["Authorization"] = f"Bearer {key}"
    return headers


def create_supabase_user(email, password, name):
    try:
        response = httpx.post(
            f"{settings.supabase_url}/auth/v1/admin/users",
            headers=_service_headers({"Content-Type": "application/json"}),
            json={"email": email, "password": password, "email_confirm": True, "user_metadata": {"full_name": name}},
            timeout=15,
        )
    except httpx.HTTPError as error:
        raise HTTPException(status_code=502, detail=f"Could not reach Supabase Auth ({type(error).__name__}).") from error
    result = response.json() if response.content else {}
    if not response.is_success:
        status = 409 if response.status_code in (409, 422) else 400
        raise HTTPException(
            status_code=status,
            detail=result.get("msg") or result.get("message") or result.get("error_description") or "Supabase could not create this account.",
        )
    if not result.get("id") or not result.get("email"):
        raise HTTPException(status_code=502, detail="Supabase created no valid user identity.")
    return result


def update_supabase_user(user_id, updates):
    try:
        response = httpx.patch(
            f"{settings.supabase_url}/auth/v1/admin/users/{quote(user_id, safe='')}",
            headers=_service_headers({"Content-Type": "application/json"}),
            json=updates,
            timeout=15,
        )
    except httpx.HTTPError as error:
        raise HTTPException(status_code=502, detail=f"Could not reach Supabase Auth ({type(error).__name__}).") from error
    result = response.json() if response.content else {}
    if not response.is_success:
        status = 409 if response.status_code in (409, 422) else 400
        raise HTTPException(
            status_code=status,
            detail=result.get("msg") or result.get("message") or result.get("error_description") or "Supabase could not update this account.",
        )
    if not result.get("id"):
        raise HTTPException(status_code=502, detail="Supabase returned no valid account identity.")
    return result


def delete_supabase_user(user_id):
    try:
        response = httpx.delete(
            f"{settings.supabase_url}/auth/v1/admin/users/{quote(user_id, safe='')}",
            headers=_service_headers(),
            timeout=15,
        )
    except httpx.HTTPError as error:
        raise HTTPException(status_code=502, detail=f"Could not reach Supabase Auth ({type(error).__name__}).") from error
    if response.status_code not in (200, 204, 404):
        raise HTTPException(status_code=502, detail=f"Supabase could not delete this login (status {response.status_code}).")
