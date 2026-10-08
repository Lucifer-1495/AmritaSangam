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
    collection,
    insert,
    parse_number,
    parse_date,
    populate_many,
    require_club_manager,
    require_fields,
    require_rejection_feedback,
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
    require_club_manager(db, body["clubId"], profile)
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
    ids = visible_club_ids(db, profile)
    query = {} if profile["role"] == Role.ADMIN.value else {"clubId": {"$in": ids}}
    requests = list(collection(db, "funding").find(query).sort("requestDate", -1))
    populate_many(db, requests, [("clubId", "clubs", ["name"])])
    return [serialize_document(item) for item in requests]


@router.post("/funding-requests", status_code=201)
def create_funding_request(request: Request, body: dict, profile=Depends(current_profile)):
    require_fields(body, ["clubId", "requestedAmount", "purpose"])
    db = request.app.state.db
    require_club_manager(db, body["clubId"], profile)
    club_id = as_oid(body["clubId"], "clubId")
    if not collection(db, "clubs").find_one({"_id": club_id}, {"_id": 1}):
        raise HTTPException(status_code=404, detail="Club not found.")
    values = {
        "clubId": club_id,
        "requestedAmount": parse_number(body["requestedAmount"], "Requested amount", 0.01),
        "purpose": body["purpose"],
        "status": "pending",
        "rejectionFeedback": "",
        "requestDate": datetime.now(timezone.utc),
    }
    if body.get("eventId"):
        values["eventId"] = as_oid(body["eventId"], "eventId")
    return insert(db, "funding", values)


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
    if profile["role"] != Role.ADMIN.value and str((club or {}).get("mentor", "")) != profile["_id"]:
        raise HTTPException(status_code=403, detail="Only the assigned club mentor or Student Affairs can review this request.")
    budget = None
    if not rejected:
        budget = collection(db, "budgets").find({"clubId": pending["clubId"]}).sort("academicYear", -1).limit(1)
        budget = next(iter(budget), None)
        if not budget:
            raise HTTPException(status_code=409, detail="This club needs a budget before funding can be approved.")
    updates = {
        "status": body["status"],
        "reviewedBy": as_oid(profile["_id"]),
        "rejectionFeedback": str(body.get("rejectionFeedback") or "").strip(),
        "updatedAt": datetime.now(timezone.utc),
    }
    result = requests.update_one({"_id": pending["_id"], "status": "pending"}, {"$set": updates})
    if not result.modified_count:
        raise HTTPException(status_code=409, detail="This request has already been reviewed.")
    pending.update(updates)
    if not rejected:
        transaction = None
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
        except Exception as error:
            logger.exception("Funding approval failed; rolling back the transaction and request state.")
            if transaction:
                collection(db, "transactions").delete_one({"_id": as_oid(transaction["_id"])})
            requests.update_one(
                {"_id": pending["_id"], "status": "approved", "reviewedBy": as_oid(profile["_id"])},
                {"$set": {"status": "pending", "updatedAt": datetime.now(timezone.utc)}, "$unset": {"reviewedBy": ""}},
            )
            if isinstance(error, HTTPException):
                raise
            raise HTTPException(status_code=500, detail="Funding approval could not be recorded.") from error
    return serialize_document(pending)


@router.get("/budgets")
def list_budgets(request: Request, clubId: str | None = None, profile=Depends(current_profile)):
    db = request.app.state.db
    query = {}
    if clubId:
        club_id = as_oid(clubId, "clubId")
        if not can_manage_club(db, clubId, profile):
            raise HTTPException(status_code=403, detail="Not allowed to view this club’s budget.")
        query["clubId"] = club_id
    elif profile["role"] != Role.ADMIN.value:
        query["clubId"] = {"$in": visible_club_ids(db, profile)}
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
    if profile["role"] not in (Role.FACULTY.value, Role.ADMIN.value):
        raise HTTPException(status_code=403, detail="You do not have permission to perform this action.")
    db = request.app.state.db
    ids = visible_club_ids(db, profile)
    query = {} if profile["role"] == Role.ADMIN.value else {"clubId": {"$in": ids}}
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
    ids = visible_club_ids(db, profile)
    query = {} if profile["role"] == Role.ADMIN.value else {
        "$or": [{"profileId": as_oid(profile["_id"])}, {"clubId": {"$in": ids}}]
    }
    borrows = collection(db, "borrows")
    borrows.update_many(
        {**query, "status": "borrowed", "dueDate": {"$lt": datetime.now(timezone.utc)}},
        {"$set": {"status": "overdue"}},
    )
    records = list(borrows.find(query).sort("borrowDate", -1))
    populate_many(db, records, [
        ("equipmentId", "equipment", ["name", "clubId"]),
        ("clubId", "clubs", ["name"]),
        ("profileId", "profiles", ["name", "email"]),
    ])
    return [serialize_document(item) for item in records]


@router.post("/equipment-borrows", status_code=201)
def request_borrow(request: Request, body: dict, profile=Depends(current_profile)):
    require_fields(body, ["equipmentId", "clubId", "dueDate"])
    due_date = parse_date(body["dueDate"], "Choose a due date in the future.")
    if due_date <= datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Choose a due date in the future.")
    db = request.app.state.db
    club_id = as_oid(body["clubId"], "clubId")
    club = collection(db, "clubs").find_one({"_id": club_id})
    if not club:
        raise HTTPException(status_code=404, detail="Club not found.")
    if not club.get("mentor"):
        raise HTTPException(status_code=409, detail="Assign a faculty mentor to this club before requesting equipment.")
    membership = active_membership(db, club_id, profile["_id"])
    if not membership or membership.get("position") != "president":
        raise HTTPException(status_code=403, detail="Only this club’s president can request equipment borrowing approval.")
    equipment_id = as_oid(body["equipmentId"], "equipmentId")
    equipment = collection(db, "equipment").find_one({"_id": equipment_id, "clubId": club_id})
    if not equipment:
        raise HTTPException(status_code=404, detail="Equipment not found in this club.")
    if equipment.get("availableQuantity", 0) < 1:
        raise HTTPException(status_code=409, detail="This equipment is unavailable.")
    return insert(db, "borrows", {
        "equipmentId": equipment_id,
        "clubId": club_id,
        "profileId": as_oid(profile["_id"]),
        "dueDate": due_date,
        "borrowDate": datetime.now(timezone.utc),
        "status": "mentor_pending",
        "rejectionFeedback": "",
    })


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
    club = collection(db, "clubs").find_one({"_id": borrow["clubId"]})
    mentor_review = borrow.get("status") == "mentor_pending" and str((club or {}).get("mentor", "")) == profile["_id"]
    affairs_review = borrow.get("status") == "student_affairs_pending" and profile["role"] == Role.ADMIN.value
    if not mentor_review and not affairs_review:
        raise HTTPException(status_code=403, detail="This equipment request is not awaiting your approval.")
    if mentor_review:
        borrow["mentorReviewedBy"] = as_oid(profile["_id"])
        borrow["status"] = "rejected" if rejected else "student_affairs_pending"
        if rejected:
            borrow["rejectionStage"] = "mentor"
    elif rejected:
        borrow["studentAffairsReviewedBy"] = as_oid(profile["_id"])
        borrow["status"] = "rejected"
        borrow["rejectionStage"] = "student_affairs"
    else:
        equipment = collection(db, "equipment").find_one_and_update(
            {"_id": borrow["equipmentId"], "availableQuantity": {"$gt": 0}},
            {"$inc": {"availableQuantity": -1}},
            return_document=ReturnDocument.AFTER,
        )
        if not equipment:
            raise HTTPException(status_code=409, detail="The equipment is no longer available.")
        borrow["studentAffairsReviewedBy"] = as_oid(profile["_id"])
        borrow["status"] = "borrowed"
    borrow["rejectionFeedback"] = str(body.get("rejectionFeedback", "")).strip() if rejected else ""
    borrow["updatedAt"] = datetime.now(timezone.utc)
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
    if profile["role"] != Role.ADMIN.value and str(borrow.get("profileId")) != profile["_id"] and not membership:
        raise HTTPException(status_code=403, detail="Not allowed to return this equipment.")
    returned = borrows.find_one_and_update(
        {"_id": borrow["_id"], "status": {"$in": ["borrowed", "overdue"]}},
        {"$set": {"status": "returned", "returnDate": datetime.now(timezone.utc), "updatedAt": datetime.now(timezone.utc)}},
        return_document=ReturnDocument.AFTER,
    )
    if not returned:
        raise HTTPException(status_code=409, detail="This equipment has already been returned.")
    collection(db, "equipment").update_one({"_id": borrow["equipmentId"]}, {"$inc": {"availableQuantity": 1}})
    return serialize_document(returned)


@router.get("/clubs/{club_identity}/messages")
def list_messages(request: Request, club_identity: str, group: str = "members", profile=Depends(current_profile)):
    db = request.app.state.db
    club_id = as_oid(club_identity, "clubId")
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
    ids = visible_club_ids(db, profile)
    ids_query = {"$in": ids}
    clubs_count = collection(db, "clubs").count_documents({}) if profile["role"] == Role.ADMIN.value else len(ids)
    events_count = collection(db, "events").count_documents({"clubId": ids_query})
    members_count = collection(db, "members").count_documents({"clubId": ids_query})
    pending_apps = collection(db, "applications").count_documents({"clubId": ids_query, "status": "pending"})
    equipment_count = collection(db, "equipment").count_documents({"clubId": ids_query})
    budgets = list(collection(db, "budgets").find({"clubId": ids_query}, {"totalAllocated": 1, "totalSpent": 1}))
    allocated_total = sum(item.get("totalAllocated", 0) for item in budgets)
    spent_total = sum(item.get("totalSpent", 0) for item in budgets)
    report_ids = (
        [item["_id"] for item in collection(db, "clubs").find({}, {"_id": 1})]
        if profile["role"] == Role.ADMIN.value
        else visible_club_ids(db, profile, OFFICE_BEARER_POSITIONS)
    )
    clubs = list(collection(db, "clubs").find({"_id": {"$in": report_ids}}, {"name": 1, "category": 1}).sort("name", 1))
    reports = []
    has_budget_access = profile["role"] in (Role.ADMIN.value, Role.FACULTY.value)
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
        "allocated": allocated_total if may_view_all_budgets else 0,
        "spent": spent_total if may_view_all_budgets else 0,
        "clubReports": reports,
    }
