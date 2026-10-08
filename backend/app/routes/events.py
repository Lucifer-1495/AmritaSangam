from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from ..auth import current_profile
from ..database import serialize_document
from ..models import Role
from ..services.common import (
    OFFICE_BEARER_POSITIONS,
    active_membership,
    as_oid,
    can_manage_club,
    can_review_memberships,
    collection,
    insert,
    parse_number,
    parse_date,
    populate_many,
    require_club_position,
    require_fields,
    require_rejection_feedback,
    visible_club_ids,
    build_attendance_roster,
)
from ..services.media import validate_image_data_url


router = APIRouter()


@router.get("/events/manage")
def manage_events(request: Request, profile=Depends(current_profile)):
    db = request.app.state.db
    ids = visible_club_ids(db, profile)
    query = {} if profile["role"] == Role.ADMIN.value else {
        "$or": [{"status": "approved"}, {"clubId": {"$in": ids}}]
    }
    events = list(collection(db, "events").find(query).sort("eventDate", 1))
    populate_many(db, events, [
        ("clubId", "clubs", ["name", "clubType", "mentor"]),
        ("venueId", "venues", ["name", "location"]),
    ])
    return [serialize_document(event) for event in events]


@router.post("/events", status_code=201)
def create_event(request: Request, body: dict, profile=Depends(current_profile)):
    require_fields(body, ["title", "eventDate", "clubId"])
    db = request.app.state.db
    club_id = as_oid(body["clubId"], "clubId")
    club = collection(db, "clubs").find_one({"_id": club_id})
    if not club:
        raise HTTPException(status_code=404, detail="Club not found.")
    if not club.get("mentor"):
        raise HTTPException(status_code=409, detail="Assign a faculty mentor to this club before proposing events.")
    membership = active_membership(db, club_id, profile["_id"])
    if not membership or membership.get("position") not in ("president", "executive"):
        raise HTTPException(status_code=403, detail="Only this club’s president or executive can propose an event.")
    if body.get("eventType") and body["eventType"] != club.get("clubType"):
        raise HTTPException(status_code=400, detail=f"This club can only host {club.get('clubType', '').replace('_', ' ')} events.")
    venue_id = as_oid(body["venueId"], "venueId") if body.get("venueId") else None
    if venue_id and not collection(db, "venues").find_one({"_id": venue_id, "isAvailable": True}, {"_id": 1}):
        raise HTTPException(status_code=400, detail="Choose an available venue.")
    values = {
        "title": body["title"],
        "description": body.get("description", ""),
        "eventDate": parse_date(body["eventDate"]),
        "clubId": club_id,
        "eventType": club.get("clubType", "non_technical"),
        "capacity": parse_number(body.get("capacity", 100), "Capacity", 1),
        "registeredCount": 0,
        "createdBy": as_oid(profile["_id"]),
        "status": "mentor_pending" if membership["position"] == "president" else "draft",
    }
    if "posterUrl" in body:
        values["posterUrl"] = validate_image_data_url(body["posterUrl"], "Event poster", 1_500_000)
    if venue_id:
        values["venueId"] = venue_id
    return insert(db, "events", values)


@router.patch("/events/{identity}")
def edit_event(request: Request, identity: str, body: dict, profile=Depends(current_profile)):
    db = request.app.state.db
    events = collection(db, "events")
    event = events.find_one({"_id": as_oid(identity)})
    if not event:
        raise HTTPException(status_code=404, detail="Event not found.")
    membership = active_membership(db, event["clubId"], profile["_id"])
    if not membership or membership.get("position") not in ("president", "executive"):
        raise HTTPException(status_code=403, detail="Only this club’s president or executive can edit an event.")
    if event.get("status") not in ("draft", "rejected"):
        raise HTTPException(status_code=409, detail="An event under review or already approved cannot be edited.")
    if membership.get("position") != "president":
        raise HTTPException(status_code=403, detail="Only the club president can edit and submit this event request.")
    updates = {
        field: body[field]
        for field in ("title", "description", "capacity")
        if field in body
    }
    if "posterUrl" in body:
        updates["posterUrl"] = validate_image_data_url(body["posterUrl"], "Event poster", 1_500_000)
    if "eventDate" in body:
        updates["eventDate"] = parse_date(body["eventDate"])
    if "venueId" in body:
        updates["venueId"] = as_oid(body["venueId"], "venueId") if body["venueId"] else None
    venue_id = updates.get("venueId", event.get("venueId"))
    if venue_id and not collection(db, "venues").find_one({"_id": venue_id, "isAvailable": True}, {"_id": 1}):
        raise HTTPException(status_code=400, detail="Choose an available venue.")
    updates.update({
        "status": "draft",
        "rejectionFeedback": "",
        "updatedAt": datetime.now(timezone.utc),
    })
    events.update_one({"_id": event["_id"]}, {"$set": updates, "$unset": {"rejectionStage": ""}})
    event.update(updates)
    event.pop("rejectionStage", None)
    return serialize_document(event)


@router.patch("/events/{identity}/submit")
def submit_event(request: Request, identity: str, profile=Depends(current_profile)):
    db = request.app.state.db
    events = collection(db, "events")
    event = events.find_one({"_id": as_oid(identity)})
    if not event:
        raise HTTPException(status_code=404, detail="Event not found.")
    position = active_membership(db, event["clubId"], profile["_id"])
    if not position or position.get("position") != "president":
        raise HTTPException(status_code=403, detail="Only the club president can send an event request for approval.")
    if event.get("status") not in ("draft", "rejected"):
        raise HTTPException(status_code=409, detail="This event is already in the approval process.")
    updates = {
        "status": "mentor_pending",
        "rejectionFeedback": "",
        "updatedAt": datetime.now(timezone.utc),
    }
    events.update_one({"_id": event["_id"]}, {
        "$set": updates,
        "$unset": {"rejectionStage": "", "mentorReviewedBy": "", "studentAffairsReviewedBy": ""},
    })
    event.update(updates)
    for field in ("rejectionStage", "mentorReviewedBy", "studentAffairsReviewedBy"):
        event.pop(field, None)
    return serialize_document(event)


@router.patch("/events/{identity}/approval")
def approve_event(request: Request, identity: str, body: dict, profile=Depends(current_profile)):
    require_fields(body, ["status"])
    if body["status"] not in ("approved", "rejected"):
        raise HTTPException(status_code=400, detail="Status must be approved or rejected.")
    if body["status"] == "rejected":
        require_rejection_feedback(body)
    db = request.app.state.db
    events = collection(db, "events")
    event = events.find_one({"_id": as_oid(identity)})
    if not event:
        raise HTTPException(status_code=404, detail="Event not found.")
    club = collection(db, "clubs").find_one({"_id": event["clubId"]})
    mentor_review = event.get("status") == "mentor_pending" and str((club or {}).get("mentor", "")) == profile["_id"]
    affairs_review = event.get("status") == "student_affairs_pending" and profile["role"] == Role.ADMIN.value
    if not mentor_review and not affairs_review:
        raise HTTPException(status_code=403, detail="This request is not awaiting your approval.")
    rejected = body["status"] == "rejected"
    if mentor_review:
        event["mentorReviewedBy"] = as_oid(profile["_id"])
        event["status"] = "rejected" if rejected else "student_affairs_pending"
        if rejected:
            event["rejectionStage"] = "mentor"
        else:
            event.pop("rejectionStage", None)
    else:
        event["studentAffairsReviewedBy"] = as_oid(profile["_id"])
        event["status"] = body["status"]
        if rejected:
            event["rejectionStage"] = "student_affairs"
        else:
            event.pop("rejectionStage", None)
    event["rejectionFeedback"] = str(body.get("rejectionFeedback", "")).strip() if rejected else ""
    event["updatedAt"] = datetime.now(timezone.utc)
    events.replace_one({"_id": event["_id"]}, event)
    return serialize_document(event)


@router.get("/registrations")
def list_registrations(request: Request, eventId: str | None = None, profile=Depends(current_profile)):
    db = request.app.state.db
    query = {"profileId": as_oid(profile["_id"])}
    if eventId:
        event = collection(db, "events").find_one({"_id": as_oid(eventId, "eventId")})
        if not event:
            raise HTTPException(status_code=404, detail="Event not found.")
        if not can_manage_club(db, event["clubId"], profile):
            raise HTTPException(status_code=403, detail="Not allowed to view registrations for this event.")
        query = {"eventId": event["_id"]}
    registrations = list(collection(db, "registrations").find(query).sort("registrationDate", -1))
    populate_many(db, registrations, [
        ("eventId", "events", ["title", "eventDate", "clubId"]),
        ("profileId", "profiles", ["name", "email"]),
    ])
    return [serialize_document(item) for item in registrations]


@router.post("/registrations", status_code=201)
def register_for_event(request: Request, body: dict, profile=Depends(current_profile)):
    require_fields(body, ["eventId"])
    db = request.app.state.db
    event_id = as_oid(body["eventId"], "eventId")
    events = collection(db, "events")
    event = events.find_one_and_update({
        "_id": event_id,
        "status": "approved",
        "$expr": {"$lt": [{"$ifNull": ["$registeredCount", 0]}, "$capacity"]},
    }, {"$inc": {"registeredCount": 1}}, return_document=ReturnDocument.AFTER)
    if not event:
        approved = events.find_one({"_id": event_id, "status": "approved"}, {"_id": 1})
        if not approved:
            raise HTTPException(status_code=404, detail="Approved event not found.")
        raise HTTPException(status_code=409, detail="This event is full.")
    registrations = collection(db, "registrations")
    try:
        existing = registrations.find_one_and_update(
            {"eventId": event_id, "profileId": as_oid(profile["_id"]), "status": "cancelled"},
            {"$set": {"status": "registered", "registrationDate": datetime.now(timezone.utc), "updatedAt": datetime.now(timezone.utc)}},
            return_document=ReturnDocument.AFTER,
        )
        registration = existing or insert(db, "registrations", {
            "eventId": event_id,
            "profileId": as_oid(profile["_id"]),
            "status": "registered",
            "registrationDate": datetime.now(timezone.utc),
        })
        return registration
    except DuplicateKeyError as error:
        events.update_one({"_id": event_id}, {"$inc": {"registeredCount": -1}})
        raise HTTPException(status_code=409, detail="You are already registered for this event.") from error
    except Exception:
        events.update_one({"_id": event_id}, {"$inc": {"registeredCount": -1}})
        raise


@router.delete("/registrations/{identity}")
def cancel_registration(request: Request, identity: str, profile=Depends(current_profile)):
    db = request.app.state.db
    registrations = collection(db, "registrations")
    registration = registrations.find_one_and_update(
        {"_id": as_oid(identity), "profileId": as_oid(profile["_id"]), "status": "registered"},
        {"$set": {"status": "cancelled", "updatedAt": datetime.now(timezone.utc)}},
        return_document=ReturnDocument.AFTER,
    )
    if not registration:
        raise HTTPException(status_code=404, detail="Active registration not found.")
    collection(db, "events").update_one(
        {"_id": registration["eventId"], "registeredCount": {"$gt": 0}},
        {"$inc": {"registeredCount": -1}},
    )
    return serialize_document(registration)


@router.get("/venues")
def list_venues(request: Request, profile=Depends(current_profile)):
    records = collection(request.app.state.db, "venues").find({"isAvailable": True}).sort("name", 1)
    return [serialize_document(item) for item in records]


@router.post("/venues", status_code=201)
def create_venue(request: Request, body: dict, profile=Depends(current_profile)):
    if profile["role"] != Role.ADMIN.value:
        raise HTTPException(status_code=403, detail="You do not have permission to perform this action.")
    require_fields(body, ["name", "capacity", "location"])
    return insert(request.app.state.db, "venues", {
        **body,
        "capacity": int(body["capacity"]),
        "isAvailable": body.get("isAvailable", True),
    })


@router.post("/attendance", status_code=201)
def mark_attendance(request: Request, body: dict, profile=Depends(current_profile)):
    require_fields(body, ["eventId", "profileId", "status"])
    db = request.app.state.db
    event = collection(db, "events").find_one({"_id": as_oid(body["eventId"], "eventId"), "status": "approved"})
    if not event:
        raise HTTPException(status_code=404, detail="Approved event not found.")
    require_club_position(db, event["clubId"], profile, ["executive", *OFFICE_BEARER_POSITIONS])
    participant_id = as_oid(body["profileId"], "profileId")
    if not collection(db, "registrations").find_one({
        "eventId": event["_id"], "profileId": participant_id, "status": "registered"
    }, {"_id": 1}):
        raise HTTPException(status_code=409, detail="Attendance can only be recorded for a registered participant.")
    if body["status"] not in ("present", "absent", "excused"):
        raise HTTPException(status_code=400, detail="Invalid attendance status.")
    record = insert(db, "attendance", {
        **body,
        "eventId": event["_id"],
        "profileId": participant_id,
        "checkInTime": datetime.now(timezone.utc),
    })
    return record


@router.patch("/attendance/{identity}")
def update_attendance(request: Request, identity: str, body: dict, profile=Depends(current_profile)):
    require_fields(body, ["status"])
    if body["status"] not in ("present", "absent", "excused"):
        raise HTTPException(status_code=400, detail="Invalid attendance status.")
    db = request.app.state.db
    attendance = collection(db, "attendance")
    record = attendance.find_one({"_id": as_oid(identity)})
    if not record:
        raise HTTPException(status_code=404, detail="Attendance record not found.")
    event = collection(db, "events").find_one({"_id": record["eventId"]})
    if not event:
        raise HTTPException(status_code=404, detail="Event not found.")
    require_club_position(db, event["clubId"], profile, ["executive", *OFFICE_BEARER_POSITIONS])
    updates = {"status": body["status"], "updatedAt": datetime.now(timezone.utc)}
    if body["status"] == "present":
        updates["checkInTime"] = datetime.now(timezone.utc)
    attendance.update_one({"_id": record["_id"]}, {"$set": updates})
    record.update(updates)
    return serialize_document(record)


@router.get("/attendance")
def list_attendance(request: Request, eventId: str, profile=Depends(current_profile)):
    db = request.app.state.db
    event = collection(db, "events").find_one({"_id": as_oid(eventId, "eventId")})
    if not event:
        raise HTTPException(status_code=404, detail="Event not found.")
    require_club_position(db, event["clubId"], profile, ["executive", *OFFICE_BEARER_POSITIONS])
    records = list(collection(db, "attendance").find({"eventId": event["_id"]}).sort("checkInTime", -1))
    populate_many(db, records, [("profileId", "profiles", ["name", "email"])])
    return [serialize_document(item) for item in records]


@router.get("/participation")
def participation(request: Request, profile=Depends(current_profile)):
    db = request.app.state.db
    records = list(collection(db, "attendance").find({"profileId": as_oid(profile["_id"])}).sort("checkInTime", -1))
    for record in records:
        populate_many(db, [record], [("eventId", "events", ["title", "eventDate", "clubId"])])
        if isinstance(record.get("eventId"), dict):
            populate_many(db, [record["eventId"]], [("clubId", "clubs", ["name"])])
    return [serialize_document(item) for item in records]


@router.get("/event-reports")
def list_event_reports(request: Request, profile=Depends(current_profile)):
    db = request.app.state.db
    leadership_ids = [] if profile["role"] == Role.ADMIN.value else visible_club_ids(db, profile, OFFICE_BEARER_POSITIONS)
    mentor_ids = [] if profile["role"] == Role.ADMIN.value else [
        item["_id"] for item in collection(db, "clubs").find({"mentor": as_oid(profile["_id"])}, {"_id": 1})
    ]
    query = {} if profile["role"] == Role.ADMIN.value else {"$or": [
        {"submittedBy": as_oid(profile["_id"])},
        {"clubId": {"$in": leadership_ids}},
        {"clubId": {"$in": mentor_ids}},
    ]}
    reports = list(collection(db, "event_reports").find(query).sort("createdAt", -1))
    populate_many(db, reports, [
        ("eventId", "events", ["title", "eventDate"]),
        ("clubId", "clubs", ["name"]),
        ("submittedBy", "profiles", ["name"]),
    ])
    return [serialize_document(item) for item in reports]


@router.post("/events/{identity}/report", status_code=201)
def submit_event_report(request: Request, identity: str, body: dict, profile=Depends(current_profile)):
    require_fields(body, ["summary", "activities", "outcomes"])
    db = request.app.state.db
    event = collection(db, "events").find_one({"_id": as_oid(identity), "status": "approved"})
    if not event:
        raise HTTPException(status_code=404, detail="Approved event not found.")
    membership = active_membership(db, event["clubId"], profile["_id"])
    if not membership or membership.get("position") != "president":
        raise HTTPException(status_code=403, detail="Only the club president can submit the event report.")
    if parse_date(event["eventDate"]) > datetime.now(timezone.utc):
        raise HTTPException(status_code=409, detail="Submit the detailed report after the event has finished.")
    if collection(db, "event_reports").find_one({"eventId": event["_id"]}, {"_id": 1}):
        raise HTTPException(status_code=409, detail="A report has already been submitted for this event.")
    record = {
        "eventId": event["_id"],
        "clubId": event["clubId"],
        "submittedBy": as_oid(profile["_id"]),
        "summary": body["summary"],
        "activities": body["activities"],
        "outcomes": body["outcomes"],
        "issues": body.get("issues", ""),
        "budgetSpent": parse_number(body.get("budgetSpent") or 0, "Budget spent", 0),
        **build_attendance_roster(db, event["_id"], event["title"]),
        "status": "mentor_pending",
        "rejectionFeedback": "",
    }
    return insert(db, "event_reports", record)


@router.get("/event-reports/{identity}/roster")
def download_roster(request: Request, identity: str, profile=Depends(current_profile)):
    db = request.app.state.db
    report = collection(db, "event_reports").find_one({"_id": as_oid(identity)})
    if not report:
        raise HTTPException(status_code=404, detail="Event report not found.")
    if profile["role"] != Role.ADMIN.value:
        club = collection(db, "clubs").find_one({"_id": report["clubId"]}, {"mentor": 1})
        is_mentor = str((club or {}).get("mentor", "")) == profile["_id"]
        if not is_mentor and not can_review_memberships(db, report["clubId"], profile):
            raise HTTPException(status_code=403, detail="You do not have access to this attendance roster.")
    filename = "".join(char for char in report.get("rosterFileName", "attendance.csv") if char not in '"\r\n')
    return Response(
        content=report.get("rosterCsv", ""),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.patch("/event-reports/{identity}/approval")
def review_event_report(request: Request, identity: str, body: dict, profile=Depends(current_profile)):
    require_fields(body, ["status"])
    if body["status"] not in ("approved", "rejected"):
        raise HTTPException(status_code=400, detail="Status must be approved or rejected.")
    rejected = body["status"] == "rejected"
    if rejected:
        require_rejection_feedback(body)
    db = request.app.state.db
    reports = collection(db, "event_reports")
    report = reports.find_one({"_id": as_oid(identity)})
    if not report:
        raise HTTPException(status_code=404, detail="Event report not found.")
    club = collection(db, "clubs").find_one({"_id": report["clubId"]})
    mentor_review = report.get("status") == "mentor_pending" and str((club or {}).get("mentor", "")) == profile["_id"]
    affairs_review = report.get("status") == "student_affairs_pending" and profile["role"] == Role.ADMIN.value
    if not mentor_review and not affairs_review:
        raise HTTPException(status_code=403, detail="This report is not awaiting your review.")
    if mentor_review:
        report["mentorReviewedBy"] = as_oid(profile["_id"])
        report["status"] = "rejected" if rejected else "student_affairs_pending"
        if rejected:
            report["rejectionStage"] = "mentor"
        else:
            report.pop("rejectionStage", None)
    else:
        report["studentAffairsReviewedBy"] = as_oid(profile["_id"])
        report["status"] = body["status"]
        if rejected:
            report["rejectionStage"] = "student_affairs"
        else:
            report.pop("rejectionStage", None)
    report["rejectionFeedback"] = str(body.get("rejectionFeedback", "")).strip() if rejected else ""
    report["updatedAt"] = datetime.now(timezone.utc)
    reports.replace_one({"_id": report["_id"]}, report)
    return serialize_document(report)


@router.patch("/event-reports/{identity}/resubmit")
def resubmit_event_report(request: Request, identity: str, body: dict, profile=Depends(current_profile)):
    db = request.app.state.db
    reports = collection(db, "event_reports")
    report = reports.find_one({"_id": as_oid(identity)})
    if not report:
        raise HTTPException(status_code=404, detail="Event report not found.")
    membership = active_membership(db, report["clubId"], profile["_id"])
    if not membership or membership.get("position") != "president":
        raise HTTPException(status_code=403, detail="Only the club president can revise the report.")
    if report.get("status") != "rejected":
        raise HTTPException(status_code=409, detail="Only a rejected report can be resubmitted.")
    for field in ("summary", "activities", "outcomes", "issues", "budgetSpent"):
        if field in body:
            report[field] = parse_number(body[field], "Budget spent", 0) if field == "budgetSpent" else body[field]
    event = collection(db, "events").find_one({"_id": report["eventId"]}, {"title": 1})
    if not event:
        raise HTTPException(status_code=404, detail="The event for this report no longer exists.")
    report.update(build_attendance_roster(db, report["eventId"], event["title"]))
    report["status"] = "mentor_pending"
    report["rejectionFeedback"] = ""
    report["updatedAt"] = datetime.now(timezone.utc)
    for field in ("rejectionStage", "mentorReviewedBy", "studentAffairsReviewedBy"):
        report.pop(field, None)
    reports.replace_one({"_id": report["_id"]}, report)
    return serialize_document(report)
