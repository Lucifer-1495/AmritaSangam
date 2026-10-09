from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pymongo.errors import DuplicateKeyError

from ..auth import current_profile
from ..database import serialize_document
from ..models import Role
from ..services.common import (
    OFFICE_BEARER_POSITIONS,
    STUDENT_ROLES,
    active_membership,
    as_oid,
    can_manage_club,
    can_review_memberships,
    collection,
    insert,
    populate_many,
    require_club_manager,
    require_fields,
    visible_club_ids,
)
from ..services.media import validate_image_data_url


router = APIRouter()


def normalize_domains(value):
    if value is None:
        return ["General"]
    if isinstance(value, str):
        values = value.replace(",", "\n").splitlines()
    elif isinstance(value, list):
        values = value
    else:
        raise HTTPException(status_code=400, detail="Club domains must be a list of names.")
    domains = []
    seen = set()
    for item in values:
        if not isinstance(item, str):
            raise HTTPException(status_code=400, detail="Club domain names must be text.")
        domain = item.strip()
        key = domain.casefold()
        if not domain or key in seen:
            continue
        if len(domain) > 60:
            raise HTTPException(status_code=400, detail="Each club domain must be 60 characters or fewer.")
        domains.append(domain)
        seen.add(key)
    if not domains:
        raise HTTPException(status_code=400, detail="Add at least one application domain for this club.")
    if len(domains) > 20:
        raise HTTPException(status_code=400, detail="A club can have at most 20 application domains.")
    return domains


@router.get("/my/clubs")
def my_clubs(request: Request, profile=Depends(current_profile)):
    db = request.app.state.db
    ids = None if profile["role"] == Role.ADMIN.value else visible_club_ids(db, profile)
    query = {} if ids is None else {"_id": {"$in": ids}}
    clubs = list(collection(db, "clubs").find(query).sort("name", 1))
    populate_many(db, clubs, [("mentor", "profiles", ["name", "email"])])
    return [serialize_document(club) for club in clubs]


@router.post("/clubs", status_code=201)
def create_club(request: Request, body: dict, profile=Depends(current_profile)):
    if profile["role"] != Role.ADMIN.value:
        raise HTTPException(status_code=403, detail="You do not have permission to perform this action.")
    require_fields(body, ["name", "description", "clubType", "mentor"])
    if body["clubType"] not in ("technical", "non_technical"):
        raise HTTPException(status_code=400, detail="Choose a technical or non-technical club type.")
    mentor_id = as_oid(body["mentor"], "mentor")
    mentor = collection(request.app.state.db, "profiles").find_one({
        "_id": mentor_id, "role": Role.FACULTY.value
    }, {"_id": 1})
    if not mentor:
        raise HTTPException(status_code=400, detail="Choose a faculty mentor account created by ICTS.")
    club_data = {
        "name": body["name"],
        "description": body["description"],
        "category": body.get("category") or "Community",
        "clubType": body["clubType"],
        "domains": normalize_domains(body.get("domains")),
        "mentor": mentor_id,
        "recruitmentOpen": bool(body.get("recruitmentOpen")),
        "foundedDate": datetime.now(timezone.utc),
    }
    if "logoUrl" in body:
        club_data["logoUrl"] = validate_image_data_url(
            body["logoUrl"], "Club logo", 750_000, {"image/png"}
        )
    return insert(request.app.state.db, "clubs", club_data)


@router.patch("/clubs/{identity}")
def update_club(request: Request, identity: str, body: dict, profile=Depends(current_profile)):
    db = request.app.state.db
    club = collection(db, "clubs").find_one({"_id": as_oid(identity)})
    if not club:
        raise HTTPException(status_code=404, detail="Club not found.")
    if profile["role"] != Role.ADMIN.value and not can_manage_club(db, identity, profile):
        raise HTTPException(status_code=403, detail="Only this club’s leadership or Student Affairs can edit it.")
    allowed = (
        ["name", "description", "category", "clubType", "mentor", "recruitmentOpen", "logoUrl", "domains"]
        if profile["role"] == Role.ADMIN.value
        else ["name", "description", "category", "logoUrl"]
    )
    updates = {key: body[key] for key in allowed if key in body}
    if "domains" in updates:
        updates["domains"] = normalize_domains(updates["domains"])
    if "logoUrl" in updates:
        updates["logoUrl"] = validate_image_data_url(
            updates["logoUrl"], "Club logo", 750_000, {"image/png"}
        )
    if "mentor" in updates:
        if not updates["mentor"]:
            raise HTTPException(status_code=400, detail="Every club needs an assigned faculty mentor.")
        updates["mentor"] = as_oid(updates["mentor"], "mentor")
        if updates["mentor"] != club.get("mentor"):
            mentor = collection(db, "profiles").find_one({"_id": updates["mentor"], "role": Role.FACULTY.value}, {"_id": 1})
            if not mentor:
                raise HTTPException(status_code=400, detail="Choose a faculty mentor account created by ICTS.")
    updates["updatedAt"] = datetime.now(timezone.utc)
    collection(db, "clubs").update_one({"_id": club["_id"]}, {"$set": updates})
    return serialize_document(collection(db, "clubs").find_one({"_id": club["_id"]}))


@router.post("/clubs/{club_identity}/members", status_code=201)
def invite_office_bearer(request: Request, club_identity: str, body: dict, profile=Depends(current_profile)):
    require_fields(body, ["profileId", "position"])
    if body["position"] not in OFFICE_BEARER_POSITIONS:
        raise HTTPException(status_code=400, detail="Invalid club position.")
    db = request.app.state.db
    club_id = as_oid(club_identity, "clubId")
    club = collection(db, "clubs").find_one({"_id": club_id})
    if not club:
        raise HTTPException(status_code=404, detail="Club not found.")
    if profile["role"] != Role.ADMIN.value and str(club.get("mentor")) != profile["_id"]:
        raise HTTPException(status_code=403, detail="Only this club’s mentor or an admin can assign an office-bearer position.")
    nominee_id = as_oid(body["profileId"], "profileId")
    nominee = collection(db, "profiles").find_one({"_id": nominee_id}, {"role": 1})
    if not nominee:
        raise HTTPException(status_code=404, detail="Profile not found.")
    if nominee.get("role") not in STUDENT_ROLES:
        raise HTTPException(status_code=400, detail="Only a student can be assigned a club office-bearer position.")
    member_collection = collection(db, "members")
    membership = member_collection.find_one({
        "clubId": club_id, "profileId": nominee_id, "membershipStatus": "active"
    })
    if not membership:
        raise HTTPException(status_code=409, detail="Approve the student’s application before assigning an office-bearer position.")
    title = str(body.get("positionTitle") or "").strip()
    if len(title) > 80:
        raise HTTPException(status_code=400, detail="Custom position title must be 80 characters or fewer.")
    previous = {
        "priorPosition": membership.get("position", "member"),
        "priorPositionTitle": membership.get("positionTitle", ""),
        "priorOfficeBearerGroup": membership.get("officeBearerGroup", False),
        "hadPriorMembership": True,
        "position": body["position"],
        "positionTitle": title,
        "officeBearerGroup": True,
        "membershipStatus": "pending",
        "updatedAt": datetime.now(timezone.utc),
    }
    member_collection.update_one({"_id": membership["_id"]}, {"$set": previous})
    membership.update(previous)
    return serialize_document(membership)


@router.get("/members/mine")
def my_memberships(request: Request, profile=Depends(current_profile)):
    db = request.app.state.db
    memberships = list(collection(db, "members").find({"profileId": as_oid(profile["_id"])}).sort("joinedDate", -1))
    populate_many(db, memberships, [("clubId", "clubs", ["name", "category"])])
    return [serialize_document(item) for item in memberships]


@router.get("/members")
def list_members(request: Request, clubId: str, profile=Depends(current_profile)):
    db = request.app.state.db
    club_id = as_oid(clubId, "clubId")
    club = collection(db, "clubs").find_one({"_id": club_id}, {"mentor": 1})
    if not club:
        raise HTTPException(status_code=404, detail="Club not found.")
    if not can_review_memberships(db, clubId, profile) and str(club.get("mentor", "")) != profile["_id"]:
        raise HTTPException(
            status_code=403,
            detail="Only this club’s mentor, office bearers, or Student Affairs can view the member roster.",
        )
    members = list(collection(db, "members").find({"clubId": club_id}).sort("joinedDate", -1))
    populate_many(db, members, [("profileId", "profiles", ["name", "email"])])
    return [serialize_document(item) for item in members]


@router.patch("/members/{identity}")
def update_member(request: Request, identity: str, body: dict, profile=Depends(current_profile)):
    require_fields(body, ["position"])
    allowed = ["member", "executive", *OFFICE_BEARER_POSITIONS]
    if body["position"] not in allowed:
        raise HTTPException(status_code=400, detail="Invalid club position.")
    db = request.app.state.db
    members = collection(db, "members")
    member = members.find_one({"_id": as_oid(identity)})
    if not member:
        raise HTTPException(status_code=404, detail="Member not found.")
    if member.get("membershipStatus") != "active":
        raise HTTPException(status_code=409, detail="Pending invitations cannot be edited as active club roles.")
    club = collection(db, "clubs").find_one({"_id": member["clubId"]}, {"mentor": 1})
    can_assign = profile["role"] == Role.ADMIN.value or str((club or {}).get("mentor", "")) == profile["_id"]
    if not can_assign:
        raise HTTPException(status_code=403, detail="Only this club’s mentor or Student Affairs can change club positions.")
    changed = member.get("position") != body["position"]
    updates = {"position": body["position"]}
    if "positionTitle" in body:
        title = str(body.get("positionTitle") or "").strip()
        if len(title) > 80:
            raise HTTPException(status_code=400, detail="Custom position title must be 80 characters or fewer.")
        updates["positionTitle"] = title
    updates["officeBearerGroup"] = (
        body.get("officeBearerGroup", False if changed else member.get("officeBearerGroup", False))
        if body["position"] not in OFFICE_BEARER_POSITIONS
        else True
    )
    updates["updatedAt"] = datetime.now(timezone.utc)
    members.update_one({"_id": member["_id"]}, {"$set": updates})
    member.update(updates)
    return serialize_document(member)


@router.delete("/members/{identity}")
def delete_member(request: Request, identity: str, profile=Depends(current_profile)):
    db = request.app.state.db
    members = collection(db, "members")
    member = members.find_one({"_id": as_oid(identity)})
    if not member:
        raise HTTPException(status_code=404, detail="Club member not found.")
    club = collection(db, "clubs").find_one({"_id": member["clubId"]}, {"mentor": 1})
    if profile["role"] != Role.ADMIN.value and str((club or {}).get("mentor", "")) != profile["_id"]:
        raise HTTPException(status_code=403, detail="Only the assigned club mentor or Student Affairs can remove a member.")
    members.delete_one({"_id": member["_id"]})
    return {"message": "Club membership ended."}


@router.patch("/members/{identity}/respond")
def respond_to_invite(request: Request, identity: str, body: dict, profile=Depends(current_profile)):
    require_fields(body, ["response"])
    if body["response"] not in ("accepted", "declined"):
        raise HTTPException(status_code=400, detail="Response must be accepted or declined.")
    db = request.app.state.db
    members = collection(db, "members")
    member = members.find_one({"_id": as_oid(identity), "profileId": as_oid(profile["_id"])})
    if not member:
        raise HTTPException(status_code=404, detail="Office-bearer invitation not found.")
    if member.get("membershipStatus") != "pending":
        raise HTTPException(status_code=409, detail="This invitation has already been answered.")
    if body["response"] == "accepted":
        updates = {
            "membershipStatus": "active",
            "hadPriorMembership": False,
            "updatedAt": datetime.now(timezone.utc),
        }
        members.update_one({"_id": member["_id"]}, {"$set": updates, "$unset": {
            "priorPosition": "", "priorPositionTitle": "", "priorOfficeBearerGroup": ""
        }})
        message = "Office-bearer invitation accepted."
    elif member.get("hadPriorMembership"):
        updates = {
            "position": member.get("priorPosition") or "member",
            "positionTitle": member.get("priorPositionTitle") or "",
            "officeBearerGroup": member.get("priorOfficeBearerGroup") or False,
            "membershipStatus": "active",
            "hadPriorMembership": False,
            "updatedAt": datetime.now(timezone.utc),
        }
        members.update_one({"_id": member["_id"]}, {"$set": updates, "$unset": {
            "priorPosition": "", "priorPositionTitle": "", "priorOfficeBearerGroup": ""
        }})
        message = "Office-bearer invitation declined."
    else:
        members.delete_one({"_id": member["_id"]})
        message = "Office-bearer invitation declined."
    return {"message": message}


@router.get("/applications")
def list_applications(request: Request, clubId: str | None = None, profile=Depends(current_profile)):
    db = request.app.state.db
    query = {}
    if clubId:
        if not can_review_memberships(db, clubId, profile):
            raise HTTPException(
                status_code=403,
                detail="Only this club’s mentor, office bearers or an admin can review membership applications.",
            )
        query["clubId"] = as_oid(clubId, "clubId")
    elif profile["role"] == Role.ADMIN.value:
        query["status"] = {"$in": ["pending", "approved", "rejected"]}
    else:
        ids = visible_club_ids(db, profile, OFFICE_BEARER_POSITIONS)
        if profile["role"] == Role.FACULTY.value:
            ids.extend(item["_id"] for item in collection(db, "clubs").find({"mentor": as_oid(profile["_id"])}, {"_id": 1}))
        query["$or"] = [
            {"profileId": as_oid(profile["_id"])},
            *([{"clubId": {"$in": ids}}] if ids else []),
        ]
    applications = list(collection(db, "applications").find(query).sort("appliedDate", -1))
    populate_many(db, applications, [
        ("clubId", "clubs", ["name", "domains"]),
        ("profileId", "profiles", ["name", "email", "registerNumber", "department", "joiningYear", "phone"]),
    ])
    return [serialize_document(item) for item in applications]


@router.post("/applications", status_code=201)
def create_application(request: Request, body: dict, profile=Depends(current_profile)):
    if profile["role"] not in STUDENT_ROLES:
        raise HTTPException(status_code=403, detail="Only a student account can apply to join a club.")
    require_fields(body, ["clubId", "reason", "domain", "yearOfStudy", "applicantPhone"])
    year_of_study = str(body["yearOfStudy"])
    if year_of_study not in ("1st", "2nd", "3rd", "4th", "Other"):
        raise HTTPException(status_code=400, detail="Choose a valid year of study.")
    applicant_phone = str(body["applicantPhone"]).strip()
    if not applicant_phone or len(applicant_phone) > 20:
        raise HTTPException(status_code=400, detail="Enter a phone number of 1 to 20 characters.")
    if body.get("requestedPosition") and body["requestedPosition"] not in ("member", "executive"):
        raise HTTPException(status_code=400, detail="Membership applications can request member or executive consideration.")
    db = request.app.state.db
    club_id = as_oid(body["clubId"], "clubId")
    club = collection(db, "clubs").find_one({"_id": club_id})
    if not club:
        raise HTTPException(status_code=404, detail="Club not found.")
    if not club.get("recruitmentOpen"):
        raise HTTPException(status_code=409, detail="Applications for this club are currently closed.")
    domains = club.get("domains") or ["General"]
    if body["domain"] not in domains:
        raise HTTPException(status_code=400, detail="Choose one of this club’s application domains.")
    if collection(db, "members").find_one({"clubId": club_id, "profileId": as_oid(profile["_id"])}, {"_id": 1}):
        raise HTTPException(status_code=409, detail="You are already a member of this club.")
    if collection(db, "applications").find_one({
        "clubId": club_id, "profileId": as_oid(profile["_id"]), "status": "pending"
    }, {"_id": 1}):
        raise HTTPException(status_code=409, detail="You already have a pending application for this club.")
    return insert(db, "applications", {
        "clubId": club_id,
        "profileId": as_oid(profile["_id"]),
        "reason": body["reason"],
        "domain": body["domain"],
        "yearOfStudy": year_of_study,
        "applicantPhone": applicant_phone,
        "requestedPosition": body.get("requestedPosition") or "member",
        "status": "pending",
        "appliedDate": datetime.now(timezone.utc),
        "rejectionFeedback": "",
    })


@router.patch("/applications/{identity}")
def review_application(request: Request, identity: str, body: dict, profile=Depends(current_profile)):
    require_fields(body, ["status"])
    if body["status"] not in ("approved", "rejected"):
        raise HTTPException(status_code=400, detail="Status must be approved or rejected.")
    if body["status"] == "rejected" and not str(body.get("rejectionFeedback", "")).strip():
        raise HTTPException(status_code=400, detail="Provide a reason when rejecting a request.")
    db = request.app.state.db
    applications = collection(db, "applications")
    application = applications.find_one({"_id": as_oid(identity)})
    if not application:
        raise HTTPException(status_code=404, detail="Application not found.")
    club = collection(db, "clubs").find_one({"_id": application["clubId"]}, {"mentor": 1})
    is_mentor = profile["role"] == Role.FACULTY.value and str((club or {}).get("mentor", "")) == profile["_id"]
    if profile["role"] != Role.ADMIN.value and not is_mentor and not can_review_memberships(db, application["clubId"], profile):
        raise HTTPException(status_code=403, detail="Only this club’s assigned mentor, office bearers or an admin can review this application.")
    if application.get("status") != "pending":
        raise HTTPException(status_code=409, detail="This application has already been reviewed.")
    updates = {
        "status": body["status"],
        "reviewedBy": as_oid(profile["_id"]),
        "rejectionFeedback": str(body.get("rejectionFeedback") or "").strip(),
        "updatedAt": datetime.now(timezone.utc),
    }
    result = applications.update_one({"_id": application["_id"], "status": "pending"}, {"$set": updates})
    if not result.modified_count:
        raise HTTPException(status_code=409, detail="This application has already been reviewed.")
    application.update(updates)
    if body["status"] == "approved":
        try:
            collection(db, "members").update_one(
                {"clubId": application["clubId"], "profileId": application["profileId"]},
                {"$setOnInsert": {
                    "clubId": application["clubId"],
                    "profileId": application["profileId"],
                    "position": application.get("requestedPosition", "member"),
                    "positionTitle": "",
                    "membershipStatus": "active",
                    "officeBearerGroup": False,
                    "joinedDate": datetime.now(timezone.utc),
                    "createdAt": datetime.now(timezone.utc),
                    "updatedAt": datetime.now(timezone.utc),
                }},
                upsert=True,
            )
        except DuplicateKeyError as error:
            applications.update_one({"_id": application["_id"]}, {
                "$set": {"status": "pending", "updatedAt": datetime.now(timezone.utc)},
                "$unset": {"reviewedBy": ""},
            })
            raise HTTPException(status_code=409, detail="This application already has a club membership.") from error
    return serialize_document(application)
