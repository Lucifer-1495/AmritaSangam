from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from ..auth import current_profile
from ..database import serialize_document
from ..models import Role
from ..services.common import (
    active_membership,
    as_oid,
    can_manage_club,
    can_review_memberships,
    club_mentor_query,
    collection,
    has_verified_club_access,
    insert,
    parse_number,
    parse_date,
    populate_many,
    populate_review_history,
    require_fields,
    require_rejection_feedback,
    review_history_entry,
    is_executive,
    is_club_mentor,
    is_student_affairs,
    mentor_approval_assignments,
    review_mentor_assignment,
    visible_club_ids,
    build_attendance_roster,
)
from ..services.media import validate_image_data_url


router = APIRouter()

TECHNICAL_DETAIL_ENUMS = {
    "eventCategory": {
        "flagship_intercollege",
        "flagship_interuniversity",
        "independent",
        "collaboration",
        "coordinated",
    },
    "programDrivenBy": {"iic_calendar_activity", "celebration_activity", "self_driven_activity"},
    "quarter": {"Q1", "Q2", "Q3", "Q4"},
    "programLevel": {"level_1", "level_2", "level_3", "level_4"},
    "programTheme": {
        "innovation_design_thinking",
        "ipr_technology_transfer",
        "pre_incubation_incubation_management",
        "entrepreneurship_startup",
    },
    "resourcePersonType": {"external", "alumni", "internal"},
    "sessionMode": {"online", "offline", "hybrid"},
}
TECHNICAL_DETAIL_TEXT_LIMITS = {
    "presidingOfficial": 200,
    "resourcePersonDetails": 1000,
    "programDescription": 2000,
    "budgetInWords": 300,
    "annexures": 2000,
    "photoLink": 1000,
    "impactAnalysis": 3000,
}


def parse_technical_details(body, event_type):
    if "technicalDetails" not in body:
        return None
    details = body["technicalDetails"]
    if not isinstance(details, dict):
        raise HTTPException(status_code=400, detail="Technical event details must be an object.")
    if event_type != "technical" and details:
        raise HTTPException(status_code=400, detail="Technical event details are only allowed for technical events.")
    if event_type != "technical":
        return {}

    normalized = {}
    for field, allowed in TECHNICAL_DETAIL_ENUMS.items():
        value = details.get(field)
        if value in (None, ""):
            continue
        if not isinstance(value, str) or value not in allowed:
            raise HTTPException(status_code=400, detail=f"Choose a valid value for {field}.")
        normalized[field] = value
    for field, maximum in TECHNICAL_DETAIL_TEXT_LIMITS.items():
        value = details.get(field)
        if value in (None, ""):
            continue
        if not isinstance(value, str) or len(value.strip()) > maximum:
            raise HTTPException(status_code=400, detail=f"{field} must be no more than {maximum} characters.")
        normalized[field] = value.strip()
    for field, allowed in (
        ("programOutcomes", {f"PO{i}" for i in range(1, 12)}),
        ("programSpecificOutcomes", {f"PSO{i}" for i in range(1, 5)}),
    ):
        values = details.get(field, [])
        if not isinstance(values, list) or any(not isinstance(value, str) or value not in allowed for value in values):
            raise HTTPException(status_code=400, detail=f"Choose valid values for {field}.")
        if values:
            normalized[field] = list(dict.fromkeys(values))
    values = details.get("sdgGoals", [])
    if not isinstance(values, list) or any(
        isinstance(value, bool) or not isinstance(value, int) or value < 1 or value > 17
        for value in values
    ):
        raise HTTPException(status_code=400, detail="Choose valid values for sdgGoals.")
    if values:
        normalized["sdgGoals"] = list(dict.fromkeys(values))
    for field in ("internalParticipants", "externalParticipants"):
        value = details.get(field)
        if value in (None, ""):
            continue
        number = parse_number(value, field, 0)
        if not number.is_integer():
            raise HTTPException(status_code=400, detail=f"{field} must be a whole number.")
        normalized[field] = int(number)
    for field in ("durationHours", "estimatedBudget"):
        value = details.get(field)
        if value in (None, ""):
            continue
        normalized[field] = parse_number(value, field, 0)
    return normalized


def find_venue_conflict(db, venue_id, start, end, exclude_event_id=None):
    query = {
        "venueId": venue_id,
        "status": {"$nin": ["draft", "rejected", "cancelled"]},
        "eventDate": {"$lt": end},
    }
    if exclude_event_id:
        query["_id"] = {"$ne": exclude_event_id}
    for event in collection(db, "events").find(query):
        event_start = event["eventDate"]
        # Legacy events have no end time; reserve a one-hour slot for them.
        event_end = event.get("endDate") or event_start + timedelta(hours=1)
        if event_start < end and event_end > start:
            return event
    return None


def event_time_range(start_value, end_value):
    start = parse_date(start_value, "Enter a valid event start time.")
    end = parse_date(end_value, "Enter a valid event end time.")
    if end <= start:
        raise HTTPException(status_code=400, detail="Event end time must be after its start time.")
    return start, end


def require_club_account_for_attendance(event, profile):
    if (
        not profile.get("isClubAccount")
        or not profile.get("verifiedClubId")
        or str(profile["verifiedClubId"]) != str(event["clubId"])
    ):
        raise HTTPException(status_code=403, detail="Only this club’s shared account can take attendance.")


def parse_report_details(value):
    if not isinstance(value, dict):
        raise HTTPException(status_code=400, detail="Event report details must be an object.")
    option_fields = {
        "promotion": {"LinkedIn Page/URL", "Link to photos and videos"},
        "eventCategory": {"Flagship", "Independent", "Club Collaboration", "Coordinated with another event"},
        "programType": {
            "Level 1: Expert Talks", "Level 1: Mentoring Sessions", "Level 1: Performances",
            "Level 2: Workshop", "Level 2: Seminar", "Level 2: Conference",
            "Level 3: Exhibitions & Demos", "Level 3: Competitions", "Level 3: Visits to external locations",
            "Level 4: Cultural Fest", "Level 4: Challenges", "Level 4: Hackathons",
        },
        "programTheme": {
            "Literary & Communication", "Cultural & Arts", "Social & Community Engagement",
            "Leadership & Management", "Celebrations & Recreation", "Film, Media & Content",
            "Wellness, Ethics & Life Skills", "Sports and Fitness", "Commemorative Days and Events",
        },
        "sdgAlignment": {
            "SDG 1 — No Poverty", "SDG 2 — Zero Hunger", "SDG 3 — Good Health and Well-being",
            "SDG 4 — Quality Education", "SDG 5 — Gender Equality", "SDG 6 — Clean Water and Sanitation",
            "SDG 7 — Affordable and Clean Energy", "SDG 8 — Decent Work and Economic Growth",
            "SDG 9 — Industry, Innovation and Infrastructure", "SDG 10 — Reduced Inequalities",
            "SDG 11 — Sustainable Cities and Communities", "SDG 12 — Responsible Consumption and Production",
            "SDG 13 — Climate Action", "SDG 14 — Life Below Water", "SDG 15 — Life on Land",
            "SDG 16 — Peace, Justice and Strong Institutions", "SDG 17 — Partnerships for the Goals",
        },
        "sessionMode": {"Online", "Offline", "Hybrid"},
        "resourcePerson": {"External", "Internal", "Alumni"},
    }
    normalized = {}
    for field, allowed in option_fields.items():
        group = value.get(field, {})
        if not isinstance(group, dict):
            raise HTTPException(status_code=400, detail=f"{field} must contain selections and a remark.")
        selected = group.get("selected", [])
        if not isinstance(selected, list) or any(not isinstance(item, str) or item not in allowed for item in selected):
            raise HTTPException(status_code=400, detail=f"Choose valid {field} options.")
        remark = group.get("remark", "")
        if not isinstance(remark, str) or len(remark) > 3000:
            raise HTTPException(status_code=400, detail=f"{field} remarks must be no more than 3000 characters.")
        normalized[field] = {"selected": list(dict.fromkeys(selected)), "remark": remark.strip()}

    participants = value.get("participants", {})
    if not isinstance(participants, dict):
        raise HTTPException(status_code=400, detail="Participants must contain participant counts and a remark.")
    participant_options = participants.get("selected", [])
    if not isinstance(participant_options, list) or any(item not in ("internal", "external") for item in participant_options):
        raise HTTPException(status_code=400, detail="Choose valid participant categories.")
    normalized["participants"] = {"selected": list(dict.fromkeys(participant_options))}
    for field in ("internalCount", "externalCount"):
        count = participants.get(field, "")
        if count in (None, ""):
            normalized["participants"][field] = ""
            continue
        number = parse_number(count, field, 0)
        if not number.is_integer():
            raise HTTPException(status_code=400, detail=f"{field} must be a whole number.")
        normalized["participants"][field] = int(number)
    participant_remark = participants.get("remark", "")
    if not isinstance(participant_remark, str) or len(participant_remark) > 3000:
        raise HTTPException(status_code=400, detail="Participant remarks must be no more than 3000 characters.")
    normalized["participants"]["remark"] = participant_remark.strip()

    completion = value.get("activityCompletion", {})
    if not isinstance(completion, dict):
        raise HTTPException(status_code=400, detail="Activity completion details must be an object.")
    text_fields = {
        "duration": 200,
        "startDate": 100,
        "endDate": 100,
        "expenditure": 500,
        "resourcePersonDetails": 3000,
        "discussionHighlights": 5000,
        "objectiveAchieved": 5000,
        "skillsAcquired": 3000,
        "detailedReport": 20000,
        "impactAnalysis": 5000,
    }
    normalized_completion = {}
    for field, limit in text_fields.items():
        section = completion.get(field, {})
        if not isinstance(section, dict):
            raise HTTPException(status_code=400, detail=f"{field} must contain a value and a remark.")
        field_value = section.get("value", "")
        remark = section.get("remark", "")
        if not isinstance(field_value, str) or len(field_value) > limit:
            raise HTTPException(status_code=400, detail=f"{field} exceeds the allowed length.")
        if not isinstance(remark, str) or len(remark) > 3000:
            raise HTTPException(status_code=400, detail=f"{field} remarks must be no more than 3000 characters.")
        if field == "detailedReport" and len(field_value.split()) > 1000:
            raise HTTPException(status_code=400, detail="Detailed report must not exceed 1000 words.")
        normalized_completion[field] = {"value": field_value.strip(), "remark": remark.strip()}

    for field, label in (
        ("brochure", "Brochure/Flyer"),
        ("photograph1", "Photograph 1"),
        ("photograph2", "Photograph 2"),
        ("photograph3", "Photograph 3"),
        ("photograph4", "Photograph 4"),
    ):
        section = completion.get(field, {})
        if not isinstance(section, dict):
            raise HTTPException(status_code=400, detail=f"{label} must contain an image and a remark.")
        image = validate_image_data_url(section.get("image", ""), label, 2_000_000)
        remark = section.get("remark", "")
        if not isinstance(remark, str) or len(remark) > 3000:
            raise HTTPException(status_code=400, detail=f"{label} remarks must be no more than 3000 characters.")
        normalized_completion[field] = {"image": image, "remark": remark.strip()}
    normalized["activityCompletion"] = normalized_completion
    return normalized


def parse_cohost_ids(db, values, primary_id, allow_organizers=False):
    if values is None:
        return []
    if not isinstance(values, list):
        raise HTTPException(status_code=400, detail="Event co-hosts must be a list.")
    cohost_ids = []
    seen = {str(primary_id)}
    for value in values:
        identity = as_oid(value, "coHostIds")
        if str(identity) in seen:
            continue
        host = collection(db, "clubs").find_one({"_id": identity})
        if not host:
            raise HTTPException(status_code=400, detail="Choose valid club or campus event co-hosts.")
        if host.get("organizationType") == "event_organizer" and not allow_organizers:
            raise HTTPException(status_code=403, detail="Only Student Affairs can add campus event organizers as co-hosts.")
        cohost_ids.append(identity)
        seen.add(str(identity))
    if len(cohost_ids) > 20:
        raise HTTPException(status_code=400, detail="An event can have at most 20 co-hosts.")
    return cohost_ids


@router.get("/events/manage")
def manage_events(request: Request, profile=Depends(current_profile)):
    db = request.app.state.db
    verified_access = has_verified_club_access(db, profile.get("verifiedClubId"), profile)
    ids = [as_oid(profile["verifiedClubId"])] if verified_access else visible_club_ids(db, profile)
    club_event_query = {"$or": [
        {"clubId": {"$in": ids}},
        {"coHostIds": {"$in": ids}},
    ]}
    query = {} if profile["role"] == Role.ADMIN.value else (
        club_event_query if verified_access else {
            "$or": [{"status": "approved"}, *club_event_query["$or"]]
        }
    )
    events = list(collection(db, "events").find(query).sort("eventDate", 1))
    populate_many(db, events, [
        ("clubId", "clubs", ["name", "clubType", "mentor", "mentorIds", "organizationType"]),
        ("venueId", "venues", ["name", "location"]),
        ("createdBy", "profiles", ["name"]),
        ("mentorReviewedBy", "profiles", ["name"]),
        ("studentAffairsReviewedBy", "profiles", ["name"]),
    ])
    for event in events:
        event["coHostIds"] = [
            collection(db, "clubs").find_one({"_id": identity}, {"name": 1, "mentor": 1, "mentorIds": 1})
            for identity in event.get("coHostIds", [])
        ]
        event["coHostIds"] = [host for host in event["coHostIds"] if host]
        if event.get("mentorApprovals"):
            populate_many(db, event["mentorApprovals"], [
                ("clubId", "clubs", ["name"]),
                ("mentorId", "profiles", ["name"]),
            ])
    populate_review_history(db, events)
    return [serialize_document(event) for event in events]


@router.get("/venues/availability")
def venue_availability(
    request: Request,
    eventDate: str,
    endDate: str,
    excludeEventId: str | None = None,
    profile=Depends(current_profile),
):
    start, end = event_time_range(eventDate, endDate)
    exclude_event_id = as_oid(excludeEventId, "excludeEventId") if excludeEventId else None
    venues = collection(request.app.state.db, "venues").find({"isAvailable": True}).sort("name", 1)
    return [
        {
            **serialize_document(venue),
            "available": find_venue_conflict(
                request.app.state.db, venue["_id"], start, end, exclude_event_id
            ) is None,
        }
        for venue in venues
    ]


@router.post("/events", status_code=201)
def create_event(request: Request, body: dict, profile=Depends(current_profile)):
    require_fields(body, ["title", "eventDate", "endDate", "clubId", "venueId"])
    db = request.app.state.db
    start, end = event_time_range(body["eventDate"], body["endDate"])
    club_id = as_oid(body["clubId"], "clubId")
    club = collection(db, "clubs").find_one({"_id": club_id})
    if not club:
        raise HTTPException(status_code=404, detail="Club not found.")
    is_event_organizer = club.get("organizationType") == "event_organizer"
    if is_event_organizer:
        if not is_student_affairs(profile):
            raise HTTPException(status_code=403, detail="Only Student Affairs can create events for campus organizers.")
    else:
        if not club.get("mentor"):
            raise HTTPException(status_code=409, detail="Assign a faculty mentor to this club before proposing events.")
        membership = active_membership(db, club_id, profile["_id"])
        if not is_executive(membership) and not has_verified_club_access(db, club_id, profile):
            raise HTTPException(status_code=403, detail="Only active club executives can propose events.")
    if body.get("eventType") and (
        body["eventType"] not in ("technical", "non_technical")
        or (not is_event_organizer and body["eventType"] != club.get("clubType"))
    ):
        raise HTTPException(status_code=400, detail=f"This club can only host {club.get('clubType', '').replace('_', ' ')} events.")
    venue_id = as_oid(body["venueId"], "venueId")
    if not collection(db, "venues").find_one({"_id": venue_id, "isAvailable": True}, {"_id": 1}):
        raise HTTPException(status_code=400, detail="Choose an available venue.")
    if find_venue_conflict(db, venue_id, start, end):
        raise HTTPException(status_code=409, detail="That venue is already occupied during the selected time.")
    cohost_ids = parse_cohost_ids(db, body.get("coHostIds"), club_id, is_student_affairs(profile))
    values = {
        "title": body["title"],
        "description": body.get("description", ""),
        "eventDate": start,
        "endDate": end,
        "clubId": club_id,
        "eventType": body.get("eventType", club.get("clubType", "non_technical")),
        "capacity": parse_number(body.get("capacity", 100), "Capacity", 1),
        "registeredCount": 0,
        "createdBy": as_oid(profile["_id"]),
        "status": "student_affairs_pending" if is_event_organizer and not cohost_ids else "mentor_pending",
        "coHostIds": cohost_ids,
    }
    if not is_event_organizer or cohost_ids:
        values["mentorApprovals"] = mentor_approval_assignments(db, values)
    technical_details = parse_technical_details(body, values["eventType"])
    if technical_details is not None:
        values["technicalDetails"] = technical_details
    if "posterUrl" in body:
        values["posterUrl"] = validate_image_data_url(body["posterUrl"], "Event poster", 1_500_000)
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
    club = collection(db, "clubs").find_one({"_id": event["clubId"]})
    is_organizer_review = (
        is_student_affairs(profile)
        and (club or {}).get("organizationType") == "event_organizer"
        and event.get("status") == "student_affairs_pending"
    )
    if not is_organizer_review and not is_executive(membership) and not has_verified_club_access(db, event["clubId"], profile):
        raise HTTPException(status_code=403, detail="Only active club executives can edit an event.")
    if not is_organizer_review and (event.get("status") not in ("draft", "mentor_pending") or event.get("mentorReviewedBy")):
        raise HTTPException(status_code=409, detail="This event can no longer be edited after mentor review.")
    updates = {
        field: body[field]
        for field in ("title", "description", "capacity")
        if field in body
    }
    if "capacity" in updates:
        updates["capacity"] = parse_number(updates["capacity"], "Capacity", 1)
    if "posterUrl" in body:
        updates["posterUrl"] = validate_image_data_url(body["posterUrl"], "Event poster", 1_500_000)
    if "eventDate" in body:
        updates["eventDate"] = parse_date(body["eventDate"])
    if "endDate" in body:
        updates["endDate"] = parse_date(body["endDate"])
    if "venueId" in body:
        updates["venueId"] = as_oid(body["venueId"], "venueId") if body["venueId"] else None
    if "coHostIds" in body:
        updates["coHostIds"] = parse_cohost_ids(db, body["coHostIds"], event["clubId"], is_student_affairs(profile))
        if event.get("status") in ("draft", "mentor_pending"):
            candidate = {**event, **updates}
            updates["mentorApprovals"] = mentor_approval_assignments(db, candidate)
    if "eventType" in body and (club or {}).get("organizationType") == "event_organizer":
        if body["eventType"] not in ("technical", "non_technical"):
            raise HTTPException(status_code=400, detail="Choose a valid event type.")
        updates["eventType"] = body["eventType"]
    if "technicalDetails" in body:
        event_type = updates.get("eventType", event.get("eventType", (club or {}).get("clubType")))
        updates["technicalDetails"] = parse_technical_details(body, event_type)
    venue_id = updates.get("venueId", event.get("venueId"))
    if venue_id and not collection(db, "venues").find_one({"_id": venue_id, "isAvailable": True}, {"_id": 1}):
        raise HTTPException(status_code=400, detail="Choose an available venue.")
    start = updates.get("eventDate", event["eventDate"])
    end = updates.get("endDate", event.get("endDate") or start + timedelta(hours=1))
    if end <= start:
        raise HTTPException(status_code=400, detail="Event end time must be after its start time.")
    if venue_id and find_venue_conflict(db, venue_id, start, end, event["_id"]):
        raise HTTPException(status_code=409, detail="That venue is already occupied during the selected time.")
    updates["updatedAt"] = datetime.now(timezone.utc)
    events.update_one({"_id": event["_id"]}, {"$set": updates})
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
    membership = active_membership(db, event["clubId"], profile["_id"])
    if not is_executive(membership) and not has_verified_club_access(db, event["clubId"], profile):
        raise HTTPException(status_code=403, detail="Only active club executives can submit an event request.")
    if event.get("status") not in ("draft", "rejected"):
        raise HTTPException(status_code=409, detail="This event is already in the approval process.")
    updates = {
        "status": "mentor_pending",
        "rejectionFeedback": "",
        "updatedAt": datetime.now(timezone.utc),
        "mentorApprovals": mentor_approval_assignments(db, event),
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
    mentor_review = False
    affairs_review = event.get("status") == "student_affairs_pending" and is_student_affairs(profile)
    if event.get("status") == "mentor_pending":
        if not event.get("mentorApprovals"):
            event["mentorApprovals"] = mentor_approval_assignments(db, event)
        mentor_review, mentors_complete = review_mentor_assignment(
            event, profile["_id"], body["status"], datetime.now(timezone.utc)
        )
        if not mentor_review:
            raise HTTPException(status_code=403, detail="This request is not awaiting your approval.")
        event["mentorReviewedBy"] = as_oid(profile["_id"])
    elif not affairs_review:
        raise HTTPException(status_code=403, detail="This request is not awaiting your approval.")
    rejected = body["status"] == "rejected"
    if mentor_review:
        event["status"] = "rejected" if rejected else "student_affairs_pending" if mentors_complete else "mentor_pending"
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
    stage = "mentor" if mentor_review else "student_affairs"
    event.setdefault("reviewHistory", []).append(review_history_entry(
        profile, body["status"], stage, event["rejectionFeedback"], event["updatedAt"]
    ))
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
    require_club_account_for_attendance(event, profile)
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
    require_club_account_for_attendance(event, profile)
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
    require_club_account_for_attendance(event, profile)
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
    if profile["role"] == Role.ADMIN.value:
        query = {}
    elif profile["role"] == Role.FACULTY.value:
        mentor_ids = [
            item["_id"] for item in collection(db, "clubs").find(
                club_mentor_query(profile["_id"]), {"_id": 1}
            )
        ]
        related_events = collection(db, "events").find({
            "$or": [{"clubId": {"$in": mentor_ids}}, {"coHostIds": {"$in": mentor_ids}}]
        }, {"_id": 1})
        query = {"eventId": {"$in": [event["_id"] for event in related_events]}}
    elif has_verified_club_access(db, profile.get("verifiedClubId"), profile):
        query = {"clubId": as_oid(profile["verifiedClubId"])}
    else:
        query = {"submittedBy": as_oid(profile["_id"])}
    reports = list(collection(db, "event_reports").find(query).sort("createdAt", -1))
    populate_many(db, reports, [
        ("eventId", "events", ["title", "eventDate"]),
        ("clubId", "clubs", ["name"]),
        ("submittedBy", "profiles", ["name"]),
        ("mentorReviewedBy", "profiles", ["name"]),
        ("studentAffairsReviewedBy", "profiles", ["name"]),
    ])
    for report in reports:
        if report.get("mentorApprovals"):
            populate_many(db, report["mentorApprovals"], [
                ("clubId", "clubs", ["name"]),
                ("mentorId", "profiles", ["name"]),
            ])
    for report in reports:
        if report.get("submittedBy") is None and report.get("submittedByName"):
            report["submittedBy"] = {"name": report["submittedByName"]}
    populate_review_history(db, reports)
    return [serialize_document(item) for item in reports]


@router.post("/events/{identity}/report", status_code=201)
def submit_event_report(request: Request, identity: str, body: dict, profile=Depends(current_profile)):
    if "reportDetails" in body:
        report_details = parse_report_details(body["reportDetails"])
    else:
        require_fields(body, ["summary", "activities", "outcomes"])
        report_details = None
    db = request.app.state.db
    event = collection(db, "events").find_one({"_id": as_oid(identity), "status": "approved"})
    if not event:
        raise HTTPException(status_code=404, detail="Approved event not found.")
    membership = active_membership(db, event["clubId"], profile["_id"])
    if not is_executive(membership) and not has_verified_club_access(db, event["clubId"], profile):
        raise HTTPException(status_code=403, detail="Only active club executives can submit the event report.")
    if parse_date(event["eventDate"]) > datetime.now(timezone.utc):
        raise HTTPException(status_code=409, detail="Submit the detailed report after the event has finished.")
    if collection(db, "event_reports").find_one({"eventId": event["_id"]}, {"_id": 1}):
        raise HTTPException(status_code=409, detail="A report has already been submitted for this event.")
    completion = report_details["activityCompletion"] if report_details else {}
    record = {
        "eventId": event["_id"],
        "clubId": event["clubId"],
        "submittedBy": as_oid(profile["_id"]),
        "submittedByName": profile.get("name") or profile.get("email") or "Club account",
        "summary": body.get("summary") or completion.get("detailedReport", {}).get("value") or event["title"],
        "activities": body.get("activities") or completion.get("discussionHighlights", {}).get("value", ""),
        "outcomes": body.get("outcomes") or completion.get("objectiveAchieved", {}).get("value", ""),
        "issues": body.get("issues", ""),
        "budgetSpent": parse_number(body.get("budgetSpent") or 0, "Budget spent", 0),
        **build_attendance_roster(db, event["_id"], event["title"]),
        "status": "mentor_pending",
        "rejectionFeedback": "",
    }
    if report_details is not None:
        record.update({
            "reportDetails": report_details,
            "mentorApprovals": mentor_approval_assignments(db, event),
        })
    else:
        record["mentorApprovals"] = mentor_approval_assignments(db, event)
    return insert(db, "event_reports", record)


@router.get("/event-reports/{identity}/roster")
def download_roster(request: Request, identity: str, profile=Depends(current_profile)):
    db = request.app.state.db
    report = collection(db, "event_reports").find_one({"_id": as_oid(identity)})
    if not report:
        raise HTTPException(status_code=404, detail="Event report not found.")
    if profile["role"] != Role.ADMIN.value:
        club = collection(db, "clubs").find_one({"_id": report["clubId"]}, {"mentor": 1, "mentorIds": 1})
        is_mentor = is_club_mentor(club, profile["_id"])
        if not is_mentor and not can_review_memberships(db, report["clubId"], profile):
            raise HTTPException(status_code=403, detail="You do not have access to this attendance roster.")
    event = collection(db, "events").find_one({"_id": report["eventId"]}, {"title": 1})
    if event:
        roster = build_attendance_roster(db, report["eventId"], event["title"])
        collection(db, "event_reports").update_one({"_id": report["_id"]}, {"$set": roster})
        report.update(roster)
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
    mentor_review = False
    affairs_review = report.get("status") == "student_affairs_pending" and is_student_affairs(profile)
    if report.get("status") == "mentor_pending":
        if not report.get("mentorApprovals"):
            event = collection(db, "events").find_one({"_id": report["eventId"]})
            report["mentorApprovals"] = mentor_approval_assignments(db, event or {"clubId": report["clubId"]})
        mentor_review, mentors_complete = review_mentor_assignment(
            report, profile["_id"], body["status"], datetime.now(timezone.utc)
        )
        if not mentor_review:
            raise HTTPException(status_code=403, detail="This report is not awaiting your review.")
    elif not affairs_review:
        raise HTTPException(status_code=403, detail="This report is not awaiting your review.")
    if mentor_review:
        report["mentorReviewedBy"] = as_oid(profile["_id"])
        report["status"] = "rejected" if rejected else "student_affairs_pending" if mentors_complete else "mentor_pending"
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
    stage = "mentor" if mentor_review else "student_affairs"
    report.setdefault("reviewHistory", []).append(review_history_entry(
        profile, body["status"], stage, report["rejectionFeedback"], report["updatedAt"]
    ))
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
    if not is_executive(membership) and not has_verified_club_access(db, report["clubId"], profile):
        raise HTTPException(status_code=403, detail="Only active club executives can revise the report.")
    if report.get("status") != "rejected":
        raise HTTPException(status_code=409, detail="Only a rejected report can be resubmitted.")
    for field in ("summary", "activities", "outcomes", "issues", "budgetSpent"):
        if field in body:
            report[field] = parse_number(body[field], "Budget spent", 0) if field == "budgetSpent" else body[field]
    if "reportDetails" in body:
        report["reportDetails"] = parse_report_details(body["reportDetails"])
        completion = report["reportDetails"]["activityCompletion"]
        report["summary"] = completion["detailedReport"]["value"]
        report["activities"] = completion["discussionHighlights"]["value"]
        report["outcomes"] = completion["objectiveAchieved"]["value"]
    event = collection(db, "events").find_one({"_id": report["eventId"]})
    if not event:
        raise HTTPException(status_code=404, detail="The event for this report no longer exists.")
    report.update(build_attendance_roster(db, report["eventId"], event["title"]))
    report["status"] = "mentor_pending"
    report["mentorApprovals"] = mentor_approval_assignments(db, event)
    report["rejectionFeedback"] = ""
    report["updatedAt"] = datetime.now(timezone.utc)
    for field in ("rejectionStage", "mentorReviewedBy", "studentAffairsReviewedBy"):
        report.pop(field, None)
    reports.replace_one({"_id": report["_id"]}, report)
    return serialize_document(report)
