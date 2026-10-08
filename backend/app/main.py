import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pymongo.errors import DuplicateKeyError, PyMongoError
from starlette.exceptions import HTTPException as StarletteHTTPException

from .config import settings
from .database import connect_database, migrate_legacy_data
from .routes import auth, campus, clubs, events, profiles, public


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    if not settings.mongo_uri:
        raise RuntimeError("MONGO_URI is missing. Add your MongoDB connection string to backend/.env.")
    try:
        client, database = connect_database(settings.mongo_uri)
        migrate_legacy_data(database, settings.icts_email)
    except Exception:
        logger.exception("MongoDB connection or legacy data migration failed.")
        raise
    app.state.mongo_client = client
    app.state.db = database
    logger.info("MongoDB connected; existing collections and records remain in place.")
    try:
        yield
    finally:
        client.close()


app = FastAPI(title="CampusSphere API", version="1.0.0", lifespan=lifespan)
app.state.db = None
app.state.mongo_client = None

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.client_origin.rstrip("/")],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Accept"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    if request.url.path.startswith("/api/") and request.method in {"POST", "PUT", "PATCH", "DELETE"}:
        if request.headers.get("origin", "").rstrip("/") != settings.client_origin.rstrip("/"):
            response = JSONResponse(status_code=403, content={"error": "Invalid request origin."})
            response.headers["X-Content-Type-Options"] = "nosniff"
            if request.url.scheme == "https":
                response.headers["Strict-Transport-Security"] = "max-age=15552000; includeSubDomains"
            return response
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    if request.url.path.startswith("/api/auth/"):
        response.headers["Cache-Control"] = "no-store"
        response.headers["Pragma"] = "no-cache"
    if request.url.scheme == "https":
        response.headers["Strict-Transport-Security"] = "max-age=15552000; includeSubDomains"
    return response


@app.exception_handler(HTTPException)
async def http_error_handler(request: Request, error: HTTPException):
    return JSONResponse(status_code=error.status_code, content={"error": error.detail})


@app.exception_handler(StarletteHTTPException)
async def route_error_handler(request: Request, error: StarletteHTTPException):
    if error.status_code == 404:
        message = f"API route not found: {request.method} {request.url.path}"
    else:
        message = str(error.detail)
    return JSONResponse(status_code=error.status_code, content={"error": message})


@app.exception_handler(RequestValidationError)
async def request_validation_handler(request: Request, error: RequestValidationError):
    return JSONResponse(status_code=400, content={"error": "Invalid request body or parameters."})


@app.exception_handler(DuplicateKeyError)
async def duplicate_key_handler(request: Request, error: DuplicateKeyError):
    return JSONResponse(status_code=409, content={"error": "A record with those details already exists."})


@app.exception_handler(PyMongoError)
async def database_error_handler(request: Request, error: PyMongoError):
    logger.exception("MongoDB request failed.")
    return JSONResponse(status_code=500, content={"error": "An unexpected server error occurred."})


@app.exception_handler(Exception)
async def unexpected_error_handler(request: Request, error: Exception):
    logger.exception("Unexpected API error.")
    return JSONResponse(status_code=500, content={"error": "An unexpected server error occurred."})


@app.get("/")
def root():
    return {"name": "CampusSphere API", "health": "/api/health"}


app.include_router(auth.router, prefix="/api")
app.include_router(public.router, prefix="/api")
app.include_router(profiles.router, prefix="/api")
app.include_router(clubs.router, prefix="/api")
app.include_router(events.router, prefix="/api")
app.include_router(campus.router, prefix="/api")


def create_development_certificate(key_path, cert_path):
    from datetime import datetime, timedelta, timezone
    from ipaddress import ip_address

    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID

    key_path.parent.mkdir(parents=True, exist_ok=True)
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "localhost")])
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(datetime.now(timezone.utc))
        .not_valid_after(datetime.now(timezone.utc) + timedelta(days=365))
        .add_extension(
            x509.SubjectAlternativeName([
                x509.DNSName("localhost"),
                x509.IPAddress(ip_address("127.0.0.1")),
                x509.IPAddress(ip_address("::1")),
            ]),
            critical=False,
        )
        .sign(key, hashes.SHA256())
    )
    key_path.write_bytes(key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.TraditionalOpenSSL,
        encryption_algorithm=serialization.NoEncryption(),
    ))
    try:
        os.chmod(key_path, 0o600)
    except OSError:
        pass
    cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))


if __name__ == "__main__":
    import uvicorn

    ssl_options = {}
    if settings.tls_mode != "off":
        if not settings.tls_key_path.exists() or not settings.tls_cert_path.exists():
            if settings.node_env == "production":
                raise RuntimeError("TLS certificate not found. Set TLS_KEY_PATH and TLS_CERT_PATH.")
            if os.getenv("TLS_KEY_PATH") or os.getenv("TLS_CERT_PATH"):
                raise RuntimeError("TLS_KEY_PATH/TLS_CERT_PATH point to missing files.")
            create_development_certificate(settings.tls_key_path, settings.tls_cert_path)
            logger.info("Created a self-signed development certificate in %s", settings.tls_key_path.parent)
        ssl_options = {
            "ssl_keyfile": str(settings.tls_key_path),
            "ssl_certfile": str(settings.tls_cert_path),
        }
    uvicorn.run("app.main:app", host="0.0.0.0", port=settings.port, **ssl_options)
