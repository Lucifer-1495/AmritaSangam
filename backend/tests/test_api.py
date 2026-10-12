from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
import hashlib
import base64
from types import SimpleNamespace

import httpx
import pytest
from bson import ObjectId
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app import auth
from app.campus_directory import CLUB_MENTORS, CLUBS, EVENT_ORGANIZERS, VENUES, sync_mentor_accounts
from app.config import settings
from app.database import serialize_document
from app.main import app
from app.routes.campus import review_funding_request
from app.routes import auth as auth_routes, campus as campus_routes, clubs as club_routes, events as event_routes, profiles as profile_routes
from app.services.common import (
    build_attendance_roster,
    has_verified_club_access,
    hash_shared_password,
    is_executive,
    mentor_review_started,
    mentor_approval_assignments,
    profile_identity_fields,
    remove_csv_rows_for_email,
    review_mentor_assignment,
    student_register_number,
    verify_shared_password,
)
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
    assert client.get("/").json() == {"name": "Amrita Sangam API", "health": "/api/health"}
    response = client.get("/api/health")
    assert response.json() == {"status": "ok", "database": "connected"}
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["X-Frame-Options"] == "DENY"
    assert response.headers["Referrer-Policy"] == "strict-origin-when-cross-origin"
    assert response.headers["Permissions-Policy"] == "camera=(), microphone=(), geolocation=()"
    assert response.headers["Content-Security-Policy"] == (
        "default-src 'none'; base-uri 'none'; frame-ancestors 'none'"
    )


def test_security_headers_are_present_on_root_and_https_responses(client):
    root_response = client.get("/")
    assert root_response.headers["X-Frame-Options"] == "DENY"
    assert root_response.headers["Referrer-Policy"] == "strict-origin-when-cross-origin"
    assert "Content-Security-Policy" not in root_response.headers

    with TestClient(app, base_url="https://testserver") as https_client:
        https_response = https_client.get("/api/health")
    assert https_response.headers["Strict-Transport-Security"] == "max-age=15552000; includeSubDomains"


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
    app.state.db = {
        "auth_sessions": sessions,
        "profiles": Profiles(),
        "clubcredentials": FakeCollection(),
        "clubs": FakeCollection(),
        "clubmembers": FakeCollection(),
        "notifications": FakeCollection(),
    }

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


def test_supabase_club_login_creates_a_club_scoped_session(monkeypatch):
    club_id = ObjectId()
    supabase_id = "club-supabase-id"

    class Sessions(FakeCollection):
        pass

    database = {
        "clubcredentials": FakeCollection([{
            "_id": ObjectId(),
            "clubId": club_id,
            "supabaseId": supabase_id,
            "email": "club@example.edu",
            "updatedAt": datetime.now(timezone.utc),
        }]),
        "clubs": FakeCollection([{
            "_id": club_id,
            "name": "Robotics Club",
            "mentorIds": [],
        }]),
        "clubmembers": FakeCollection(),
        "notifications": FakeCollection(),
        "auth_sessions": Sessions(),
        "profiles": FakeCollection(),
    }
    app.state.db = database
    monkeypatch.setattr(
        auth_routes, "supabase_request",
        lambda *args, **kwargs: httpx.Response(200, json={
            "user": {"id": supabase_id, "email": "club@example.edu"},
        }),
    )
    response = auth.Response()

    result = auth_routes.login(
        SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(db=database))),
        {"email": "club@example.edu", "password": "club-password"},
        response,
    )

    assert result == {"user": {"id": supabase_id, "email": "club@example.edu"}}
    assert database["auth_sessions"].records[0]["principalType"] == "club_account"
    assert database["auth_sessions"].records[0]["clubId"] == club_id
    assert response.headers.get("set-cookie", "").startswith("__Host-campussphere_session=")


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


def test_office_bearer_cannot_create_an_event(client, monkeypatch):
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
        lambda *args, **kwargs: {"position": "president", "membershipStatus": "active"},
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

    assert response.status_code == 403
    assert stored_events == []


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
    assert sum(len(operations) for operations in routes.values()) == 77
    assert {
        "/api/auth/password-reset/request",
        "/api/auth/password-reset/confirm",
        "/api/auth/club-login",
        "/api/notifications",
        "/api/club-credential-change-requests",
    } <= paths
    assert "/api/auth/club-login/verify" not in paths
    assert "/api/profiles/mentor-directory" not in paths
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


class FakeCursor(list):
    def sort(self, key, direction=1):
        return FakeCursor(sorted(self, key=lambda item: item.get(key, ""), reverse=direction < 0))

    def limit(self, count):
        return FakeCursor(self[:count])


class FakeCollection:
    def __init__(self, records=()):
        self.records = list(records)

    def find_one(self, query, projection=None):
        return next((record for record in self.records if all(record.get(key) == value for key, value in query.items())), None)

    def find(self, query=None, projection=None):
        query = query or {}
        return FakeCursor([
            record for record in self.records
            if all(record.get(key) == value for key, value in query.items())
        ])

    def find_one_and_update(self, query, update, **kwargs):
        record = self.find_one(query)
        if record is None:
            record = {"_id": query["_id"], "seq": 0}
            self.records.append(record)
        record["seq"] += update["$inc"]["seq"]
        return record

    def update_one(self, query, update):
        record = self.find_one(query)
        if record is None:
            return SimpleNamespace(matched_count=0, modified_count=0)
        for key, value in update.get("$set", {}).items():
            record[key] = value
        for key, value in update.get("$inc", {}).items():
            record[key] = record.get(key, 0) + value
        for key in update.get("$unset", {}):
            record.pop(key, None)
        for key, value in update.get("$push", {}).items():
            record.setdefault(key, []).append(value)
        for key, value in update.get("$pull", {}).items():
            record[key] = [item for item in record.get(key, []) if item != value]
        return SimpleNamespace(matched_count=1, modified_count=1)

    def insert_one(self, record):
        record["_id"] = ObjectId()
        self.records.append(record)
        return SimpleNamespace(inserted_id=record["_id"])

    def delete_one(self, query):
        record = self.find_one(query)
        if record:
            self.records.remove(record)

    def delete_many(self, query):
        matches = [record for record in self.records if all(record.get(key) == value for key, value in query.items())]
        for record in matches:
            self.records.remove(record)
        return SimpleNamespace(deleted_count=len(matches))


def test_event_registration_is_permanent_for_students():
    event_id = ObjectId()
    profile_id = ObjectId()
    event = {
        "_id": event_id,
        "status": "approved",
        "capacity": 5,
        "registeredCount": 0,
        "eventDate": datetime.now(timezone.utc) + timedelta(days=2),
        "endDate": datetime.now(timezone.utc) + timedelta(days=2, hours=1),
    }

    class Events(FakeCollection):
        def find_one_and_update(self, query, update, **kwargs):
            current = self.find_one({"_id": query["_id"], "status": query["status"]})
            if not current or current["registeredCount"] >= current["capacity"]:
                return None
            current["registeredCount"] += update["$inc"]["registeredCount"]
            return current

        def update_one(self, query, update):
            current = self.find_one(query)
            if current:
                current["registeredCount"] += update["$inc"]["registeredCount"]
            return SimpleNamespace(matched_count=bool(current), modified_count=bool(current))

    database = {
        "events": Events([event]),
        "eventregistrations": FakeCollection(),
    }
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(db=database)))
    profile = {"_id": str(profile_id), "role": "student"}

    result = event_routes.register_for_event(request, {"eventId": str(event_id)}, profile)
    assert result["status"] == "registered"
    assert event["registeredCount"] == 1
    with pytest.raises(HTTPException) as duplicate:
        event_routes.register_for_event(request, {"eventId": str(event_id)}, profile)
    assert duplicate.value.status_code == 409
    with pytest.raises(HTTPException) as cancelled:
        event_routes.cancel_registration(request, result["_id"], profile)
    assert cancelled.value.status_code == 409
    assert event["registeredCount"] == 1
    assert database["eventregistrations"].records[0]["status"] == "registered"


def test_equipment_request_saves_quantity_and_requested_time_range():
    club_id, equipment_id, profile_id, mentor_id = (ObjectId() for _ in range(4))
    database = {
        "clubs": FakeCollection([{"_id": club_id, "mentorIds": [mentor_id]}]),
        "equipment": FakeCollection([{
            "_id": equipment_id,
            "clubId": club_id,
            "availableQuantity": 4,
        }]),
        "clubmembers": FakeCollection(),
        "equipmentborrows": FakeCollection(),
    }
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(db=database)))
    profile = {
        "_id": str(profile_id),
        "role": "club_committee",
        "isClubAccount": True,
        "verifiedClubId": str(club_id),
    }
    start = datetime.now(timezone.utc) + timedelta(days=1)
    end = start + timedelta(hours=3)

    result = campus_routes.request_borrow(request, {
        "clubId": str(club_id),
        "equipmentId": str(equipment_id),
        "quantity": 2,
        "startDate": start.isoformat(),
        "endDate": end.isoformat(),
        "purpose": "Workshop setup",
    }, profile)

    assert result["quantity"] == 2
    assert result["purpose"] == "Workshop setup"
    assert result["status"] == "mentor_pending"
    assert result["startDate"] == start.isoformat()
    assert result["endDate"] == end.isoformat()


def test_cohosted_workflow_waits_for_every_assigned_mentor():
    first_club_id, second_club_id = ObjectId(), ObjectId()
    first_mentor_id, second_mentor_id, third_mentor_id = ObjectId(), ObjectId(), ObjectId()
    database = {"clubs": FakeCollection([
        {"_id": first_club_id, "mentorIds": [first_mentor_id, second_mentor_id]},
        {"_id": second_club_id, "mentor": third_mentor_id},
    ])}
    approvals = mentor_approval_assignments(database, {
        "clubId": first_club_id,
        "coHostIds": [second_club_id],
    })
    request = {"mentorApprovals": approvals}

    reviewed, complete = review_mentor_assignment(request, first_mentor_id, "approved", datetime.now(timezone.utc))
    assert reviewed and not complete
    reviewed, complete = review_mentor_assignment(request, second_mentor_id, "approved", datetime.now(timezone.utc))
    assert reviewed and not complete
    reviewed, complete = review_mentor_assignment(request, third_mentor_id, "approved", datetime.now(timezone.utc))
    assert reviewed and complete


def test_detailed_event_report_submission_uses_report_details_without_legacy_fields(monkeypatch):
    event_id, club_id, profile_id, mentor_id = (ObjectId() for _ in range(4))
    event = {
        "_id": event_id,
        "clubId": club_id,
        "status": "approved",
        "eventDate": datetime.now(timezone.utc) - timedelta(days=1),
        "title": "Campus workshop",
    }
    reports = FakeCollection()
    database = {
        "events": FakeCollection([event]),
        "eventreports": reports,
    }
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(db=database)))
    monkeypatch.setattr(event_routes, "active_membership", lambda *_: None)
    monkeypatch.setattr(event_routes, "has_verified_club_access", lambda *_: True)
    monkeypatch.setattr(event_routes, "build_attendance_roster", lambda *_: {})
    monkeypatch.setattr(event_routes, "mentor_approval_assignments", lambda *_: [{
        "clubId": club_id,
        "mentorId": mentor_id,
        "status": "pending",
    }])
    details = {
        "eventCategory": {"selected": ["Club Collaboration"], "remark": "Joint activity"},
        "activityCompletion": {
            "detailedReport": {"value": "Detailed workshop report"},
            "discussionHighlights": {"value": "Questions and demonstrations"},
            "objectiveAchieved": {"value": "Objectives were achieved"},
        },
    }

    report = event_routes.submit_event_report(
        request, str(event_id), {"reportDetails": details},
        {"_id": str(profile_id), "role": "club_committee", "verifiedClubId": str(club_id)},
    )

    assert report["status"] == "mentor_pending"
    assert report["summary"] == "Detailed workshop report"
    assert report["activities"] == "Questions and demonstrations"
    assert report["outcomes"] == "Objectives were achieved"
    assert report["reportDetails"]["eventCategory"]["selected"] == ["Club Collaboration"]
    assert report["mentorApprovals"][0]["mentorId"] == str(mentor_id)

    with pytest.raises(HTTPException) as length_error:
        event_routes.parse_report_details({
            "activityCompletion": {
                "detailedReport": {"value": "word " * 1001},
            },
        })
    assert length_error.value.status_code == 400


def test_admin_can_set_club_login_credentials_on_create_and_edit_without_exposing_them_to_members(monkeypatch):
    class QueryCollection(FakeCollection):
        @staticmethod
        def matches(record, query):
            for key, expected in query.items():
                actual = record.get(key)
                if isinstance(expected, dict):
                    if "$in" in expected and actual not in expected["$in"]:
                        return False
                    if "$ne" in expected and actual == expected["$ne"]:
                        return False
                elif actual != expected:
                    return False
            return True

        def find_one(self, query, projection=None):
            return next((record for record in self.records if self.matches(record, query)), None)

        def find(self, query=None, projection=None):
            return FakeCursor([
                dict(record) for record in self.records
                if self.matches(record, query or {})
            ])

        def update_one(self, query, update, upsert=False):
            record = self.find_one(query)
            if record is None and upsert:
                record = {key: value for key, value in query.items() if not isinstance(value, dict)}
                record.update(update.get("$setOnInsert", {}))
                record["_id"] = ObjectId()
                self.records.append(record)
            if record is None:
                return SimpleNamespace(matched_count=0, modified_count=0)
            record.update(update.get("$set", {}))
            return SimpleNamespace(matched_count=1, modified_count=1)

    club_collection = QueryCollection()
    credential_collection = QueryCollection()
    auth_sessions = FakeCollection()
    database = {
        "clubs": club_collection,
        "clubcredentials": credential_collection,
        "auth_sessions": auth_sessions,
        "profiles": QueryCollection(),
    }
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(db=database)))
    monkeypatch.setattr(club_routes, "populate_club_mentors", lambda *_: None)
    monkeypatch.setattr(
        club_routes, "create_supabase_user",
        lambda email, password, name: {"id": "club-auth-id", "email": email},
    )
    supabase_updates = []
    monkeypatch.setattr(
        club_routes, "update_supabase_user",
        lambda identity, updates: supabase_updates.append((identity, updates)),
    )

    created = club_routes.create_club(request, {
        "name": "Test club",
        "description": "A test club",
        "clubType": "technical",
        "clubLoginEmail": "  CLUB@example.edu ",
        "clubLoginPassword": "initial-password",
    }, {"_id": str(ObjectId()), "role": "college_admin"})
    credential = credential_collection.records[0]
    assert credential["email"] == "club@example.edu"
    assert credential["supabaseId"] == "club-auth-id"
    assert "passwordHash" not in credential

    auth_sessions.records.append({
        "principalType": "club_account",
        "clubId": credential["clubId"],
    })
    updated = club_routes.update_club(request, created["_id"], {
        "clubLoginEmail": "updated@example.edu",
    }, {"_id": str(ObjectId()), "role": "college_admin"})
    assert updated["name"] == "Test club"
    assert credential["email"] == "updated@example.edu"
    assert supabase_updates[-1] == ("club-auth-id", {"email": "updated@example.edu"})
    assert not auth_sessions.records
    club_routes.update_club(request, created["_id"], {
        "clubLoginPassword": "updated-password",
    }, {"_id": str(ObjectId()), "role": "college_admin"})
    assert supabase_updates[-1] == ("club-auth-id", {"password": "updated-password"})
    assert "passwordHash" not in credential

    admin_clubs = club_routes.my_clubs(
        request, {"_id": str(ObjectId()), "role": "college_admin"}
    )
    assert admin_clubs[0]["clubLoginEmail"] == "updated@example.edu"
    assert "passwordHash" not in admin_clubs[0]

    monkeypatch.setattr(club_routes, "visible_club_ids", lambda *_: [ObjectId(created["_id"])])
    member_clubs = club_routes.my_clubs(
        request, {"_id": str(ObjectId()), "role": "club_committee"}
    )
    assert "clubLoginEmail" not in member_clubs[0]


def test_office_bearer_group_does_not_receive_executive_permissions():
    assert not is_executive({
        "position": "executive",
        "officeBearerGroup": True,
        "membershipStatus": "active",
    })
    assert is_executive({
        "position": "executive",
        "officeBearerGroup": False,
        "membershipStatus": "active",
    })


def test_profile_identity_classification_uses_student_or_faculty_role_and_school():
    student = profile_identity_fields({
        "role": "club_committee",
        "schoolCode": "SC",
        "registerNumber": "BL.SC.U4CSE25001",
    })
    faculty = profile_identity_fields({"role": "faculty_coordinator", "department": "ECE"})
    imported_student = profile_identity_fields({"registerNumber": "BL.MBA.U4MBA25001"})
    imported_faculty = profile_identity_fields({"facultyId": "FA26CSE001"})
    admin = profile_identity_fields({"role": "college_admin", "department": "CSE"})

    assert student == {"identityType": "student", "school": "School of Computing"}
    assert faculty == {"identityType": "faculty", "school": "School of Engineering"}
    assert imported_student == {"identityType": "student", "school": "School of Business"}
    assert imported_faculty == {"identityType": "faculty", "school": "School of Computing"}
    assert admin == {"identityType": None, "school": "School of Computing"}


def test_shared_club_passwords_are_stored_as_one_way_hashes():
    encoded = hash_shared_password("a-strong-club-password")

    assert "a-strong-club-password" not in encoded
    assert verify_shared_password("a-strong-club-password", encoded)
    assert not verify_shared_password("wrong-password", encoded)


def test_current_profile_reads_verified_club_scope_from_the_server_session():
    profile_id = ObjectId()
    club_id = ObjectId()
    token = "verified-club-session"

    class SessionCollection:
        def find_one(self, query):
            assert query["tokenHash"] == hashlib.sha256(token.encode()).hexdigest()
            return {
                "_id": ObjectId(),
                "profileId": profile_id,
                "supabaseId": "supabase-user",
                "verifiedClubId": club_id,
                "expiresAt": datetime.now(timezone.utc) + timedelta(minutes=5),
            }

    database = {
        "auth_sessions": SessionCollection(),
        "profiles": FakeCollection([{
            "_id": profile_id,
            "supabaseId": "supabase-user",
            "role": "club_committee",
            "email": "ob@example.edu",
        }]),
    }
    request = SimpleNamespace(
        cookies={auth.SESSION_COOKIE: token},
        app=SimpleNamespace(state=SimpleNamespace(db=database)),
    )

    current = auth.current_profile(request, auth.Response())

    assert current["verifiedClubId"] == str(club_id)


def test_club_sign_in_creates_a_club_scoped_session_and_notifies_office_bearers_and_mentors():
    club_id = ObjectId()
    shared_password = "club-password-123"
    office_bearer_id = ObjectId()
    mentor_id = ObjectId()
    notifications = FakeCollection()
    sessions = FakeCollection()

    class Members(FakeCollection):
        def find(self, query=None, projection=None):
            assert query["clubId"] == club_id
            assert query["membershipStatus"] == "active"
            return FakeCursor([{"profileId": office_bearer_id}])

    database = {
        "clubcredentials": FakeCollection([{
            "_id": ObjectId(),
            "clubId": club_id,
            "email": "club@example.edu",
            "passwordHash": hash_shared_password(shared_password),
        }]),
        "clubs": FakeCollection([{
            "_id": club_id,
            "name": "Robotics Club",
            "mentor": mentor_id,
            "mentorIds": [mentor_id],
        }]),
        "clubmembers": Members(),
        "notifications": notifications,
        "auth_sessions": sessions,
    }
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(db=database)))
    response = auth.Response()

    result = auth_routes.club_login(request, {
        "email": " CLUB@example.edu ",
        "password": shared_password,
    }, response)

    assert result == {"user": {"id": f"club-account:{club_id}", "email": "club@example.edu"}}
    assert sessions.records[0]["principalType"] == "club_account"
    assert sessions.records[0]["clubId"] == club_id
    assert sessions.records[0]["profileId"] != office_bearer_id
    assert response.headers.get("set-cookie", "").startswith("__Host-campussphere_session=")
    assert {item["recipientId"] for item in notifications.records} == {office_bearer_id, mentor_id}
    assert all("not individually identified" in item["message"] for item in notifications.records)

    with pytest.raises(HTTPException) as error:
        auth_routes.club_login(request, {
            "email": "club@example.edu",
            "password": "wrong-password",
        }, auth.Response())
    assert error.value.status_code == 401
    assert error.value.detail == "The password is wrong."

    with pytest.raises(HTTPException) as error:
        auth_routes.club_login(request, {
            "email": "unknown@example.edu",
            "password": "wrong-password",
        }, auth.Response())
    assert error.value.status_code == 401
    assert error.value.detail == "The user ID or password is wrong."


def test_current_profile_resolves_club_login_as_a_scoped_non_personal_principal():
    club_id = ObjectId()
    token = "club-account-session"

    class SessionCollection:
        def find_one(self, query):
            assert query["tokenHash"] == hashlib.sha256(token.encode()).hexdigest()
            return {
                "_id": ObjectId(),
                "profileId": ObjectId(),
                "principalType": "club_account",
                "clubId": club_id,
                "credentialUpdatedAt": credential_updated_at - timedelta(seconds=1),
                "expiresAt": datetime.now(timezone.utc) + timedelta(minutes=5),
            }

    credential_updated_at = datetime.now(timezone.utc)
    database = {
        "auth_sessions": SessionCollection(),
        "clubs": FakeCollection([{"_id": club_id, "name": "Robotics Club"}]),
        "clubcredentials": FakeCollection([{
            "clubId": club_id,
            "email": "club@example.edu",
            "passwordHash": "stored-hash",
            "updatedAt": credential_updated_at,
        }]),
    }
    request = SimpleNamespace(
        cookies={auth.SESSION_COOKIE: token},
        app=SimpleNamespace(state=SimpleNamespace(db=database)),
    )

    profile = auth.current_profile(request, auth.Response())

    assert profile["isClubAccount"] is True
    assert profile["verifiedClubId"] == str(club_id)
    assert profile["name"] == "Robotics Club account"
    assert has_verified_club_access(database, str(club_id), profile)
    assert not has_verified_club_access(database, str(ObjectId()), profile)


def test_verified_club_account_can_review_applications_and_view_only_its_roster(monkeypatch):
    class ScopedCollection(FakeCollection):
        @classmethod
        def matches(cls, record, query):
            for key, expected in query.items():
                actual = record.get(key)
                if isinstance(expected, dict):
                    if "$in" in expected and actual not in expected["$in"]:
                        return False
                    if "$ne" in expected and actual == expected["$ne"]:
                        return False
                elif actual != expected:
                    return False
            return True

        def find_one(self, query, projection=None):
            return next((record for record in self.records if self.matches(record, query)), None)

        def find(self, query=None, projection=None):
            return FakeCursor([
                dict(record) for record in self.records
                if self.matches(record, query or {})
            ])

    profile_id = ObjectId()
    club_id = ObjectId()
    other_club_id = ObjectId()
    application_id = ObjectId()
    applications = ScopedCollection([
        {"_id": application_id, "clubId": club_id, "profileId": ObjectId(), "status": "pending"},
        {"_id": ObjectId(), "clubId": other_club_id, "profileId": ObjectId(), "status": "pending"},
    ])
    members = ScopedCollection([
        {"_id": ObjectId(), "clubId": club_id, "profileId": ObjectId(), "membershipStatus": "active", "position": "member"},
        {"_id": ObjectId(), "clubId": other_club_id, "profileId": ObjectId(), "membershipStatus": "active", "position": "member"},
    ])
    database = {
        "clubs": ScopedCollection([
            {"_id": club_id, "name": "Verified club"},
            {"_id": other_club_id, "name": "Other club"},
        ]),
        "clubmembers": members,
        "membershipapplications": applications,
    }
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(db=database)))
    profile = {
        "_id": profile_id,
        "role": "club_committee",
        "verifiedClubId": str(club_id),
        "name": "Club secretary",
        "isClubAccount": True,
    }
    monkeypatch.setattr(club_routes, "populate_many", lambda *_: None)
    monkeypatch.setattr(club_routes, "populate_review_history", lambda *_: None)

    visible_applications = club_routes.list_applications(request, profile=profile)
    assert [application["_id"] for application in visible_applications] == [str(applications.records[0]["_id"])]

    visible_members = club_routes.list_members(request, str(club_id), profile=profile)
    assert len(visible_members) == 1

    reviewed = club_routes.review_application(request, str(application_id), {
        "status": "rejected",
        "rejectionFeedback": "Please try again next recruitment cycle.",
    }, profile)
    assert reviewed["status"] == "rejected"

    with pytest.raises(HTTPException) as application_error:
        club_routes.list_applications(request, str(other_club_id), profile)
    assert application_error.value.status_code == 403
    with pytest.raises(HTTPException) as roster_error:
        club_routes.list_members(request, str(other_club_id), profile=profile)
    assert roster_error.value.status_code == 403


def test_icts_credential_request_stores_encrypted_password_and_applies_it_to_supabase(monkeypatch):
    club_id = ObjectId()
    request_id = ObjectId()
    profile_id = ObjectId()

    class CredentialRequests(FakeCollection):
        def insert_one(self, record):
            stored = dict(record)
            stored["_id"] = ObjectId()
            self.records.append(stored)
            return SimpleNamespace(inserted_id=stored["_id"])

    class ClubCredentials(FakeCollection):
        def update_one(self, query, update, upsert=False):
            record = self.find_one(query)
            inserted = record is None
            if record is None and upsert:
                record = dict(query)
                record["_id"] = ObjectId()
                self.records.append(record)
            if record is None:
                return SimpleNamespace(matched_count=0, modified_count=0)
            if inserted:
                record.update(update.get("$setOnInsert", {}))
            record.update(update.get("$set", {}))
            return SimpleNamespace(matched_count=1, modified_count=1)

    records = CredentialRequests()
    credentials = ClubCredentials()
    auth_sessions = FakeCollection([{
        "principalType": "club_account",
        "clubId": club_id,
    }])
    monkeypatch.setattr(settings, "supabase_service_role_key", "test-service-role-key")
    monkeypatch.setattr(
        club_routes, "create_supabase_user",
        lambda email, password, name: {"id": "new-club-auth-id", "email": email},
    )
    supabase_updates = []
    monkeypatch.setattr(
        club_routes, "update_supabase_user",
        lambda identity, updates: supabase_updates.append((identity, updates)),
    )
    database = {
        "clubs": FakeCollection([{"_id": club_id, "name": "Test club"}]),
        "clubcredentials": credentials,
        "clubcredentialchangerequests": records,
        "auth_sessions": auth_sessions,
    }
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(db=database)))
    plaintext = "new-club-password"
    created = club_routes.request_club_credential_change(request, {
        "clubId": str(club_id),
        "clubLoginEmail": "club@example.edu",
        "clubLoginPassword": plaintext,
    }, {"_id": str(profile_id), "role": "icts"})

    assert "passwordHash" not in created
    assert created["passwordChangeRequested"] is True
    assert records.records[0]["passwordCiphertext"] != plaintext
    assert "passwordHash" not in records.records[0]
    records.records[0]["_id"] = request_id
    with pytest.raises(HTTPException) as error:
        club_routes.review_club_credential_change(
            request,
            str(request_id),
            {"status": "approved"},
            {"_id": str(profile_id), "role": "icts"},
        )
    assert error.value.status_code == 403
    result = club_routes.review_club_credential_change(
        request,
        str(request_id),
        {"status": "approved"},
        {"_id": str(ObjectId()), "role": "college_admin", "adminType": "student_affairs"},
    )
    assert result["message"] == "Credential change request approved."
    assert records.records[0]["status"] == "approved"
    result = club_routes.apply_club_credential_change(
        request,
        str(request_id),
        {"_id": str(profile_id), "role": "icts"},
    )
    assert result["message"] == "Approved club credentials applied."
    assert credentials.records[0]["clubId"] == club_id
    assert credentials.records[0]["email"] == "club@example.edu"
    assert credentials.records[0]["supabaseId"] == "new-club-auth-id"
    assert "passwordHash" not in credentials.records[0]
    assert records.records[0]["status"] == "applied"
    assert "passwordCiphertext" not in records.records[0]
    assert not auth_sessions.records

    changed = club_routes.request_club_credential_change(request, {
        "clubId": str(club_id),
        "clubLoginEmail": "updated@example.edu",
        "clubLoginPassword": "replacement-password",
    }, {"_id": str(profile_id), "role": "icts"})
    changed_id = ObjectId(changed["_id"])
    records.records[-1]["status"] = "approved"
    result = club_routes.apply_club_credential_change(
        request,
        str(changed_id),
        {"_id": str(profile_id), "role": "icts"},
    )
    assert result["message"] == "Approved club credentials applied."
    assert supabase_updates == [("new-club-auth-id", {
        "email": "updated@example.edu",
        "password": "replacement-password",
    })]
    assert credentials.records[0]["email"] == "updated@example.edu"
    assert records.records[-1]["status"] == "applied"


def test_office_bearers_cannot_view_funding_or_report_dashboards(monkeypatch):
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(db={})))
    profile = {"_id": str(ObjectId()), "role": "club_committee"}
    monkeypatch.setattr(campus_routes, "has_office_bearer_membership", lambda *_: True)

    for endpoint in (
        campus_routes.list_funding_requests,
        campus_routes.list_budgets,
        campus_routes.report_summary,
    ):
        with pytest.raises(HTTPException) as error:
            endpoint(request, profile=profile)
        assert error.value.status_code == 403


def test_verified_office_bearer_can_request_funding_equipment_and_view_club_report_counts():
    class RouteCollection(FakeCollection):
        @classmethod
        def matches(cls, record, query):
            for key, expected in query.items():
                if key == "$or":
                    if not any(cls.matches(record, branch) for branch in expected):
                        return False
                    continue
                actual = record.get(key)
                if isinstance(expected, dict):
                    if "$in" in expected and actual not in expected["$in"]:
                        return False
                    if "$ne" in expected and actual == expected["$ne"]:
                        return False
                elif actual != expected:
                    return False
            return True

        def find_one(self, query, projection=None):
            return next((record for record in self.records if self.matches(record, query)), None)

        def find(self, query=None, projection=None):
            return FakeCursor([
                dict(record) for record in self.records
                if self.matches(record, query or {})
            ])

        def count_documents(self, query):
            return sum(self.matches(record, query) for record in self.records)

        def update_many(self, query, update):
            return SimpleNamespace(matched_count=0, modified_count=0)

    profile_id = ObjectId()
    club_id = ObjectId()
    other_club_id = ObjectId()
    event_id = ObjectId()
    membership = {
        "clubId": club_id,
        "profileId": profile_id,
        "membershipStatus": "active",
        "position": "secretary",
    }
    database = {
        "clubs": RouteCollection([
            {"_id": club_id, "name": "Verified club", "category": "Technical", "mentor": ObjectId()},
            {"_id": other_club_id, "name": "Other club", "category": "Community", "mentor": ObjectId()},
        ]),
        "clubmembers": RouteCollection([membership]),
        "fundingrequests": RouteCollection(),
        "equipment": RouteCollection([{
            "_id": ObjectId(),
            "clubId": club_id,
            "name": "Camera",
            "availableQuantity": 1,
        }]),
        "equipmentborrows": RouteCollection(),
        "clubbudgets": RouteCollection(),
        "members": RouteCollection([membership]),
        "events": RouteCollection([{"_id": event_id, "clubId": club_id, "title": "Club workshop"}]),
        "membershipapplications": RouteCollection(),
        "eventreports": RouteCollection([
            {"_id": ObjectId(), "clubId": club_id},
            {"_id": ObjectId(), "clubId": club_id},
        ]),
        "announcements": RouteCollection(),
    }
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(db=database)))
    profile = {
        "_id": str(profile_id),
        "role": "club_committee",
        "verifiedClubId": str(club_id),
    }

    funding = campus_routes.create_funding_request(request, {
        "clubId": str(club_id),
        "eventId": str(event_id),
        "requestedAmount": 2500,
        "purpose": "Workshop materials",
    }, profile)
    assert funding["clubId"] == str(club_id)
    assert funding["eventId"] == str(event_id)
    with pytest.raises(HTTPException) as unrelated_event_error:
        campus_routes.create_funding_request(request, {
            "clubId": str(club_id),
            "eventId": str(ObjectId()),
            "requestedAmount": 500,
            "purpose": "Unrelated event",
        }, profile)
    assert unrelated_event_error.value.status_code == 404

    equipment_id = str(database["equipment"].records[0]["_id"])
    borrow = campus_routes.request_borrow(request, {
        "clubId": str(club_id),
        "equipmentId": equipment_id,
        "eventId": str(event_id),
        "dueDate": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
        "purpose": "Club workshop",
    }, profile)
    assert borrow["status"] == "mentor_pending"
    assert borrow["purpose"] == "Club workshop"

    summary = campus_routes.report_summary(request, profile)
    assert summary["reportsSubmitted"] == 2
    assert summary["clubReports"][0]["reportsSubmitted"] == 2
    assert summary["clubReports"][0]["name"] == "Verified club"

    with pytest.raises(HTTPException) as funding_error:
        campus_routes.create_funding_request(request, {
            "clubId": str(other_club_id),
            "eventId": str(event_id),
            "requestedAmount": 1000,
            "purpose": "Out of scope",
        }, profile)
    assert funding_error.value.status_code == 403

    with pytest.raises(HTTPException) as equipment_error:
        campus_routes.request_borrow(request, {
            "clubId": str(other_club_id),
            "equipmentId": equipment_id,
            "eventId": str(event_id),
            "dueDate": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
        }, profile)
    assert equipment_error.value.status_code == 403


def test_verified_club_dashboard_data_is_scoped_to_the_verified_club(monkeypatch):
    class QuerySpy:
        def __init__(self):
            self.query = None

        def find(self, query=None, projection=None):
            self.query = query
            return FakeCursor()

    club_id = ObjectId()
    events = QuerySpy()
    equipment = QuerySpy()
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(db={
        "events": events,
        "equipment": equipment,
    })))
    profile = {
        "_id": str(ObjectId()),
        "role": "club_committee",
        "verifiedClubId": str(club_id),
    }
    monkeypatch.setattr(campus_routes, "has_verified_club_access", lambda *_: True)
    monkeypatch.setattr(event_routes, "has_verified_club_access", lambda *_: True)
    monkeypatch.setattr(event_routes, "populate_many", lambda *args, **kwargs: None)
    monkeypatch.setattr(event_routes, "populate_review_history", lambda *args, **kwargs: None)
    monkeypatch.setattr(campus_routes, "populate_many", lambda *args, **kwargs: None)

    event_routes.manage_events(request, profile)
    campus_routes.list_equipment(request, profile=profile)

    expected = {"$or": [
        {"clubId": {"$in": [club_id]}},
        {"coHostIds": {"$in": [club_id]}},
    ]}
    assert events.query == expected
    assert equipment.query == {"clubId": club_id}
    with pytest.raises(HTTPException) as error:
        campus_routes.list_equipment(request, str(ObjectId()), profile)
    assert error.value.status_code == 403


def test_campus_directory_matches_requested_venues_clubs_and_event_organizers():
    assert len(VENUES) == 8
    assert len(CLUBS) == 56
    assert "Squad - Patriotism and Adventure Club" in CLUBS
    assert len(EVENT_ORGANIZERS) == 16
    assert "DASTHAN" in EVENT_ORGANIZERS
    assert "Aarohan - Science Fair" in EVENT_ORGANIZERS
    assert {f"Freshers - {department}" for department in (
        "CSE", "AIE", "AID", "ECE", "EAC", "EEE", "ELC", "MEE",
        "MAT", "PHY", "CHE", "ENG", "MBA", "CIR",
    )} <= set(EVENT_ORGANIZERS)
    assert set(CLUB_MENTORS) == set(CLUBS)
    assert CLUB_MENTORS["IEEE Sensors Council"] == []


def test_creating_a_named_faculty_account_assigns_them_to_every_club_in_the_directory():
    profile_id = ObjectId()
    assigned = {
        "_id": ObjectId(),
        "mentorDirectory": [
            {"name": "Dr. Reena Panwar", "affiliation": "SOC"},
            {"name": "Other Faculty", "affiliation": "CSE"},
        ],
        "mentorIds": [],
    }
    other_club = {"_id": ObjectId(), "mentorDirectory": [{"name": "Someone Else"}], "mentorIds": []}

    class Clubs:
        def find(self, _query):
            return [assigned, other_club]

        def update_one(self, query, update):
            club = next(record for record in (assigned, other_club) if record["_id"] == query["_id"])
            identity = update["$addToSet"]["mentorIds"]
            if identity not in club["mentorIds"]:
                club["mentorIds"].append(identity)

    sync_mentor_accounts(
        {"clubs": Clubs()},
        {"_id": profile_id, "name": "Dr Reena PANWAR", "role": "faculty_coordinator"},
    )
    assert assigned["mentorIds"] == [profile_id]
    assert other_club["mentorIds"] == []


def test_icts_can_edit_faculty_details_and_issue_a_new_password(monkeypatch):
    identity = ObjectId()
    profile_record = {
        "_id": identity,
        "supabaseId": "faculty-auth-id",
        "name": "Faculty Member",
        "email": "faculty@example.edu",
        "role": "faculty_coordinator",
        "department": "ECE",
        "joiningYear": 2026,
        "facultyId": "FA26ECE001",
    }
    profiles = FakeCollection([profile_record])
    counters = FakeCollection()
    sessions = FakeCollection([{"profileId": identity, "tokenHash": "session-hash"}])
    db = {"profiles": profiles, "counters": counters, "clubs": FakeCollection(), "auth_sessions": sessions}
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(db=db)))
    updates = []
    monkeypatch.setattr(profile_routes, "update_supabase_user", lambda auth_id, body: updates.append((auth_id, body)))

    result = profile_routes.update_profile(
        request,
        str(identity),
        {
            "name": "Updated Faculty",
            "email": "updated@example.edu",
            "role": "faculty_coordinator",
            "department": "PHY",
            "joiningYear": 2026,
            "password": "another-safe-password",
        },
        {"supabaseId": "icts-auth-id", "role": "icts"},
    )

    assert result["name"] == "Updated Faculty"
    assert result["email"] == "updated@example.edu"
    assert result["facultyId"] == "FA26PHY001"
    assert updates[0][0] == "faculty-auth-id"
    assert updates[0][1]["password"] == "another-safe-password"
    assert sessions.records == []


def test_password_reset_sends_and_verifies_recovery_otp(monkeypatch):
    profile_id = ObjectId()
    calls = []

    class SupabaseResponse:
        def __init__(self, payload, success=True):
            self.payload = payload
            self.is_success = success
            self.status_code = 200 if success else 400

        def json(self):
            return self.payload

    responses = [
        SupabaseResponse({}),
        SupabaseResponse({"access_token": "recovery-access-token"}),
        SupabaseResponse({"id": "faculty-auth-id"}),
    ]

    def fake_supabase_request(method, path, **kwargs):
        calls.append((method, path, kwargs))
        return responses.pop(0)

    sessions = FakeCollection([{"profileId": profile_id, "tokenHash": "active-session"}])
    db = {"profiles": FakeCollection([{"_id": profile_id, "email": "faculty@example.edu"}]), "auth_sessions": sessions}
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(db=db)))
    monkeypatch.setattr(auth_routes, "supabase_request", fake_supabase_request)

    assert auth_routes.request_password_reset({"email": " Faculty@Example.edu "})["message"].startswith("If an account exists")
    result = auth_routes.confirm_password_reset(
        request,
        {"email": "faculty@example.edu", "otp": "123456", "password": "new-safe-password"},
    )

    assert result["message"].startswith("Password reset complete")
    assert calls[0][1] == "/auth/v1/recover"
    assert calls[1][2]["json"]["type"] == "recovery"
    assert calls[2][2]["headers"]["Authorization"] == "Bearer recovery-access-token"
    assert calls[2][2]["json"]["password"] == "new-safe-password"
    assert sessions.records == []


def test_event_cohosts_are_validated_and_deduplicated():
    primary_id = ObjectId()
    cohost_id = ObjectId()
    clubs = FakeCollection([
        {"_id": primary_id, "organizationType": "club"},
        {"_id": cohost_id, "organizationType": "club"},
    ])
    parsed = event_routes.parse_cohost_ids({"clubs": clubs}, [str(cohost_id), str(primary_id), str(cohost_id)], primary_id)
    assert parsed == [cohost_id]


def test_only_student_affairs_can_add_event_organizers_as_cohosts():
    primary_id = ObjectId()
    organizer_id = ObjectId()
    clubs = FakeCollection([
        {"_id": primary_id, "organizationType": "club"},
        {"_id": organizer_id, "organizationType": "event_organizer"},
    ])
    with pytest.raises(HTTPException) as error:
        event_routes.parse_cohost_ids({"clubs": clubs}, [str(organizer_id)], primary_id)
    assert error.value.status_code == 403
    assert event_routes.parse_cohost_ids(
        {"clubs": clubs}, [str(organizer_id)], primary_id, allow_organizers=True
    ) == [organizer_id]


def test_student_affairs_can_create_events_for_campus_organizers(monkeypatch):
    organizer_id = ObjectId()
    venue_id = ObjectId()
    stored = []
    database = {
        "clubs": FakeCollection([{
            "_id": organizer_id,
            "name": "DASTHAN",
            "organizationType": "event_organizer",
            "clubType": "non_technical",
        }]),
        "venues": FakeCollection([{"_id": venue_id, "isAvailable": True}]),
        "events": FakeCollection(),
    }
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(db=database)))
    monkeypatch.setattr(event_routes, "find_venue_conflict", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        event_routes,
        "insert",
        lambda _db, _name, values: stored.append(values) or {"_id": str(ObjectId()), **values},
    )
    body = {
        "title": "DASTHAN",
        "eventDate": "2026-11-01T17:00",
        "endDate": "2026-11-01T19:00",
        "clubId": str(organizer_id),
        "venueId": str(venue_id),
        "eventType": "technical",
        "technicalDetails": {
            "eventCategory": "flagship_intercollege",
            "programDrivenBy": "iic_calendar_activity",
            "quarter": "Q2",
            "internalParticipants": 35,
        },
    }

    result = event_routes.create_event(
        request,
        body,
        {"_id": str(ObjectId()), "role": "college_admin", "adminType": "student_affairs"},
    )

    assert result["status"] == "student_affairs_pending"
    assert stored[0]["clubId"] == organizer_id
    assert stored[0]["technicalDetails"]["eventCategory"] == "flagship_intercollege"
    with pytest.raises(HTTPException) as error:
        event_routes.create_event(request, body, {"_id": str(ObjectId()), "role": "student"})
    assert error.value.status_code == 403


def test_technical_event_details_are_validated_and_normalized():
    details = event_routes.parse_technical_details({
        "technicalDetails": {
            "eventCategory": "flagship_intercollege",
            "quarter": "Q2",
            "internalParticipants": "24",
            "estimatedBudget": "12500",
            "programOutcomes": ["PO1", "PO3", "PO1"],
            "sdgGoals": [4, 9],
        },
    }, "technical")

    assert details == {
        "eventCategory": "flagship_intercollege",
        "quarter": "Q2",
        "programOutcomes": ["PO1", "PO3"],
        "sdgGoals": [4, 9],
        "internalParticipants": 24,
        "estimatedBudget": 12500,
    }
    with pytest.raises(HTTPException) as nontechnical_error:
        event_routes.parse_technical_details({"technicalDetails": {"quarter": "Q1"}}, "non_technical")
    assert nontechnical_error.value.status_code == 400
    with pytest.raises(HTTPException) as invalid_error:
        event_routes.parse_technical_details({"technicalDetails": {"quarter": "Q5"}}, "technical")
    assert invalid_error.value.status_code == 400


def test_only_student_affairs_can_review_second_stage_equipment_borrows():
    borrow_id = ObjectId()
    club_id = ObjectId()
    equipment_id = ObjectId()
    mentor_id = ObjectId()
    borrow_records = [{
        "_id": borrow_id,
        "clubId": club_id,
        "equipmentId": equipment_id,
        "status": "mentor_pending",
        "rejectionFeedback": "",
        "reviewHistory": [],
    }]
    equipment_records = [{"_id": equipment_id, "availableQuantity": 1}]

    class BorrowCollection(FakeCollection):
        def replace_one(self, query, record):
            self.records = [record if item["_id"] == query["_id"] else item for item in self.records]

    class EquipmentCollection(FakeCollection):
        def find_one_and_update(self, query, update, **kwargs):
            record = next((item for item in self.records if item["_id"] == query["_id"] and item["availableQuantity"] > 0), None)
            if record:
                record["availableQuantity"] += update["$inc"]["availableQuantity"]
            return record

    database = {
        "equipmentborrows": BorrowCollection(borrow_records),
        "clubs": FakeCollection([{"_id": club_id, "mentor": mentor_id}]),
        "equipment": EquipmentCollection(equipment_records),
    }
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(db={
        **database,
    })))
    mentor = {"_id": str(mentor_id), "role": "faculty_coordinator", "name": "Club mentor"}
    forwarded = campus_routes.approve_borrow(request, str(borrow_id), {"status": "approved"}, mentor)
    assert forwarded["status"] == "student_affairs_pending"

    icts_admin = {"_id": str(ObjectId()), "role": "college_admin", "adminType": "icts"}
    with pytest.raises(HTTPException) as error:
        campus_routes.approve_borrow(request, str(borrow_id), {"status": "approved"}, icts_admin)
    assert error.value.status_code == 403

    affairs = {"_id": str(ObjectId()), "role": "college_admin", "adminType": "student_affairs"}
    approved = campus_routes.approve_borrow(request, str(borrow_id), {"status": "approved"}, affairs)
    assert approved["status"] == "borrowed"
    assert equipment_records[0]["availableQuantity"] == 0


def test_student_roll_numbers_include_school_and_section_sequences():
    counters = FakeCollection()
    db = {"counters": counters}

    assert student_register_number(db, "SC", "CSE", 2025, "C") == "BL.SC.U4CSE25201"
    assert student_register_number(db, "SC", "CSE", 2025, "C") == "BL.SC.U4CSE25202"
    assert student_register_number(db, "SC", "CSE", 2025, "A") == "BL.SC.U4CSE25001"


def test_student_roll_numbers_follow_department_sections_and_offsets():
    cases = [
        ("CSE", "A", "SC", "BL.SC.U4CSE26001"),
        ("CSE", "B", "SC", "BL.SC.U4CSE26101"),
        ("CSE", "C", "SC", "BL.SC.U4CSE26201"),
        ("AIE", "D", "SC", "BL.SC.U4AIE26001"),
        ("AIE", "E", "SC", "BL.SC.U4AIE26101"),
        ("AIE", "F", "SC", "BL.SC.U4AIE26201"),
        ("AID", "G", "SC", "BL.SC.U4AID26001"),
        ("ECE", "H", "EN", "BL.EN.U4ECE26001"),
        ("ECE", "I", "EN", "BL.EN.U4ECE26101"),
        ("ECE", "J", "EN", "BL.EN.U4ECE26201"),
        ("EAC", "K", "EN", "BL.EN.U4EAC26001"),
        ("EEE", "L", "EN", "BL.EN.U4EEE26001"),
        ("ELC", "M", "EN", "BL.EN.U4ELC26001"),
        ("MEE", "N", "EN", "BL.EN.U4MEE26001"),
    ]
    for department, section, school_code, expected in cases:
        assert student_register_number(
            {"counters": FakeCollection()},
            school_code,
            department,
            2026,
            section,
        ) == expected

    with pytest.raises(HTTPException) as error:
        student_register_number({"counters": FakeCollection()}, "SC", "AID", 2026, "A")
    assert error.value.status_code == 400


def test_faculty_account_uses_allowed_department_for_faculty_id(monkeypatch):
    profiles = FakeCollection()
    counters = FakeCollection()
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(db={
        "profiles": profiles,
        "counters": counters,
        "clubs": FakeCollection(),
    })))
    monkeypatch.setattr(profile_routes, "create_supabase_user", lambda *args: {"id": "faculty-auth-id"})

    created = profile_routes.create_profile(request, {
        "name": "Faculty Member",
        "email": "faculty@example.edu",
        "password": "safe-test-password",
        "role": "faculty_coordinator",
        "department": "ECE",
        "joiningYear": 2026,
    }, {"_id": str(ObjectId()), "role": "icts"})
    assert created["department"] == "ECE"
    assert created["facultyId"] == "FA26ECE001"

    with pytest.raises(HTTPException) as error:
        profile_routes.create_profile(request, {
            "name": "Faculty Member",
            "email": "another-faculty@example.edu",
            "password": "safe-test-password",
            "role": "faculty_coordinator",
            "department": "AIE",
            "joiningYear": 2026,
        }, {"_id": str(ObjectId()), "role": "icts"})
    assert error.value.status_code == 400


def test_od_roster_contains_only_name_and_roll_number():
    profile_id = ObjectId()
    event_id = ObjectId()
    database = {
        "attendances": FakeCollection([{
            "eventId": event_id,
            "profileId": profile_id,
            "status": "present",
            "checkInTime": datetime(2026, 1, 1, tzinfo=timezone.utc),
        }]),
        "profiles": FakeCollection([{
            "_id": profile_id,
            "name": "A Student",
            "email": "student@example.edu",
            "registerNumber": "BL.SC.U4CSE25204",
        }]),
    }

    roster = build_attendance_roster(database, event_id, "Campus Event")

    assert roster["attendeeCount"] == 1
    assert roster["rosterCsv"] == "Name,Roll number\r\nA Student,BL.SC.U4CSE25204"


def test_only_the_host_club_account_can_take_or_update_attendance():
    club_id = ObjectId()
    event_id = ObjectId()
    participant_id = ObjectId()
    attendance_id = ObjectId()
    database = {
        "events": FakeCollection([{"_id": event_id, "clubId": club_id, "status": "approved"}]),
        "eventregistrations": FakeCollection([{
            "_id": ObjectId(),
            "eventId": event_id,
            "profileId": participant_id,
            "status": "registered",
        }]),
        "attendances": FakeCollection([{
            "_id": attendance_id,
            "eventId": event_id,
            "profileId": participant_id,
            "status": "present",
        }]),
    }
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(db=database)))
    admin = {"_id": str(ObjectId()), "role": "college_admin", "adminType": "student_affairs"}

    with pytest.raises(HTTPException) as error:
        event_routes.mark_attendance(request, {
            "eventId": str(event_id),
            "profileId": str(participant_id),
            "status": "present",
        }, admin)
    assert error.value.status_code == 403

    club_account = {
        "_id": str(ObjectId()),
        "role": "club_committee",
        "isClubAccount": True,
        "verifiedClubId": str(club_id),
    }
    marked = event_routes.mark_attendance(request, {
        "eventId": str(event_id),
        "profileId": str(participant_id),
        "status": "present",
    }, club_account)
    assert marked["eventId"] == str(event_id)

    with pytest.raises(HTTPException) as update_error:
        event_routes.update_attendance(request, str(attendance_id), {"status": "absent"}, admin)
    assert update_error.value.status_code == 403
    updated = event_routes.update_attendance(request, str(attendance_id), {"status": "absent"}, club_account)
    assert updated["status"] == "absent"


def test_mentor_review_started_detects_partial_review():
    assert not mentor_review_started({"mentorApprovals": [{"status": "pending"}]})
    assert mentor_review_started({"mentorApprovals": [{"status": "approved"}, {"status": "pending"}]})
    assert mentor_review_started({"mentorReviewedBy": ObjectId()})


def test_host_club_account_can_view_event_registrations():
    club_id, event_id, participant_id = ObjectId(), ObjectId(), ObjectId()
    database = {
        "events": FakeCollection([{"_id": event_id, "clubId": club_id}]),
        "clubs": FakeCollection([{"_id": club_id}]),
        "clubmembers": FakeCollection(),
        "eventregistrations": FakeCollection([{
            "_id": ObjectId(),
            "eventId": event_id,
            "profileId": participant_id,
            "status": "registered",
        }]),
        "profiles": FakeCollection([{
            "_id": participant_id,
            "name": "Registered Student",
            "email": "student@example.edu",
        }]),
    }
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(db=database)))
    club_account = {
        "_id": str(ObjectId()),
        "role": "club_committee",
        "isClubAccount": True,
        "verifiedClubId": str(club_id),
    }

    registrations = event_routes.list_registrations(request, str(event_id), club_account)

    assert len(registrations) == 1
    assert registrations[0]["profileId"]["name"] == "Registered Student"

    other_club_account = {**club_account, "verifiedClubId": str(ObjectId())}
    with pytest.raises(HTTPException) as error:
        event_routes.list_registrations(request, str(event_id), other_club_account)
    assert error.value.status_code == 403


def test_club_account_can_download_its_event_attendance_roster():
    club_id, event_id, report_id, participant_id = (ObjectId() for _ in range(4))
    database = {
        "clubs": FakeCollection([{"_id": club_id}]),
        "eventreports": FakeCollection([{
            "_id": report_id, "clubId": club_id, "eventId": event_id,
            "rosterFileName": "campus-event-od-attendance.csv",
        }]),
        "events": FakeCollection([{"_id": event_id, "title": "Campus Event"}]),
        "attendances": FakeCollection([{
            "eventId": event_id, "profileId": participant_id, "status": "present",
            "checkInTime": datetime(2026, 1, 1, tzinfo=timezone.utc),
        }]),
        "profiles": FakeCollection([{
            "_id": participant_id, "name": "Registered Student", "registerNumber": "BL.SC.U4CSE25204",
        }]),
    }
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(db=database)))
    club_account = {
        "_id": str(ObjectId()), "role": "club_committee", "isClubAccount": True,
        "verifiedClubId": str(club_id),
    }

    response = event_routes.download_roster(request, str(report_id), club_account)

    assert response.status_code == 200
    assert response.body.decode() == "Name,Roll number\r\nRegistered Student,BL.SC.U4CSE25204"

    other_club_account = {**club_account, "verifiedClubId": str(ObjectId())}
    with pytest.raises(HTTPException) as error:
        event_routes.download_roster(request, str(report_id), other_club_account)
    assert error.value.status_code == 403


def test_club_account_can_edit_report_until_mentor_review_starts(monkeypatch):
    club_id, event_id, report_id = ObjectId(), ObjectId(), ObjectId()
    mentor_id = ObjectId()
    reports = FakeCollection([{
        "_id": report_id,
        "clubId": club_id,
        "eventId": event_id,
        "status": "mentor_pending",
        "summary": "Initial summary",
        "mentorApprovals": [{"clubId": club_id, "mentorId": mentor_id, "status": "pending"}],
    }])
    database = {
        "eventreports": reports,
        "events": FakeCollection([{"_id": event_id, "title": "Campus Event"}]),
        "clubs": FakeCollection([{"_id": club_id, "mentor": mentor_id}]),
        "clubmembers": FakeCollection(),
        "attendances": FakeCollection(),
        "profiles": FakeCollection(),
    }
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(db=database)))
    club_account = {
        "_id": str(ObjectId()), "role": "club_committee", "isClubAccount": True,
        "verifiedClubId": str(club_id),
    }
    monkeypatch.setattr(reports, "replace_one", lambda query, record: None, raising=False)

    updated = event_routes.resubmit_event_report(
        request, str(report_id), {"summary": "Updated summary"}, club_account
    )
    assert updated["summary"] == "Updated summary"
    assert updated["status"] == "mentor_pending"

    reports.records[0]["mentorApprovals"][0]["status"] = "approved"
    with pytest.raises(HTTPException) as error:
        event_routes.resubmit_event_report(
            request, str(report_id), {"summary": "Too late"}, club_account
        )
    assert error.value.status_code == 409


def test_club_account_can_edit_funding_and_equipment_requests_before_mentor_review():
    club_id, event_id, equipment_id = ObjectId(), ObjectId(), ObjectId()
    funding_id, borrow_id = ObjectId(), ObjectId()
    funding = FakeCollection([{
        "_id": funding_id, "clubId": club_id, "status": "mentor_pending",
        "requestedAmount": 100, "purpose": "Materials",
        "mentorApprovals": [{"status": "pending"}],
    }])
    borrows = FakeCollection([{
        "_id": borrow_id, "clubId": club_id, "eventId": event_id, "equipmentId": equipment_id,
        "status": "mentor_pending", "purpose": "Workshop", "dueDate": datetime(2027, 1, 1, tzinfo=timezone.utc),
        "mentorApprovals": [{"status": "pending"}],
    }])
    database = {"fundingrequests": funding, "equipmentborrows": borrows}
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(db=database)))
    club_account = {
        "_id": str(ObjectId()), "role": "club_committee", "isClubAccount": True,
        "verifiedClubId": str(club_id),
    }

    edited_funding = campus_routes.edit_funding_request(
        request, str(funding_id), {"requestedAmount": 250, "purpose": "Updated materials"}, club_account
    )
    assert edited_funding["requestedAmount"] == 250
    assert edited_funding["purpose"] == "Updated materials"

    edited_borrow = campus_routes.edit_borrow_request(
        request, str(borrow_id), {"purpose": "Updated workshop", "dueDate": "2027-02-01T23:59:00+00:00"},
        club_account,
    )
    assert edited_borrow["purpose"] == "Updated workshop"
    assert edited_borrow["dueDate"].startswith("2027-02-01")

    funding.records[0]["mentorApprovals"][0]["status"] = "approved"
    borrows.records[0]["mentorApprovals"][0]["status"] = "approved"
    with pytest.raises(HTTPException) as funding_error:
        campus_routes.edit_funding_request(request, str(funding_id), {"purpose": "Too late"}, club_account)
    assert funding_error.value.status_code == 409
    with pytest.raises(HTTPException) as borrow_error:
        campus_routes.edit_borrow_request(request, str(borrow_id), {"purpose": "Too late"}, club_account)
    assert borrow_error.value.status_code == 409


def test_funding_request_requires_both_review_stages_before_ledger_allocation():
    request_id = ObjectId()
    club_id = ObjectId()
    mentor_id = ObjectId()
    affairs_id = ObjectId()
    budget_id = ObjectId()
    funding = FakeCollection([{
        "_id": request_id,
        "clubId": club_id,
        "requestedAmount": 250,
        "purpose": "Workshop materials",
        "status": "mentor_pending",
    }])
    budgets = FakeCollection([{"_id": budget_id, "clubId": club_id, "academicYear": "2026-2027", "totalAllocated": 500}])
    transactions = FakeCollection()
    db = {
        "fundingrequests": funding,
        "clubs": FakeCollection([{"_id": club_id, "mentor": mentor_id}]),
        "clubbudgets": budgets,
        "budgettransactions": transactions,
    }
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(db=db)))
    mentor = {"_id": str(mentor_id), "role": "faculty_coordinator"}
    affairs = {"_id": str(affairs_id), "role": "college_admin", "adminType": "student_affairs"}

    with pytest.raises(HTTPException) as error:
        review_funding_request(request, str(request_id), {"status": "rejected"}, mentor)
    assert error.value.status_code == 400

    forwarded = review_funding_request(request, str(request_id), {"status": "approved"}, mentor)
    assert forwarded["status"] == "student_affairs_pending"
    assert budgets.records[0]["totalAllocated"] == 500
    assert transactions.records == []

    approved = review_funding_request(request, str(request_id), {"status": "approved"}, affairs)
    assert approved["status"] == "approved"
    assert budgets.records[0]["totalAllocated"] == 750
    assert len(transactions.records) == 1


def test_office_bearers_cannot_view_transactions(monkeypatch):
    club_id = ObjectId()
    office_bearer_id = ObjectId()
    records = [
        {"_id": ObjectId(), "clubId": club_id, "type": "debit", "amount": 1200, "description": "Workshop supplies"},
        {"_id": ObjectId(), "clubId": ObjectId(), "type": "debit", "amount": 500, "description": "Other club"},
    ]

    class TransactionCollection:
        def find(self, query):
            visible_ids = query["clubId"]["$in"]
            return FakeCursor([item for item in records if item["clubId"] in visible_ids])

    db = {"budgettransactions": TransactionCollection()}
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(db=db)))
    monkeypatch.setattr(
        campus_routes,
        "visible_club_ids",
        lambda database, profile, positions=None: [club_id] if profile["_id"] == str(office_bearer_id) else [],
    )
    monkeypatch.setattr(campus_routes, "populate_many", lambda *args, **kwargs: None)

    with pytest.raises(HTTPException) as error:
        campus_routes.list_transactions(request, {"_id": str(office_bearer_id), "role": "student"})
    assert error.value.status_code == 403


def test_office_bearers_need_shared_verification_to_propose_events_or_submit_event_reports(monkeypatch):
    profile_id = ObjectId()
    club_id = ObjectId()
    venue_id = ObjectId()
    report_event_id = ObjectId()
    now = datetime.now(timezone.utc)
    club = {"_id": club_id, "clubType": "technical", "mentor": ObjectId()}
    membership = {
        "clubId": club_id,
        "profileId": profile_id,
        "membershipStatus": "active",
        "position": "secretary",
    }
    events = FakeCollection([{
        "_id": report_event_id,
        "clubId": club_id,
        "status": "approved",
        "eventDate": now.replace(year=now.year - 1),
        "title": "Past workshop",
    }])
    db = {
        "clubs": FakeCollection([club]),
        "clubmembers": FakeCollection([membership]),
        "venues": FakeCollection([{"_id": venue_id, "isAvailable": True}]),
        "events": events,
        "eventreports": FakeCollection(),
        "attendances": FakeCollection(),
        "profiles": FakeCollection(),
    }
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(db=db)))
    office_bearer = {"_id": str(profile_id), "role": "student"}
    monkeypatch.setattr(event_routes, "find_venue_conflict", lambda *args, **kwargs: False)
    start = now.replace(year=now.year + 1)
    with pytest.raises(HTTPException) as proposal_error:
        event_routes.create_event(request, {
            "title": "Club workshop",
            "eventDate": start.isoformat(),
            "endDate": (start + timedelta(hours=2)).isoformat(),
            "clubId": str(club_id),
            "venueId": str(venue_id),
        }, office_bearer)
    assert proposal_error.value.status_code == 403
    with pytest.raises(HTTPException) as report_error:
        event_routes.submit_event_report(request, str(report_event_id), {
            "summary": "A completed workshop",
            "activities": "Hands-on sessions",
            "outcomes": "Participants learned new skills",
        }, office_bearer)
    assert report_error.value.status_code == 403

    verified_office_bearer = {**office_bearer, "verifiedClubId": str(club_id)}
    proposal = event_routes.create_event(request, {
        "title": "Verified club workshop",
        "eventDate": start.isoformat(),
        "endDate": (start + timedelta(hours=2)).isoformat(),
        "clubId": str(club_id),
        "venueId": str(venue_id),
    }, verified_office_bearer)
    assert proposal["status"] == "mentor_pending"
    updated_proposal = event_routes.edit_event(
        request, proposal["_id"], {"title": "Updated verified club workshop"}, verified_office_bearer
    )
    assert updated_proposal["title"] == "Updated verified club workshop"

    report = event_routes.submit_event_report(request, str(report_event_id), {
        "summary": "A completed workshop",
        "activities": "Hands-on sessions",
        "outcomes": "Participants learned new skills",
    }, verified_office_bearer)
    assert report["status"] == "mentor_pending"
    stored_report = db["eventreports"].records[0]
    stored_report["status"] = "rejected"
    monkeypatch.setattr(db["eventreports"], "replace_one", lambda *args: None, raising=False)
    revised_report = event_routes.resubmit_event_report(
        request, report["_id"], {"summary": "Revised event summary"}, verified_office_bearer
    )
    assert revised_report["status"] == "mentor_pending"


def test_event_remains_editable_until_mentor_review(monkeypatch):
    profile_id = ObjectId()
    club_id = ObjectId()
    event_id = ObjectId()
    venue_id = ObjectId()
    start = datetime.now(timezone.utc) + timedelta(days=3)
    event = {
        "_id": event_id,
        "clubId": club_id,
        "status": "mentor_pending",
        "eventDate": start,
        "endDate": start + timedelta(hours=1),
        "venueId": venue_id,
        "capacity": 50,
        "title": "Original title",
    }

    class EventCollection(FakeCollection):
        def find(self, query=None):
            return FakeCursor()

    database = {
        "events": EventCollection([event]),
        "clubs": FakeCollection([{"_id": club_id, "organizationType": "club"}]),
        "clubmembers": FakeCollection(),
        "venues": FakeCollection([{"_id": venue_id, "isAvailable": True}]),
    }
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(db=database)))
    profile = {"_id": str(profile_id), "role": "student"}
    monkeypatch.setattr(
        event_routes,
        "active_membership",
        lambda *_: {"position": "executive", "membershipStatus": "active"},
    )

    updated = event_routes.edit_event(request, str(event_id), {
        "title": "Updated title",
        "capacity": "75",
    }, profile)
    assert updated["title"] == "Updated title"
    assert updated["capacity"] == 75
    assert updated["status"] == "mentor_pending"

    event["mentorReviewedBy"] = ObjectId()
    with pytest.raises(HTTPException) as error:
        event_routes.edit_event(request, str(event_id), {"title": "Too late"}, profile)
    assert error.value.status_code == 409


def test_office_bearer_cannot_remove_club_member(monkeypatch):
    office_bearer_id = ObjectId()
    member_id = ObjectId()
    club_id = ObjectId()
    member = {"_id": member_id, "clubId": club_id, "profileId": ObjectId()}
    database = {
        "clubmembers": FakeCollection([member]),
        "clubs": FakeCollection([{"_id": club_id, "mentor": ObjectId()}]),
    }
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(db=database)))
    monkeypatch.setattr(
        club_routes,
        "active_membership",
        lambda *_: {"position": "president", "membershipStatus": "active"},
    )

    with pytest.raises(HTTPException) as error:
        club_routes.delete_member(
            request,
            str(member_id),
            {"_id": str(office_bearer_id), "role": "student"},
        )
    assert error.value.status_code == 403
    assert "membershipStatus" not in database["clubmembers"].records[0]


def test_approving_new_application_reactivates_ended_membership():
    reviewer_id = ObjectId()
    club_id = ObjectId()
    profile_id = ObjectId()
    application_id = ObjectId()
    member_id = ObjectId()
    application = {
        "_id": application_id,
        "clubId": club_id,
        "profileId": profile_id,
        "status": "pending",
        "requestedPosition": "member",
    }
    member = {
        "_id": member_id,
        "clubId": club_id,
        "profileId": profile_id,
        "position": "president",
        "membershipStatus": "ended",
        "endedBy": ObjectId(),
        "endedAt": datetime.now(timezone.utc),
        "membershipHistory": [{"action": "ended"}],
    }
    database = {
        "membershipapplications": FakeCollection([application]),
        "clubs": FakeCollection([{"_id": club_id, "mentor": reviewer_id}]),
        "clubmembers": FakeCollection([member]),
    }
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(db=database)))

    result = club_routes.review_application(
        request,
        str(application_id),
        {"status": "approved"},
        {"_id": str(reviewer_id), "role": "faculty_coordinator"},
    )

    assert result["status"] == "approved"
    assert member["membershipStatus"] == "active"
    assert member["position"] == "member"
    assert "endedAt" not in member and "endedBy" not in member
    assert [entry["action"] for entry in member["membershipHistory"]] == ["ended", "reactivated"]
    assert member["membershipHistory"][-1]["applicationId"] == application_id
