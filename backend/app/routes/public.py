from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from ..database import serialize_document
from ..services.common import collection, populate_club_mentors, populate_many


router = APIRouter()


@router.get("/health")
def health(request: Request):
    connected = request.app.state.db is not None
    return JSONResponse(
        status_code=200 if connected else 503,
        content={
            "status": "ok" if connected else "database_unavailable",
            "database": "connected" if connected else "disconnected",
        },
    )


@router.get("/clubs")
def list_clubs(request: Request):
    db = request.app.state.db
    clubs = list(collection(db, "clubs").find({"organizationType": {"$ne": "event_organizer"}}).sort("name", 1))
    populate_club_mentors(db, clubs)
    return [serialize_document(club) for club in clubs]


@router.get("/events")
def list_events(request: Request):
    db = request.app.state.db
    events = list(collection(db, "events").find({"status": "approved"}).sort("eventDate", 1))
    for event in events:
        populate_many(db, [event], [
            ("clubId", "clubs", ["name"]),
            ("venueId", "venues", ["name", "location"]),
        ])
        event["coHostIds"] = [
            collection(db, "clubs").find_one({"_id": identity}, {"name": 1})
            for identity in event.get("coHostIds", [])
        ]
        event["coHostIds"] = [host for host in event["coHostIds"] if host]
        event["registeredCount"] = collection(db, "registrations").count_documents({
            "eventId": event["_id"], "status": {"$ne": "cancelled"}
        })
    return [serialize_document(event) for event in events]


@router.get("/announcements")
def list_announcements(request: Request):
    db = request.app.state.db
    announcements = list(collection(db, "announcements").find().sort("postedDate", -1).limit(50))
    populate_many(db, announcements, [("clubId", "clubs", ["name"])])
    return [serialize_document(item) for item in announcements]
