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
from app.routes import clubs as club_routes, events as event_routes
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
    assert client.get("/").json() == {"name": "my AMRITA API", "health": "/api/health"}
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
    venue_id = ObjectId()
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

    class Venues:
        def find_one(self, query, projection):
            assert query == {"_id": venue_id, "isAvailable": True}
            return {"_id": venue_id}

    class Events:
        def find(self, query):
            assert query["venueId"] == venue_id
            return []

    class Database(dict):
        def __getitem__(self, name):
            if name == "clubs":
                return Clubs()
            if name == "venues":
                return Venues()
            if name == "events":
                return Events()
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
            "endDate": "2026-11-01T19:00",
            "clubId": str(club_id),
            "venueId": str(venue_id),
            "capacity": 40,
        },
    )

    assert response.status_code == 201
    assert response.json()["title"] == "Campus coding night"
    assert len(stored_events) == 1
    assert stored_events[0]["title"] == "Campus coding night"
    assert stored_events[0]["clubId"] == club_id
    assert stored_events[0]["venueId"] == venue_id
    assert stored_events[0]["endDate"] == datetime(2026, 11, 1, 19, tzinfo=timezone.utc)


def test_venue_conflict_uses_start_and_end_overlap():
    venue_id = ObjectId()
    existing = {
        "venueId": venue_id,
        "eventDate": datetime(2026, 11, 1, 17, tzinfo=timezone.utc),
        "endDate": datetime(2026, 11, 1, 19, tzinfo=timezone.utc),
        "status": "approved",
    }

    class Events:
        def find(self, query):
            return [existing]

    class Database(dict):
        def __getitem__(self, name):
            assert name == "events"
            return Events()

    database = Database()
    overlapping = event_routes.find_venue_conflict(
        database,
        venue_id,
        datetime(2026, 11, 1, 18, tzinfo=timezone.utc),
        datetime(2026, 11, 1, 20, tzinfo=timezone.utc),
    )
    adjacent = event_routes.find_venue_conflict(
        database,
        venue_id,
        datetime(2026, 11, 1, 19, tzinfo=timezone.utc),
        datetime(2026, 11, 1, 20, tzinfo=timezone.utc),
    )

    assert overlapping is existing
    assert adjacent is None


def test_venue_availability_reports_occupied_slots(client):
    profile_id = ObjectId()
    venue_id = ObjectId()
    profile = {
        "_id": profile_id,
        "supabaseId": "student-user",
        "name": "Campus Student",
        "email": "student@example.edu",
        "role": "student",
    }
    venue = {
        "_id": venue_id,
        "name": "Main Hall",
        "location": "Block A",
        "isAvailable": True,
    }
    existing_event = {
        "_id": ObjectId(),
        "venueId": venue_id,
        "eventDate": datetime(2026, 11, 1, 11, 30, tzinfo=timezone.utc),
        "endDate": datetime(2026, 11, 1, 13, 30, tzinfo=timezone.utc),
        "status": "approved",
    }

    class Sessions:
        def find_one(self, query):
            assert query["tokenHash"] == hashlib.sha256(b"mongo-session-token").hexdigest()
            return {"_id": ObjectId(), "profileId": profile_id, "supabaseId": "student-user"}

    class Profiles:
        def find_one(self, query):
            assert query["_id"] == profile_id
            return profile

    class VenueCursor(list):
        def sort(self, key, direction):
            return self

    class Venues:
        def find(self, query):
            assert query == {"isAvailable": True}
            return VenueCursor([venue])

    class Events:
        def find(self, query):
            assert query["venueId"] == venue_id
            return [existing_event]

    class Database(dict):
        def __getitem__(self, name):
            if name == "venues":
                return Venues()
            if name == "events":
                return Events()
            return super().__getitem__(name)

    app.state.db = Database(
        auth_sessions=Sessions(),
        profiles=Profiles(),
    )
    response = client.get(
        "/api/venues/availability",
        params={
            "eventDate": "2026-11-01T18:00:00+05:30",
            "endDate": "2026-11-01T20:00:00+05:30",
        },
        headers={"cookie": "__Host-campussphere_session=mongo-session-token"},
    )

    assert response.status_code == 200
    assert response.json() == [{
        "_id": str(venue_id),
        "name": "Main Hall",
        "location": "Block A",
        "isAvailable": True,
        "available": False,
    }]


def test_event_time_range_rejects_end_before_start():
    with pytest.raises(HTTPException) as error:
        event_routes.event_time_range("2026-11-01T19:00", "2026-11-01T17:00")

    assert error.value.status_code == 400
    assert error.value.detail == "Event end time must be after its start time."


def test_event_time_range_preserves_local_timezone_offset():
    start, end = event_routes.event_time_range(
        "2026-11-01T17:00:00+05:30",
        "2026-11-01T19:00:00+05:30",
    )

    assert start == datetime(2026, 11, 1, 11, 30, tzinfo=timezone.utc)
    assert end == datetime(2026, 11, 1, 13, 30, tzinfo=timezone.utc)


def test_club_domains_are_normalized_and_validated():
    assert club_routes.normalize_domains("Web development\nDesign, web development") == [
        "Web development",
        "Design",
    ]
    with pytest.raises(HTTPException) as error:
        club_routes.normalize_domains(" , \n ")
    assert error.value.status_code == 400
    assert error.value.detail == "Add at least one application domain for this club."


def test_application_saves_student_provided_details_and_club_domain(client, monkeypatch):
    profile_id = ObjectId()
    club_id = ObjectId()
    profile = {
        "_id": profile_id,
        "supabaseId": "student-user",
        "name": "Campus Student",
        "email": "student@example.edu",
        "role": "student",
    }
    club = {
        "_id": club_id,
        "recruitmentOpen": True,
        "domains": ["Robotics", "Design"],
    }
    stored_applications = []

    class Sessions:
        def find_one(self, query):
            assert query["tokenHash"] == hashlib.sha256(b"mongo-session-token").hexdigest()
            return {"_id": ObjectId(), "profileId": profile_id, "supabaseId": "student-user"}

    class Profiles:
        def find_one(self, query):
            assert query["_id"] == profile_id
            return profile

    class Clubs:
        def find_one(self, query):
            assert query["_id"] == club_id
            return club

    class Members:
        def find_one(self, query, projection):
            return None

    class Applications:
        def find_one(self, query, projection):
            return None

    class Database(dict):
        def __getitem__(self, name):
            if name == "clubs":
                return Clubs()
            if name == "clubmembers":
                return Members()
            if name == "membershipapplications":
                return Applications()
            return super().__getitem__(name)

    app.state.db = Database(
        auth_sessions=Sessions(),
        profiles=Profiles(),
    )
    monkeypatch.setattr(
        auth.httpx, "request",
        lambda *args, **kwargs: pytest.fail("Application submissions must not call Supabase."),
    )

    def save_application(database, collection, document):
        assert database is app.state.db
        assert collection == "applications"
        stored_applications.append(document)
        return serialize_document({"_id": ObjectId(), **document})

    monkeypatch.setattr(club_routes, "insert", save_application)
    response = client.post(
        "/api/applications",
        headers={
            "origin": settings.client_origin,
            "cookie": "__Host-campussphere_session=mongo-session-token",
        },
        json={
            "clubId": str(club_id),
            "reason": "I want to help build projects.",
            "domain": "Robotics",
            "yearOfStudy": "2nd",
            "applicantPhone": "+91 98765 43210",
            "requestedPosition": "executive",
        },
    )

    assert response.status_code == 201
    assert stored_applications[0]["profileId"] == profile_id
    assert stored_applications[0]["domain"] == "Robotics"
    assert stored_applications[0]["yearOfStudy"] == "2nd"
    assert stored_applications[0]["applicantPhone"] == "+91 98765 43210"


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
    assert sum(len(operations) for operations in routes.values()) == 64
    assert "/api/venues/availability" in paths


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
