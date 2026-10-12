import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pymongo import ReturnDocument

from ..auth import current_profile
from ..database import serialize_document
from ..models import Role
from ..services.common import (
    OFFICE_BEARER_POSITIONS,
    active_membership,
    as_oid,
    can_manage_club,
    can_review_memberships,
    has_verified_club_access,
    has_office_bearer_membership,
    is_club_mentor,
    event_involves_club,
    mentor_review_started,
    mentor_approval_assignments,
    review_mentor_assignment,
    is_executive,
    is_office_bearer,
    collection,
    insert,
    parse_number,
    parse_date,
    populate_many,
    populate_review_history,
    require_club_manager,
    require_fields,
    require_rejection_feedback,
    review_history_entry,
    is_student_affairs,
    visible_club_ids,
)


router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/announcements", status_code=201)
def create_announcement(request: Request, body: dict, profile=Depends(current_profile)):
    require_fields(body, ["clubId", "title", "content"])
    if body.get("priority", "normal") not in ("low", "normal", "high"):
        raise HTTPException(status_code=400, detail="Priority must be low, normal or high.")
    db = request.app.state.db
    club = collection(db, "clubs").find_one({"_id": as_oid(body["clubId"], "clubId")})
    if not club:
        raise HTTPException(status_code=404, detail="Club not found.")
    if profile["role"] != Role.ADMIN.value and not (
        profile["role"] == Role.FACULTY.value and is_club_mentor(club, profile["_id"])
    ):
        raise HTTPException(status_code=403, detail="Only the assigned club mentor or Student Affairs can publish announcements.")
    return insert(db, "announcements", {
        "clubId": as_oid(body["clubId"], "clubId"),
        "title": body["title"],
        "content": body["content"],
        "priority": body.get("priority") or "normal",
        "postedDate": datetime.now(timezone.utc),
    })


@router.get("/funding-requests")
def list_funding_requests(request: Request, profile=Depends(current_profile)):
    db = request.app.state.db
    verified_access = has_verified_club_access(db, profile.get("verifiedClubId"), profile)
    if profile["role"] == Role.COMMITTEE.value and has_office_bearer_membership(db, profile["_id"]) and not verified_access:
        raise HTTPException(status_code=403, detail="Office bearers cannot access club funding requests.")
    ids = [as_oid(profile["verifiedClubId"])] if verified_access else visible_club_ids(db, profile)
    query = {} if profile["role"] == Role.ADMIN.value else {"clubId": {"$in": ids}}
    if profile["role"] == Role.FACULTY.value and ids:
        related_event_ids = [
            event["_id"] for event in collection(db, "events").find({
                "$or": [{"clubId": {"$in": ids}}, {"coHostIds": {"$in": ids}}]
            }, {"_id": 1})
        ]
        query = {"$or": [
            {"clubId": {"$in": ids}},
            {"eventId": {"$in": related_event_ids}},
        ]}
    requests = list(collection(db, "funding").find(query).sort("requestDate", -1))
    populate_many(db, requests, [
        ("clubId", "clubs", ["name"]),
        ("eventId", "events", ["title", "eventDate"]),
        ("createdBy", "profiles", ["name"]),
        ("mentorReviewedBy", "profiles", ["name"]),
        ("studentAffairsReviewedBy", "profiles", ["name"]),
    ])
    for item in requests:
        if item.get("mentorApprovals"):
            populate_many(db, item["mentorApprovals"], [
                ("clubId", "clubs", ["name"]),
                ("mentorId", "profiles", ["name"]),
            ])
    populate_review_history(db, requests)
    return [serialize_document(item) for item in requests]


@router.post("/funding-requests", status_code=201)
def create_funding_request(request: Request, body: dict, profile=Depends(current_profile)):
    require_fields(body, ["clubId", "eventId", "requestedAmount", "purpose"])
    db = request.app.state.db
    club_id = as_oid(body["clubId"], "clubId")
    if not has_verified_club_access(db, club_id, profile):
        require_club_manager(db, body["clubId"], profile)
    if not collection(db, "clubs").find_one({"_id": club_id}, {"_id": 1}):
        raise HTTPException(status_code=404, detail="Club not found.")
    event_id = as_oid(body.get("eventId"), "eventId")
    event = collection(db, "events").find_one({"_id": event_id})
    if not event or not event_involves_club(event, club_id):
        raise HTTPException(status_code=404, detail="Choose an event hosted by this club.")
    values = {
        "clubId": club_id,
        "eventId": event_id,
        "requestedAmount": parse_number(body["requestedAmount"], "Requested amount", 0.01),
        "purpose": body["purpose"],
        "status": "mentor_pending",
        "rejectionFeedback": "",
        "requestDate": datetime.now(timezone.utc),
        "createdBy": as_oid(profile["_id"]),
        "mentorApprovals": mentor_approval_assignments(db, event),
    }
    return insert(db, "funding", values)


@router.patch("/funding-requests/{identity}")
def edit_funding_request(request: Request, identity: str, body: dict, profile=Depends(current_profile)):
    db = request.app.state.db
    requests = collection(db, "funding")
    pending = requests.find_one({"_id": as_oid(identity)})
    if not pending:
        raise HTTPException(status_code=404, detail="Funding request not found.")
    if not has_verified_club_access(db, pending["clubId"], profile):
        raise HTTPException(status_code=403, detail="Only this club’s verified account can edit its funding request.")
    if pending.get("status") != "mentor_pending" or mentor_review_started(pending):
        raise HTTPException(status_code=409, detail="This funding request can no longer be edited after mentor review has started.")
    updates = {}
    if "requestedAmount" in body:
        updates["requestedAmount"] = parse_number(body["requestedAmount"], "Requested amount", 0.01)
    if "purpose" in body:
        purpose = body["purpose"]
        if not isinstance(purpose, str) or not purpose.strip():
            raise HTTPException(status_code=400, detail="Provide a reason for the funding request.")
        if len(purpose) > 2000:
            raise HTTPException(status_code=400, detail="Funding request purpose must be no more than 2000 characters.")
        updates["purpose"] = purpose.strip()
    if not updates:
        raise HTTPException(status_code=400, detail="Provide funding request details to update.")
    updates["updatedAt"] = datetime.now(timezone.utc)
    requests.update_one({"_id": pending["_id"]}, {"$set": updates})
    pending.update(updates)
    return serialize_document(pending)


@router.patch("/funding-requests/{identity}/approval")
def review_funding_request(request: Request, identity: str, body: dict, profile=Depends(current_profile)):
    require_fields(body, ["status"])
    if body["status"] not in ("approved", "rejected"):
        raise HTTPException(status_code=400, detail="Status must be approved or rejected.")
    rejected = body["status"] == "rejected"
    if rejected:
        require_rejection_feedback(body)
    db = request.app.state.db
    requests = collection(db, "funding")
    pending = requests.find_one({"_id": as_oid(identity)})
    if not pending:
        raise HTTPException(status_code=404, detail="Funding request not found.")
    club = collection(db, "clubs").find_one({"_id": pending["clubId"]})
    mentor_review = False
    mentors_complete = False
    if pending.get("status") in ("pending", "mentor_pending"):
        if not pending.get("mentorApprovals"):
            event_id = pending.get("eventId")
            event = collection(db, "events").find_one({"_id": event_id}) if event_id else None
            if event_id and not event:
                raise HTTPException(status_code=404, detail="The event for this funding request no longer exists.")
            pending["mentorApprovals"] = mentor_approval_assignments(
                db, event or {"clubId": pending["clubId"]}
            )
        if profile["role"] == Role.FACULTY.value:
            mentor_review, mentors_complete = review_mentor_assignment(
                pending, profile["_id"], body["status"], datetime.now(timezone.utc)
            )
    affairs_review = (
        pending.get("status") == "student_affairs_pending"
        and is_student_affairs(profile)
    )
    if not mentor_review and not affairs_review:
        raise HTTPException(status_code=403, detail="This funding request is not awaiting your review.")

    rejected = body["status"] == "rejected"
    updates = {
        "status": "rejected" if rejected else "student_affairs_pending" if mentors_complete else "mentor_pending",
        "rejectionFeedback": str(body.get("rejectionFeedback") or "").strip() if rejected else "",
        "updatedAt": datetime.now(timezone.utc),
    }
    review_stage = "mentor" if mentor_review else "student_affairs"
    audit_entry = review_history_entry(
        profile,
        body["status"],
        review_stage,
        updates["rejectionFeedback"],
        updates["updatedAt"],
    )
    if mentor_review:
        updates["mentorReviewedBy"] = as_oid(profile["_id"])
        if rejected:
            updates["rejectionStage"] = "mentor"
    elif rejected:
        updates["studentAffairsReviewedBy"] = as_oid(profile["_id"])
        updates["rejectionStage"] = "student_affairs"
    else:
        budget = collection(db, "budgets").find({"clubId": pending["clubId"]}).sort("academicYear", -1).limit(1)
        budget = next(iter(budget), None)
        if not budget:
            raise HTTPException(status_code=409, detail="This club needs a budget before funding can be approved.")

    if mentor_review or rejected:
        expected_status = pending.get("status")
        update = {"$set": {**updates, "mentorApprovals": pending.get("mentorApprovals", [])}, "$push": {"reviewHistory": audit_entry}}
        if not rejected:
            update["$unset"] = {"rejectionStage": ""}
        result = requests.update_one(
            {"_id": pending["_id"], "status": expected_status},
            update,
        )
        if not result.modified_count:
            raise HTTPException(status_code=409, detail="This request has already been reviewed.")
        pending.update(updates)
        pending.setdefault("reviewHistory", []).append(audit_entry)
        if not rejected:
            pending.pop("rejectionStage", None)
        return serialize_document(pending)

    claim = requests.update_one(
        {"_id": pending["_id"], "status": "student_affairs_pending"},
        {"$set": {
            "status": "student_affairs_processing",
            "studentAffairsReviewedBy": as_oid(profile["_id"]),
            "updatedAt": datetime.now(timezone.utc),
        }},
    )
    if not claim.modified_count:
        raise HTTPException(status_code=409, detail="This request has already been reviewed.")

    transaction = None
    budget_updated = False
    try:
        transaction = insert(db, "transactions", {
            "clubId": pending["clubId"],
            "fundingRequestId": pending["_id"],
            "amount": pending["requestedAmount"],
            "type": "credit",
            "description": f"Approved funding: {pending['purpose']}",
            "transactionDate": datetime.now(timezone.utc),
        })
        result = collection(db, "budgets").update_one(
            {"_id": budget["_id"]}, {"$inc": {"totalAllocated": pending["requestedAmount"]}}
        )
        if not result.matched_count:
            raise HTTPException(status_code=404, detail="The club budget no longer exists.")
        budget_updated = True
        updates = {
            "status": "approved",
            "rejectionFeedback": "",
            "updatedAt": datetime.now(timezone.utc),
        }
        audit_entry = review_history_entry(
            profile, "approved", "student_affairs", "", updates["updatedAt"]
        )
        result = requests.update_one(
            {"_id": pending["_id"], "status": "student_affairs_processing"},
            {
                "$set": updates,
                "$unset": {"rejectionStage": ""},
                "$push": {"reviewHistory": audit_entry},
            },
        )
        if not result.modified_count:
            raise HTTPException(status_code=409, detail="This request has already been reviewed.")
        pending["studentAffairsReviewedBy"] = as_oid(profile["_id"])
        pending.update(updates)
        pending.setdefault("reviewHistory", []).append(audit_entry)
        pending.pop("rejectionStage", None)
    except Exception as error:
        logger.exception("Funding approval failed; rolling back the transaction and request state.")
        if transaction:
            collection(db, "transactions").delete_one({"_id": as_oid(transaction["_id"])})
        if budget_updated:
            collection(db, "budgets").update_one(
                {"_id": budget["_id"]}, {"$inc": {"totalAllocated": -pending["requestedAmount"]}}
            )
        requests.update_one(
            {"_id": pending["_id"], "status": "student_affairs_processing"},
            {"$set": {"status": "student_affairs_pending", "updatedAt": datetime.now(timezone.utc)},
             "$unset": {"studentAffairsReviewedBy": ""}},
        )
        if isinstance(error, HTTPException):
            raise
        raise HTTPException(status_code=500, detail="Funding approval could not be recorded.") from error
    return serialize_document(pending)


@router.get("/budgets")
def list_budgets(request: Request, clubId: str | None = None, profile=Depends(current_profile)):
    db = request.app.state.db
    verified_access = has_verified_club_access(db, profile.get("verifiedClubId"), profile)
    if profile["role"] == Role.COMMITTEE.value and has_office_bearer_membership(db, profile["_id"]) and not verified_access:
        raise HTTPException(status_code=403, detail="Office bearers cannot access club budgets.")
    query = {}
    if clubId:
        club_id = as_oid(clubId, "clubId")
        if verified_access and club_id != as_oid(profile["verifiedClubId"]):
            raise HTTPException(status_code=403, detail="A verified club session can only access its club budget.")
        if not can_manage_club(db, clubId, profile):
            if not has_verified_club_access(db, club_id, profile):
                raise HTTPException(status_code=403, detail="Not allowed to view this club’s budget.")
        query["clubId"] = club_id
    elif profile["role"] != Role.ADMIN.value:
        query["clubId"] = {"$in": [as_oid(profile["verifiedClubId"])] if verified_access else visible_club_ids(db, profile)}
    budgets = list(collection(db, "budgets").find(query).sort("academicYear", -1))
    populate_many(db, budgets, [("clubId", "clubs", ["name"])])
    return [serialize_document(item) for item in budgets]


@router.post("/budgets", status_code=201)
def create_budget(request: Request, body: dict, profile=Depends(current_profile)):
    if profile["role"] != Role.ADMIN.value:
        raise HTTPException(status_code=403, detail="You do not have permission to perform this action.")
    require_fields(body, ["clubId", "academicYear", "totalAllocated"])
    db = request.app.state.db
    club_id = as_oid(body["clubId"], "clubId")
    if not collection(db, "clubs").find_one({"_id": club_id}, {"_id": 1}):
        raise HTTPException(status_code=404, detail="Club not found.")
    return insert(db, "budgets", {
        "clubId": club_id,
        "academicYear": body["academicYear"],
        "totalAllocated": parse_number(body["totalAllocated"], "Total allocated", 0),
        "totalSpent": 0,
    })


@router.get("/transactions")
def list_transactions(request: Request, profile=Depends(current_profile)):
    db = request.app.state.db
    is_finance_manager = profile["role"] in (Role.FACULTY.value, Role.ADMIN.value)
    if not is_finance_manager:
        raise HTTPException(status_code=403, detail="You do not have permission to perform this action.")
    ids = None if profile["role"] == Role.ADMIN.value else visible_club_ids(db, profile)
    query = {} if ids is None else {"clubId": {"$in": ids}}
    records = list(collection(db, "transactions").find(query).sort("transactionDate", -1))
    populate_many(db, records, [("clubId", "clubs", ["name"])])
    return [serialize_document(item) for item in records]


@router.post("/transactions", status_code=201)
def create_transaction(request: Request, body: dict, profile=Depends(current_profile)):
    if profile["role"] != Role.ADMIN.value:
        raise HTTPException(status_code=403, detail="You do not have permission to perform this action.")
    require_fields(body, ["clubId", "amount", "type", "description"])
    if body["type"] not in ("credit", "debit"):
        raise HTTPException(status_code=400, detail="Type must be credit or debit.")
    try:
        amount = parse_number(body["amount"], "Amount", 0.01)
    except (ValueError, TypeError):
        amount = 0
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be a positive number.")
    db = request.app.state.db
    club_id = as_oid(body["clubId"], "clubId")
    budget = next(iter(collection(db, "budgets").find({"clubId": club_id}).sort("academicYear", -1).limit(1)), None)
    if not budget:
        raise HTTPException(status_code=404, detail="Create a club budget before recording a transaction.")
    budgets = collection(db, "budgets")
    if body["type"] == "debit":
        updated = budgets.find_one_and_update(
            {
                "_id": budget["_id"],
                "$expr": {"$lte": [{"$add": [{"$ifNull": ["$totalSpent", 0]}, amount]}, "$totalAllocated"]},
            },
            {"$inc": {"totalSpent": amount}},
            return_document=ReturnDocument.AFTER,
        )
        field = "totalSpent"
    else:
        updated = budgets.find_one_and_update(
            {"_id": budget["_id"]}, {"$inc": {"totalAllocated": amount}}, return_document=ReturnDocument.AFTER
        )
        field = "totalAllocated"
    if not updated:
        raise HTTPException(status_code=409, detail="This transaction exceeds the club’s remaining budget.")
    try:
        return insert(db, "transactions", {
            "clubId": club_id,
            "amount": amount,
            "type": body["type"],
            "description": body["description"],
            "transactionDate": datetime.now(timezone.utc),
        })
    except Exception:
        budgets.update_one({"_id": budget["_id"]}, {"$inc": {field: -amount}})
        raise


@router.get("/equipment")
def list_equipment(request: Request, clubId: str | None = None, profile=Depends(current_profile)):
    db = request.app.state.db
    verified_access = has_verified_club_access(db, profile.get("verifiedClubId"), profile)
    if verified_access:
        verified_club_id = as_oid(profile["verifiedClubId"])
        requested_club_id = as_oid(clubId, "clubId") if clubId else verified_club_id
        if requested_club_id != verified_club_id:
            raise HTTPException(status_code=403, detail="A verified club session can only access its club equipment.")
        query = {"clubId": verified_club_id}
    else:
        query = {"clubId": as_oid(clubId, "clubId")} if clubId else {}
    records = list(collection(db, "equipment").find(query).sort("name", 1))
    populate_many(db, records, [("clubId", "clubs", ["name"])])
    return [serialize_document(item) for item in records]


@router.post("/equipment", status_code=201)
def create_equipment(request: Request, body: dict, profile=Depends(current_profile)):
    require_fields(body, ["clubId", "name", "totalQuantity"])
    db = request.app.state.db
    require_club_manager(db, body["clubId"], profile)
    quantity = parse_number(body["totalQuantity"], "Total quantity", 1)
    return insert(db, "equipment", {
        "clubId": as_oid(body["clubId"], "clubId"),
        "name": body["name"],
        "description": body.get("description", ""),
        "totalQuantity": quantity,
        "availableQuantity": quantity,
        "condition": body.get("condition", "good"),
    })


@router.get("/equipment-borrows")
def list_borrows(request: Request, profile=Depends(current_profile)):
    db = request.app.state.db
    verified_access = has_verified_club_access(db, profile.get("verifiedClubId"), profile)
    ids = [as_oid(profile["verifiedClubId"])] if verified_access else visible_club_ids(db, profile)
    query = {}
    if profile["role"] != Role.ADMIN.value:
        query = {"clubId": {"$in": ids}} if verified_access else {
            "$or": [{"profileId": as_oid(profile["_id"])}, {"clubId": {"$in": ids}}]
        }
        if profile["role"] == Role.FACULTY.value and ids:
            related_event_ids = [
                event["_id"] for event in collection(db, "events").find({
                    "$or": [{"clubId": {"$in": ids}}, {"coHostIds": {"$in": ids}}]
                }, {"_id": 1})
            ]
            query = {"$or": [
                {"profileId": as_oid(profile["_id"])},
                {"clubId": {"$in": ids}},
                {"eventId": {"$in": related_event_ids}},
            ]}
    borrows = collection(db, "borrows")
    borrows.update_many(
        {**query, "status": "borrowed", "dueDate": {"$lt": datetime.now(timezone.utc)}},
        {"$set": {"status": "overdue"}},
    )
    records = list(borrows.find(query).sort("borrowDate", -1))
    populate_many(db, records, [
        ("equipmentId", "equipment", ["name", "clubId", "availableQuantity"]),
        ("clubId", "clubs", ["name"]),
        ("eventId", "events", ["title", "eventDate"]),
        ("profileId", "profiles", ["name", "email"]),
        ("mentorReviewedBy", "profiles", ["name"]),
        ("studentAffairsReviewedBy", "profiles", ["name"]),
    ])
    for item in records:
        if item.get("mentorApprovals"):
            populate_many(db, item["mentorApprovals"], [
                ("clubId", "clubs", ["name"]),
                ("mentorId", "profiles", ["name"]),
            ])
    populate_review_history(db, records)
    return [serialize_document(item) for item in records]


@router.post("/equipment-borrows", status_code=201)
def request_borrow(request: Request, body: dict, profile=Depends(current_profile)):
    now = datetime.now(timezone.utc)
    legacy_request = "startDate" not in body and "endDate" not in body and body.get("dueDate")
    require_fields(body, ["equipmentId", "clubId"])
    if legacy_request:
        start_date = now
        end_date = parse_date(body["dueDate"], "Choose a valid end time.")
        quantity = 1
    else:
        require_fields(body, ["startDate", "endDate", "quantity"])
        start_date = parse_date(body["startDate"], "Choose a valid start time.")
        end_date = parse_date(body["endDate"], "Choose a valid end time.")
        quantity = parse_number(body["quantity"], "Quantity", 1)
        if not quantity.is_integer():
            raise HTTPException(status_code=400, detail="Quantity must be a whole number.")
        quantity = int(quantity)
    if start_date < now:
        raise HTTPException(status_code=400, detail="Choose a start time in the future.")
    if end_date <= start_date:
        raise HTTPException(status_code=400, detail="The end time must be after the start time.")
    db = request.app.state.db
    club_id = as_oid(body["clubId"], "clubId")
    club = collection(db, "clubs").find_one({"_id": club_id})
    if not club:
        raise HTTPException(status_code=404, detail="Club not found.")
    if not (club.get("mentor") or club.get("mentorIds")):
        raise HTTPException(status_code=409, detail="Assign a faculty mentor to this club before requesting equipment.")
    membership = active_membership(db, club_id, profile["_id"])
    if not is_executive(membership) and not has_verified_club_access(db, club_id, profile):
        raise HTTPException(status_code=403, detail="Only active club executives can request equipment borrowing approval.")
    event_id = as_oid(body["eventId"], "eventId") if body.get("eventId") else None
    event = collection(db, "events").find_one({"_id": event_id}) if event_id else None
    if event_id and (not event or not event_involves_club(event, club_id)):
        raise HTTPException(status_code=404, detail="Choose an event hosted by this club.")
    equipment_id = as_oid(body["equipmentId"], "equipmentId")
    equipment = collection(db, "equipment").find_one({"_id": equipment_id, "clubId": club_id})
    if not equipment:
        raise HTTPException(status_code=404, detail="Equipment not found in this club.")
    if equipment.get("availableQuantity", 0) < quantity:
        raise HTTPException(status_code=409, detail="The requested quantity is no longer available.")
    purpose = body.get("purpose", "")
    if not isinstance(purpose, str):
        raise HTTPException(status_code=400, detail="Equipment request purpose must be text.")
    purpose = purpose.strip()
    if not purpose:
        raise HTTPException(status_code=400, detail="Enter a reason for requesting this equipment.")
    if len(purpose) > 1000:
        raise HTTPException(status_code=400, detail="Equipment request purpose must be no more than 1000 characters.")
    approval_event = event or {"clubId": club_id, "coHostIds": []}
    return insert(db, "borrows", {
        "equipmentId": equipment_id,
        "clubId": club_id,
        "eventId": event_id,
        "mentorApprovals": mentor_approval_assignments(db, approval_event),
        "profileId": as_oid(profile["_id"]),
        "quantity": quantity,
        "purpose": purpose,
        "startDate": start_date,
        "endDate": end_date,
        "dueDate": end_date,
        "borrowDate": now,
        "status": "mentor_pending",
        "rejectionFeedback": "",
        "reviewHistory": [],
    })


@router.patch("/equipment-borrows/{identity}")
def edit_borrow_request(request: Request, identity: str, body: dict, profile=Depends(current_profile)):
    db = request.app.state.db
    borrows = collection(db, "borrows")
    borrow = borrows.find_one({"_id": as_oid(identity)})
    if not borrow:
        raise HTTPException(status_code=404, detail="Equipment request not found.")
    if not has_verified_club_access(db, borrow["clubId"], profile):
        raise HTTPException(status_code=403, detail="Only this club’s verified account can edit its equipment request.")
    if borrow.get("status") != "mentor_pending" or mentor_review_started(borrow):
        raise HTTPException(status_code=409, detail="This equipment request can no longer be edited after mentor review has started.")
    updates = {}
    if any(field in body for field in ("quantity", "startDate", "endDate", "dueDate")):
        legacy_end_date_edit = "dueDate" in body and "startDate" not in body and "endDate" not in body
        start_value = body.get("startDate", borrow.get("startDate") or datetime.now(timezone.utc))
        end_value = body.get("endDate", body.get("dueDate", borrow.get("endDate") or borrow.get("dueDate")))
        start_date = parse_date(start_value, "Choose a valid start time.")
        end_date = parse_date(end_value, "Choose a valid end time.")
        if start_date < datetime.now(timezone.utc) and not legacy_end_date_edit:
            raise HTTPException(status_code=400, detail="Choose a start time in the future.")
        if end_date <= start_date:
            raise HTTPException(status_code=400, detail="The end time must be after the start time.")
        quantity = parse_number(body.get("quantity", borrow.get("quantity", 1)), "Quantity", 1)
        if not quantity.is_integer():
            raise HTTPException(status_code=400, detail="Quantity must be a whole number.")
        quantity = int(quantity)
        if "quantity" in body:
            equipment = collection(db, "equipment").find_one({"_id": borrow["equipmentId"]}, {"availableQuantity": 1})
            if not equipment or equipment.get("availableQuantity", 0) < quantity:
                raise HTTPException(status_code=409, detail="The requested quantity is no longer available.")
        updates.update({
            "quantity": quantity,
            "startDate": start_date,
            "endDate": end_date,
            "dueDate": end_date,
        })
    if "purpose" in body:
        purpose = body["purpose"]
        if not isinstance(purpose, str):
            raise HTTPException(status_code=400, detail="Equipment request purpose must be text.")
        purpose = purpose.strip()
        if len(purpose) > 1000:
            raise HTTPException(status_code=400, detail="Equipment request purpose must be no more than 1000 characters.")
        updates["purpose"] = purpose
    if not updates:
        raise HTTPException(status_code=400, detail="Provide equipment request details to update.")
    updates["updatedAt"] = datetime.now(timezone.utc)
    borrows.update_one({"_id": borrow["_id"]}, {"$set": updates})
    borrow.update(updates)
    return serialize_document(borrow)


@router.patch("/equipment-borrows/{identity}/approval")
def approve_borrow(request: Request, identity: str, body: dict, profile=Depends(current_profile)):
    require_fields(body, ["status"])
    if body["status"] not in ("approved", "rejected"):
        raise HTTPException(status_code=400, detail="Status must be approved or rejected.")
    rejected = body["status"] == "rejected"
    if rejected:
        require_rejection_feedback(body)
    db = request.app.state.db
    borrows = collection(db, "borrows")
    borrow = borrows.find_one({"_id": as_oid(identity)})
    if not borrow:
        raise HTTPException(status_code=404, detail="Equipment request not found.")
    mentor_review = False
    mentors_complete = False
    if borrow.get("status") == "mentor_pending":
        if not borrow.get("mentorApprovals"):
            event_id = borrow.get("eventId")
            event = collection(db, "events").find_one({"_id": event_id}) if event_id else None
            if event_id and not event:
                raise HTTPException(status_code=404, detail="The event for this equipment request no longer exists.")
            borrow["mentorApprovals"] = mentor_approval_assignments(
                db, event or {"clubId": borrow["clubId"]}
            )
        if profile["role"] == Role.FACULTY.value:
            mentor_review, mentors_complete = review_mentor_assignment(
                borrow, profile["_id"], body["status"], datetime.now(timezone.utc)
            )
    affairs_review = borrow.get("status") == "student_affairs_pending" and is_student_affairs(profile)
    if not mentor_review and not affairs_review:
        raise HTTPException(status_code=403, detail="This equipment request is not awaiting your approval.")
    if mentor_review:
        borrow["mentorReviewedBy"] = as_oid(profile["_id"])
        borrow["status"] = "rejected" if rejected else "student_affairs_pending" if mentors_complete else "mentor_pending"
        if rejected:
            borrow["rejectionStage"] = "mentor"
    elif rejected:
        borrow["studentAffairsReviewedBy"] = as_oid(profile["_id"])
        borrow["status"] = "rejected"
        borrow["rejectionStage"] = "student_affairs"
    else:
        quantity = borrow.get("quantity", 1)
        equipment = collection(db, "equipment").find_one_and_update(
            {"_id": borrow["equipmentId"], "availableQuantity": {"$gte": quantity}},
            {"$inc": {"availableQuantity": -quantity}},
            return_document=ReturnDocument.AFTER,
        )
        if not equipment:
            raise HTTPException(status_code=409, detail="The equipment is no longer available.")
        borrow["studentAffairsReviewedBy"] = as_oid(profile["_id"])
        borrow["status"] = "borrowed"
    borrow["rejectionFeedback"] = str(body.get("rejectionFeedback", "")).strip() if rejected else ""
    borrow["updatedAt"] = datetime.now(timezone.utc)
    stage = "mentor" if mentor_review else "student_affairs"
    borrow.setdefault("reviewHistory", []).append(review_history_entry(
        profile, body["status"], stage, borrow["rejectionFeedback"], borrow["updatedAt"]
    ))
    collection(db, "borrows").replace_one({"_id": borrow["_id"]}, borrow)
    return serialize_document(borrow)


@router.patch("/equipment-borrows/{identity}/return")
def return_borrow(request: Request, identity: str, profile=Depends(current_profile)):
    db = request.app.state.db
    borrows = collection(db, "borrows")
    borrow = borrows.find_one({"_id": as_oid(identity)})
    if not borrow:
        raise HTTPException(status_code=404, detail="Equipment request not found.")
    membership = active_membership(db, borrow["clubId"], profile["_id"])
    if (
        profile["role"] != Role.ADMIN.value
        and str(borrow.get("profileId")) != profile["_id"]
        and not membership
        and not has_verified_club_access(db, borrow["clubId"], profile)
    ):
        raise HTTPException(status_code=403, detail="Not allowed to return this equipment.")
    returned = borrows.find_one_and_update(
        {"_id": borrow["_id"], "status": {"$in": ["borrowed", "overdue"]}},
        {"$set": {"status": "returned", "returnDate": datetime.now(timezone.utc), "updatedAt": datetime.now(timezone.utc)}},
        return_document=ReturnDocument.AFTER,
    )
    if not returned:
        raise HTTPException(status_code=409, detail="This equipment has already been returned.")
    collection(db, "equipment").update_one(
        {"_id": borrow["equipmentId"]},
        {"$inc": {"availableQuantity": borrow.get("quantity", 1)}},
    )
    return serialize_document(returned)


@router.get("/clubs/{club_identity}/messages")
def list_messages(request: Request, club_identity: str, group: str = "members", profile=Depends(current_profile)):
    db = request.app.state.db
    club_id = as_oid(club_identity, "clubId")
    if profile.get("verifiedClubId") and not has_verified_club_access(db, club_id, profile):
        raise HTTPException(status_code=403, detail="A verified club session can only access its club chat.")
    group = "office_bearers" if group == "office_bearers" else "members"
    membership = active_membership(db, club_id, profile["_id"])
    if not membership and profile["role"] != Role.ADMIN.value:
        raise HTTPException(status_code=403, detail="Join this club to access its group chat.")
    if group == "office_bearers" and profile["role"] != Role.ADMIN.value and not (
        membership.get("position") in OFFICE_BEARER_POSITIONS
        or (membership.get("position") == "executive" and membership.get("officeBearerGroup"))
    ):
        raise HTTPException(status_code=403, detail="The office-bearers chat is private to this club’s office bearers.")
    messages = list(collection(db, "messages").find({"clubId": club_id, "group": group}).sort("createdAt", -1).limit(100))
    populate_many(db, messages, [("senderId", "profiles", ["name"])])
    return [serialize_document(item) for item in messages]


@router.post("/clubs/{club_identity}/messages", status_code=201)
def send_message(request: Request, club_identity: str, body: dict, profile=Depends(current_profile)):
    require_fields(body, ["content", "group"])
    if body["group"] not in ("members", "office_bearers"):
        raise HTTPException(status_code=400, detail="Invalid chat group.")
    db = request.app.state.db
    club_id = as_oid(club_identity, "clubId")
    if profile.get("verifiedClubId") and not has_verified_club_access(db, club_id, profile):
        raise HTTPException(status_code=403, detail="A verified club session can only access its club chat.")
    membership = active_membership(db, club_id, profile["_id"])
    if not membership and profile["role"] != Role.ADMIN.value:
        raise HTTPException(status_code=403, detail="Join this club to send a message.")
    if body["group"] == "office_bearers" and profile["role"] != Role.ADMIN.value and not (
        membership.get("position") in OFFICE_BEARER_POSITIONS
        or (membership.get("position") == "executive" and membership.get("officeBearerGroup"))
    ):
        raise HTTPException(status_code=403, detail="Only this club’s office bearers can send messages to their private group.")
    message = insert(db, "messages", {
        "clubId": club_id,
        "senderId": as_oid(profile["_id"]),
        "group": body["group"],
        "content": body["content"],
    })
    record = collection(db, "messages").find_one({"_id": as_oid(message["_id"])})
    populate_many(db, [record], [("senderId", "profiles", ["name"])])
    return serialize_document(record)


@router.get("/reports/summary")
def report_summary(request: Request, profile=Depends(current_profile)):
    db = request.app.state.db
    verified_access = has_verified_club_access(db, profile.get("verifiedClubId"), profile)
    if profile["role"] == Role.COMMITTEE.value and has_office_bearer_membership(db, profile["_id"]) and not verified_access:
        raise HTTPException(status_code=403, detail="The club report dashboard is available to mentors and Student Affairs.")
    ids = [as_oid(profile["verifiedClubId"])] if verified_access else visible_club_ids(db, profile)
    ids_query = {"$in": ids}
    clubs_count = (
        collection(db, "clubs").count_documents({"organizationType": {"$ne": "event_organizer"}})
        if profile["role"] == Role.ADMIN.value
        else len(ids)
    )
    events_count = collection(db, "events").count_documents({"clubId": ids_query})
    members_count = collection(db, "members").count_documents({"clubId": ids_query})
    pending_apps = collection(db, "applications").count_documents({"clubId": ids_query, "status": "pending"})
    equipment_count = collection(db, "equipment").count_documents({"clubId": ids_query})
    budgets = list(collection(db, "budgets").find({"clubId": ids_query}, {"totalAllocated": 1, "totalSpent": 1}))
    allocated_total = sum(item.get("totalAllocated", 0) for item in budgets)
    spent_total = sum(item.get("totalSpent", 0) for item in budgets)
    report_ids = (
        [item["_id"] for item in collection(db, "clubs").find({"organizationType": {"$ne": "event_organizer"}}, {"_id": 1})]
        if profile["role"] == Role.ADMIN.value
        else ids if verified_access else visible_club_ids(db, profile, OFFICE_BEARER_POSITIONS)
    )
    clubs = list(collection(db, "clubs").find({"_id": {"$in": report_ids}}, {"name": 1, "category": 1}).sort("name", 1))
    reports = []
    has_budget_access = profile["role"] in (Role.ADMIN.value, Role.FACULTY.value) or verified_access
    for club in clubs:
        club_id = club["_id"]
        budget = next(iter(collection(db, "budgets").find({"clubId": club_id}).sort("academicYear", -1).limit(1)), None)
        may_view_budget = has_budget_access or can_review_memberships(db, club_id, profile)
        reports.append(serialize_document({
            "_id": club_id,
            "name": club.get("name"),
            "category": club.get("category"),
            "members": collection(db, "members").count_documents({"clubId": club_id}),
            "events": collection(db, "events").count_documents({"clubId": club_id}),
            "reportsSubmitted": collection(db, "event_reports").count_documents({"clubId": club_id}),
            "pendingApplications": collection(db, "applications").count_documents({"clubId": club_id, "status": "pending"}),
            "announcements": collection(db, "announcements").count_documents({"clubId": club_id}),
            "allocated": (budget or {}).get("totalAllocated", 0) if may_view_budget else 0,
            "spent": (budget or {}).get("totalSpent", 0) if may_view_budget else 0,
        }))
    may_view_all_budgets = has_budget_access or any(can_review_memberships(db, club_id, profile) for club_id in report_ids)
    return {
        "clubs": clubs_count,
        "events": events_count,
        "members": members_count,
        "pendingApplications": pending_apps,
        "equipment": equipment_count,
        "reportsSubmitted": collection(db, "event_reports").count_documents({"clubId": ids_query}),
        "allocated": allocated_total if may_view_all_budgets else 0,
        "spent": spent_total if may_view_all_budgets else 0,
        "clubReports": reports,
    }
