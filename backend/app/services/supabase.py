import logging
from urllib.parse import quote

import httpx
from fastapi import HTTPException

from ..config import settings


logger = logging.getLogger(__name__)


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
