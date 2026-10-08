import base64
import binascii
import re

from fastapi import HTTPException


_IMAGE_SIGNATURES = {
    "image/png": lambda data: data.startswith(b"\x89PNG\r\n\x1a\n"),
    "image/jpeg": lambda data: data.startswith(b"\xff\xd8\xff"),
    "image/webp": lambda data: data.startswith(b"RIFF") and data[8:12] == b"WEBP",
}
_DATA_URL = re.compile(r"data:(image/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})\Z")


def validate_image_data_url(value, label, max_bytes, allowed_types=None):
    if value in (None, ""):
        return ""
    if not isinstance(value, str):
        raise HTTPException(status_code=400, detail=f"{label} must be a PNG, JPEG or WebP image.")
    match = _DATA_URL.fullmatch(value)
    if not match:
        raise HTTPException(status_code=400, detail=f"{label} must be a PNG, JPEG or WebP image.")
    image_type, encoded = match.groups()
    if allowed_types and image_type not in allowed_types:
        raise HTTPException(status_code=400, detail=f"{label} must be a PNG image.")
    if len(encoded) > ((max_bytes + 2) // 3) * 4:
        raise HTTPException(status_code=400, detail=f"{label} is too large.")
    try:
        image_bytes = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as error:
        raise HTTPException(status_code=400, detail=f"{label} is not a valid image.") from error
    if not image_bytes or len(image_bytes) > max_bytes:
        raise HTTPException(status_code=400, detail=f"{label} is too large or empty.")
    if not _IMAGE_SIGNATURES[image_type](image_bytes):
        raise HTTPException(status_code=400, detail=f"{label} does not match its declared image type.")
    return value
