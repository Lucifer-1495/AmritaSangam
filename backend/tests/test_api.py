from contextlib import asynccontextmanager
from datetime import datetime, timezone
import hashlib
import base64

import httpx
import pytest
from bson import ObjectId
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app import auth
from app.config import settings
from app.database import serialize_document
from app.main import app
from app.routes import events as event_routes
from app.services.common import remove_csv_rows_for_email
from app.services.media import validate_image_data_url


@pytest.fixture
def client(monkeypatch):
    @asynccontextmanager
    async def no_database_lifespan(application):
        yield

    monkeypatch.setattr(app.router, "lifespan_context", no_database_lifespan)
    app.state.db = object()
    with TestClient(app) as test_client:
        yield test_client


def test_health_and_root_endpoints(client):
    assert client.get("/").json() == {"name": "CampusSphere API", "health": "/api/health"}
    assert client.get("/api/health").json() == {"status": "ok", "database": "connected"}


def test_health_reports_database_unavailable(client):
    app.state.db = None
    response = client.get("/api/health")
    assert response.status_code == 503
    assert response.json() == {"status": "database_unavailable", "database": "disconnected"}


def test_protected_routes_require_a_supabase_session(client):
    response = client.get("/api/profiles/me")
    assert response.status_code == 401
    assert response.json()["error"] == "Sign in to continue."


def test_login_creates_a_mongo_session_and_sets_an_opaque_cookie(client, monkeypatch):
    monkeypatch.setattr(settings, "supabase_url", "https://auth.example.test")
    monkeypatch.setattr(settings, "supabase_anon_key", "public-test-key")
    monkeypatch.setattr(settings, "cookie_samesite", "none")
    session = {
        "access_token": "access-test-token",
        "refresh_token": "refresh-test-token",
        "expires_in": 3600,
        "user": {"id": "user-123", "email": "student@example.edu"},
    }
    calls = []

    class Sessions:
        def insert_one(self, document):
            self.document = document

    class Profiles:
        def find_one(self, *args, **kwargs):
            return {"_id": ObjectId()}

        def find_one_and_update(self, *args, **kwargs):
            return profile

    profile = {
        "_id": ObjectId(),
        "supabaseId": "user-123",
        "email": "student@example.edu",
        "name": "Student",
        "role": "student",
    }
    sessions = Sessions()
    app.state.db = {"auth_sessions": sessions, "profiles": Profiles()}

    def fake_request(*args, **kwargs):
        calls.append((args, kwargs))
        return httpx.Response(200, json=session)

    monkeypatch.setattr(auth.httpx, "request", fake_request)

    response = client.post(
        "/api/auth/login",
        headers={"origin": settings.client_origin},
        json={"email": "student@example.edu", "password": "test-password"},
    )

    assert response.status_code == 200
    assert response.json() == {"user": {"id": "user-123", "email": "student@example.edu"}}
    cookie = response.headers.get("set-cookie", "")
    assert cookie.startswith("__Host-campussphere_session=")
    assert "HttpOnly" in cookie and "Secure" in cookie and "SameSite=none" in cookie
    assert "access-test-token" not in cookie
    assert "refresh-test-token" not in cookie
    assert "tokenHash" in sessions.document
    assert "access-test-token" not in str(sessions.document)
    assert "refresh-test-token" not in str(sessions.document)
    assert len(calls) == 1


def test_api_session_is_loaded_from_mongo_without_contacting_supabase(client, monkeypatch):
    monkeypatch.setattr(settings, "cookie_samesite", "none")
    profile_id = ObjectId()
    profile = {
        "_id": profile_id,
        "supabaseId": "user-123",
        "name": "Student",
        "email": "student@example.edu",
        "role": "student",
    }

    class Sessions:
        def find_one(self, query):
            assert query["tokenHash"] == hashlib.sha256(b"mongo-session-token").hexdigest()
            assert "$gt" in query["expiresAt"]
            return {"_id": ObjectId(), "profileId": profile_id, "supabaseId": "user-123"}

    class Profiles:
        def find_one(self, query):
            assert query["_id"] == profile_id
            assert query["supabaseId"] == "user-123"
            return profile

    app.state.db = {"auth_sessions": Sessions(), "profiles": Profiles()}
    monkeypatch.setattr(
        auth.httpx, "request",
        lambda *args, **kwargs: pytest.fail("Normal API requests must not call Supabase."),
    )
    response = client.get(
        "/api/auth/session",
        headers={"cookie": "__Host-campussphere_session=mongo-session-token"},
    )

    assert response.status_code == 200
    assert response.json() == {"user": {"id": "user-123", "email": "student@example.edu"}}
    assert not response.headers.get_list("set-cookie")


def test_event_creation_saves_to_mongo_without_a_supabase_request(client, monkeypatch):
    profile_id = ObjectId()
    club_id = ObjectId()
    profile = {
        "_id": profile_id,
        "supabaseId": "user-123",
        "name": "Club President",
        "email": "president@example.edu",
        "role": "student",
    }
    club = {
        "_id": club_id,
        "mentor": ObjectId(),
        "clubType": "technical",
    }
    stored_events = []

    class Sessions:
        def find_one(self, query):
            assert query["tokenHash"] == hashlib.sha256(b"mongo-session-token").hexdigest()
            return {"_id": ObjectId(), "profileId": profile_id, "supabaseId": "user-123"}

    class Profiles:
        def find_one(self, query):
            assert query["_id"] == profile_id
            return profile

    class Clubs:
        def find_one(self, query):
            assert query["_id"] == club_id
            return club

    class Database(dict):
        def __getitem__(self, name):
            if name == "clubs":
                return Clubs()
            return super().__getitem__(name)

    app.state.db = Database(auth_sessions=Sessions(), profiles=Profiles())
    monkeypatch.setattr(
        auth.httpx, "request",
        lambda *args, **kwargs: pytest.fail("Event creation must not call Supabase."),
    )
    monkeypatch.setattr(
        event_routes, "active_membership",
        lambda *args, **kwargs: {"position": "president"},
    )

    def save_event(database, collection, document):
        assert database is app.state.db
        assert collection == "events"
        stored_events.append(document)
        return serialize_document({"_id": ObjectId(), **document})

    monkeypatch.setattr(event_routes, "insert", save_event)

    response = client.post(
        "/api/events",
        headers={
            "origin": settings.client_origin,
            "cookie": "__Host-campussphere_session=mongo-session-token",
        },
        json={
            "title": "Campus coding night",
            "description": "Build a project with your club.",
            "eventDate": "2026-11-01T17:00",
            "clubId": str(club_id),
            "capacity": 40,
        },
    )

    assert response.status_code == 201
    assert response.json()["title"] == "Campus coding night"
    assert len(stored_events) == 1
    assert stored_events[0]["title"] == "Campus coding night"
    assert stored_events[0]["clubId"] == club_id


def test_logout_revokes_the_mongo_session_without_calling_supabase(client, monkeypatch):
    class Sessions:
        deleted_query = None

        def delete_one(self, query):
            self.deleted_query = query

    sessions = Sessions()
    app.state.db = {"auth_sessions": sessions}
    monkeypatch.setattr(
        auth.httpx, "request",
        lambda *args, **kwargs: pytest.fail("Signing out must not depend on Supabase."),
    )

    response = client.post(
        "/api/auth/logout",
        headers={
            "origin": settings.client_origin,
            "cookie": "__Host-campussphere_session=mongo-session-token",
        },
    )

    assert response.status_code == 200
    assert response.json() == {"message": "Signed out."}
    assert sessions.deleted_query == {
        "tokenHash": hashlib.sha256(b"mongo-session-token").hexdigest()
    }
    assert any(
        cookie.startswith("__Host-campussphere_session=")
        and "Max-Age=0" in cookie
        for cookie in response.headers.get_list("set-cookie")
    )


def test_write_requests_require_the_configured_origin(client):
    response = client.post("/api/auth/logout")
    assert response.status_code == 403
    assert response.json() == {"error": "Invalid request origin."}


def test_image_data_urls_are_validated_before_storage():
    png = base64.b64encode(b"\x89PNG\r\n\x1a\nvalid-image-bytes").decode("ascii")
    data_url = f"data:image/png;base64,{png}"
    assert validate_image_data_url(data_url, "Club logo", 100, {"image/png"}) == data_url

    fake_png = base64.b64encode(b"\xff\xd8\xffnot-a-png").decode("ascii")
    with pytest.raises(HTTPException) as error:
        validate_image_data_url(f"data:image/png;base64,{fake_png}", "Club logo", 100, {"image/png"})
    assert "does not match its declared image type" in error.value.detail


def test_unknown_routes_return_the_api_route_error_shape(client):
    response = client.get("/api/not-a-real-route")
    assert response.status_code == 404
    assert response.json()["error"] == "API route not found: GET /api/not-a-real-route"


def test_api_keeps_the_existing_route_contract():
    routes = app.openapi()["paths"]
    paths = set(routes)
    assert {
        "/api/profiles/me",
        "/api/profiles",
        "/api/clubs",
        "/api/applications",
        "/api/events/manage",
        "/api/registrations",
        "/api/attendance",
        "/api/event-reports",
        "/api/reports/summary",
    } <= paths
    assert sum(len(operations) for operations in routes.values()) == 63


def test_mongo_documents_serialize_ids_and_dates_for_react():
    identity = ObjectId()
    value = serialize_document({"_id": identity, "createdAt": datetime(2026, 1, 2, tzinfo=timezone.utc)})
    assert value == {"_id": str(identity), "createdAt": "2026-01-02T00:00:00+00:00"}


def test_account_cleanup_removes_only_the_matching_attendee():
    csv_data = '"Name","Email"\r\n"Ada","ada@example.edu"\r\n"Sam","sam@example.edu"'
    updated, removed = remove_csv_rows_for_email(csv_data, "ada@example.edu")
    assert removed == 1
    assert "ada@example.edu" not in updated
    assert "sam@example.edu" in updated
