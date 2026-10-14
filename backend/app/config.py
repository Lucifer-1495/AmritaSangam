import os
from pathlib import Path

from dotenv import load_dotenv


APP_DIR = Path(__file__).resolve().parent
BACKEND_DIR = APP_DIR.parent
load_dotenv(BACKEND_DIR / ".env")


class Settings:
    mongo_uri = os.getenv("MONGO_URI", "")
    supabase_url = os.getenv("SUPABASE_URL", "").rstrip("/")
    supabase_anon_key = os.getenv("SUPABASE_ANON_KEY", "")
    cookie_samesite = os.getenv("COOKIE_SAMESITE", "none").lower()
    supabase_service_role_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    club_credential_encryption_key = os.getenv("CLUB_CREDENTIAL_ENCRYPTION_KEY", "")
    icts_email = (os.getenv("ICTS_EMAIL") or os.getenv("SUPER_ADMIN_EMAIL", "")).strip().lower()
    client_origin = os.getenv("CLIENT_ORIGIN", "http://localhost:5173")
    port = int(os.getenv("PORT", "5000"))
    tls_mode = os.getenv("TLS_MODE", "").lower()
    node_env = os.getenv("NODE_ENV", "development")
    tls_key_path = Path(os.getenv("TLS_KEY_PATH") or BACKEND_DIR / "certs" / "server.key")
    tls_cert_path = Path(os.getenv("TLS_CERT_PATH") or BACKEND_DIR / "certs" / "server.crt")


settings = Settings()
if settings.cookie_samesite not in ("lax", "strict", "none"):
    raise ValueError("COOKIE_SAMESITE must be lax, strict, or none.")
