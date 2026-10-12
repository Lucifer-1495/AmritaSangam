import logging
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pymongo.errors import DuplicateKeyError

from ..auth import current_profile, revoke_club_sessions
from ..database import serialize_document
from ..models import Role
from ..services.common import (
    OFFICE_BEARER_POSITIONS,
    STUDENT_ROLES,
    active_membership,
    as_oid,
    can_manage_club,
    can_review_memberships,
    club_mentor_query,
    collection,
    has_verified_club_access,
    is_club_mentor,
    insert,
    populate_many,
    populate_club_mentors,
    populate_review_history,
    require_club_manager,
    require_fields,
    review_history_entry,
    is_student_affairs,
    visible_club_ids,
)
from ..services.supabase import (
    create_supabase_user,
    decrypt_pending_password,
    delete_supabase_user,
    encrypt_pending_password,
    update_supabase_user,
)
from ..services.media import validate_image_data_url


router = APIRouter()
logger = logging.getLogger(__name__)


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


def normalize_motto(value):
    if value is None:
        return ""
    if not isinstance(value, str):
        raise HTTPException(status_code=400, detail="Club motto must be text.")
    motto = value.strip()
    if len(motto) > 180:
        raise HTTPException(status_code=400, detail="Club motto must be 180 characters or fewer.")
    return motto


def validate_mentor_ids(db, values):
    if not isinstance(values, list):
        raise HTTPException(status_code=400, detail="Choose one or more faculty mentors.")
    mentor_ids = []
    for value in values:
        identity = as_oid(value, "mentorIds")
        if identity in mentor_ids:
            continue
        if not collection(db, "profiles").find_one({"_id": identity, "role": Role.FACULTY.value}, {"_id": 1}):
            raise HTTPException(status_code=400, detail="Choose faculty accounts created by ICTS.")
        mentor_ids.append(identity)
    return mentor_ids


@router.get("/my/clubs")
def my_clubs(request: Request, profile=Depends(current_profile)):
    db = request.app.state.db
    if profile["role"] == Role.ADMIN.value:
        ids = None
    elif has_verified_club_access(db, profile.get("verifiedClubId"), profile):
        ids = [as_oid(profile["verifiedClubId"])]
    else:
        ids = visible_club_ids(db, profile)
    query = {"organizationType": {"$ne": "event_organizer"}} if ids is None else {"_id": {"$in": ids}}
    clubs = list(collection(db, "clubs").find(query).sort("name", 1))
    populate_club_mentors(db, clubs)
    if profile["role"] == Role.ADMIN.value and clubs:
        credentials = collection(db, "club_credentials").find(
            {"clubId": {"$in": [club["_id"] for club in clubs]}},
            {"clubId": 1, "email": 1},
        )
        emails = {str(item["clubId"]): item.get("email", "") for item in credentials}
        for club in clubs:
            club["clubLoginEmail"] = emails.get(str(club["_id"]), "")
    return [serialize_document(club) for club in clubs]


@router.get("/event-organizers")
def list_event_organizers(request: Request, profile=Depends(current_profile)):
    if profile["role"] != Role.ADMIN.value or profile.get("adminType") != "student_affairs":
        raise HTTPException(status_code=403, detail="Only Student Affairs can manage campus event organizers.")
    records = collection(request.app.state.db, "clubs").find({
        "organizationType": "event_organizer",
    }).sort("name", 1)
    return [serialize_document(record) for record in records]


@router.post("/clubs", status_code=201)
def create_club(request: Request, body: dict, profile=Depends(current_profile)):
    if profile["role"] != Role.ADMIN.value:
        raise HTTPException(status_code=403, detail="You do not have permission to perform this action.")
    require_fields(body, ["name", "description", "clubType"])
    if body["clubType"] not in ("technical", "non_technical"):
        raise HTTPException(status_code=400, detail="Choose a technical or non-technical club type.")
    mentor_ids = validate_mentor_ids(
        request.app.state.db,
        body.get("mentorIds", [body["mentor"]] if body.get("mentor") else []),
    )
    club_email = str(body.get("clubLoginEmail") or "").strip().lower()
    club_password = body.get("clubLoginPassword")
    if bool(club_email) != bool(club_password):
        raise HTTPException(status_code=400, detail="Enter both the club login email and password.")
    if club_email or club_password:
        if profile["role"] != Role.ADMIN.value:
            raise HTTPException(status_code=403, detail="Only an admin can set club login credentials.")
        if club_email:
            if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", club_email) or len(club_email) > 254:
                raise HTTPException(status_code=400, detail="Enter a valid club login email.")
            if collection(request.app.state.db, "club_credentials").find_one({"email": club_email}, {"_id": 1}):
                raise HTTPException(status_code=409, detail="That club login email is already in use.")
        if club_password:
            if not isinstance(club_password, str) or not 8 <= len(club_password) <= 256:
                raise HTTPException(status_code=400, detail="Club login passwords must be 8 to 256 characters.")
    club_data = {
        "name": body["name"],
        "description": body["description"],
        "motto": normalize_motto(body.get("motto")),
        "category": body.get("category") or "Community",
        "clubType": body["clubType"],
        "domains": normalize_domains(body.get("domains")),
        "mentor": mentor_ids[0] if mentor_ids else None,
        "mentorIds": mentor_ids,
        "recruitmentOpen": bool(body.get("recruitmentOpen")),
        "foundedDate": datetime.now(timezone.utc),
    }
    if "logoUrl" in body:
        club_data["logoUrl"] = validate_image_data_url(
            body["logoUrl"], "Club logo", 750_000, {"image/png"}
        )
    club = insert(request.app.state.db, "clubs", club_data)
    if club_email:
        user = None
        try:
            user = create_supabase_user(club_email, club_password, f"{club_data['name']} account")
            now = datetime.now(timezone.utc)
            collection(request.app.state.db, "club_credentials").insert_one({
                "clubId": as_oid(club["_id"]),
                "supabaseId": user["id"],
                "email": club_email,
                "createdAt": now,
                "updatedAt": now,
            })
        except Exception as error:
            try:
                if user:
                    delete_supabase_user(user["id"])
                collection(request.app.state.db, "clubs").delete_one({"_id": as_oid(club["_id"])})
            except Exception as rollback_error:
                logger.exception("Failed to roll back a club after Supabase credential provisioning failed.")
                raise HTTPException(
                    status_code=500,
                    detail="The club login could not be saved consistently. Contact the system owner.",
                ) from rollback_error
            raise error
    return club


@router.post("/club-credential-change-requests", status_code=201)
def request_club_credential_change(request: Request, body: dict, profile=Depends(current_profile)):
    if profile["role"] != Role.ICTS.value:
        raise HTTPException(status_code=403, detail="Only ICTS can request club credential changes.")
    require_fields(body, ["clubId"])
    db = request.app.state.db
    club_id = as_oid(body["clubId"], "clubId")
    if not collection(db, "clubs").find_one({"_id": club_id}, {"_id": 1}):
        raise HTTPException(status_code=404, detail="Club not found.")
    email = str(body.get("clubLoginEmail") or "").strip().lower()
    password = body.get("clubLoginPassword") or None
    if not email and not password:
        raise HTTPException(status_code=400, detail="Provide a new club email, password, or both.")
    if email and (not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email) or len(email) > 254):
        raise HTTPException(status_code=400, detail="Enter a valid club login email.")
    if email and collection(db, "club_credentials").find_one({
        "email": email,
        "clubId": {"$ne": club_id},
    }, {"_id": 1}):
        raise HTTPException(status_code=409, detail="That club login email is already in use.")
    if password is not None and (not isinstance(password, str) or not 8 <= len(password) <= 256):
        raise HTTPException(status_code=400, detail="Club login passwords must be 8 to 256 characters.")
    requests = collection(db, "credential_requests")
    current_credentials = collection(db, "club_credentials").find_one({"clubId": club_id}, {"_id": 1})
    if not current_credentials and (not email or not password):
        raise HTTPException(status_code=400, detail="Set both the club email and password when configuring its first login.")
    if requests.find_one({"clubId": club_id, "status": {"$in": ["pending", "approved"]}}, {"_id": 1}):
        raise HTTPException(status_code=409, detail="This club already has a credential change awaiting approval or application.")
    values = {
        "clubId": club_id,
        "clubLoginEmail": email or None,
        "passwordCiphertext": encrypt_pending_password(password) if password else None,
        "passwordChangeRequested": bool(password),
        "requestedBy": as_oid(profile["_id"]),
        "status": "pending",
    }
    record = insert(db, "credential_requests", values)
    record.pop("passwordHash", None)
    record.pop("passwordCiphertext", None)
    return record


@router.get("/club-credential-change-requests")
def list_club_credential_change_requests(request: Request, profile=Depends(current_profile)):
    if profile["role"] not in (Role.ICTS.value, Role.ADMIN.value):
        raise HTTPException(status_code=403, detail="Only ICTS and Student Affairs can view credential change requests.")
    if profile["role"] == Role.ADMIN.value and not is_student_affairs(profile):
        raise HTTPException(status_code=403, detail="Only Student Affairs can review credential change requests.")
    records = list(collection(request.app.state.db, "credential_requests").find(
        {"status": {"$in": ["pending", "approved", "rejected", "applied"]}}
    ).sort("createdAt", -1).limit(100))
    populate_many(request.app.state.db, records, [
        ("clubId", "clubs", ["name"]),
        ("requestedBy", "profiles", ["name", "email"]),
    ])
    for record in records:
        password_ciphertext = record.pop("passwordCiphertext", None)
        legacy_password_hash = record.pop("passwordHash", None)
        record["passwordChangeRequested"] = bool(
            password_ciphertext or legacy_password_hash or record.get("passwordChangeRequested")
        )
    return [serialize_document(record) for record in records]


@router.patch("/club-credential-change-requests/{identity}/approval")
def review_club_credential_change(request: Request, identity: str, body: dict, profile=Depends(current_profile)):
    if not is_student_affairs(profile):
        raise HTTPException(status_code=403, detail="Only Student Affairs can approve club credential changes.")
    require_fields(body, ["status"])
    if body["status"] not in ("approved", "rejected"):
        raise HTTPException(status_code=400, detail="Status must be approved or rejected.")
    feedback = str(body.get("rejectionFeedback") or "").strip()
    if body["status"] == "rejected" and not feedback:
        raise HTTPException(status_code=400, detail="Provide a reason when rejecting this request.")
    request_update = {"$set": {
        "status": body["status"],
        "reviewedBy": as_oid(profile["_id"]),
        "rejectionFeedback": feedback if body["status"] == "rejected" else "",
        "reviewedAt": datetime.now(timezone.utc),
    }}
    if body["status"] == "rejected":
        request_update["$unset"] = {"passwordCiphertext": "", "passwordHash": ""}
    result = collection(request.app.state.db, "credential_requests").update_one(
        {"_id": as_oid(identity), "status": "pending"},
        request_update,
    )
    if not result.modified_count:
        raise HTTPException(status_code=409, detail="This credential request is no longer awaiting review.")
    return {"message": f"Credential change request {body['status']}."}


@router.patch("/club-credential-change-requests/{identity}/apply")
def apply_club_credential_change(request: Request, identity: str, profile=Depends(current_profile)):
    if profile["role"] != Role.ICTS.value:
        raise HTTPException(status_code=403, detail="Only ICTS can apply approved club credential changes.")
    db = request.app.state.db
    requests = collection(db, "credential_requests")
    change = requests.find_one({"_id": as_oid(identity), "status": "approved"})
    if not change:
        raise HTTPException(status_code=409, detail="Only an approved credential change can be applied.")
    credential_collection = collection(db, "club_credentials")
    current_credentials = credential_collection.find_one({"clubId": change["clubId"]})
    password = None
    if change.get("passwordCiphertext"):
        password = decrypt_pending_password(change["passwordCiphertext"])
    elif change.get("passwordHash"):
        raise HTTPException(
            status_code=409,
            detail="This pending password uses an older format. Submit a new credential change request.",
        )
    email = change.get("clubLoginEmail") or (current_credentials or {}).get("email")
    supabase_id = (current_credentials or {}).get("supabaseId")
    if not supabase_id:
        if not email or not password:
            raise HTTPException(
                status_code=400,
                detail="Set both a club login email and password to configure its first Supabase login.",
            )
        user = create_supabase_user(email, password, "Club account")
        supabase_id = user["id"]
    else:
        auth_updates = {}
        if change.get("clubLoginEmail"):
            auth_updates["email"] = change["clubLoginEmail"]
        if password:
            auth_updates["password"] = password
        if auth_updates:
            update_supabase_user(supabase_id, auth_updates)
    updates = {"updatedAt": datetime.now(timezone.utc), "supabaseId": supabase_id}
    if change.get("clubLoginEmail"):
        updates["email"] = change["clubLoginEmail"]
    credential_collection.update_one(
        {"clubId": change["clubId"]},
        {
            "$set": updates,
            "$setOnInsert": {"clubId": change["clubId"], "createdAt": updates["updatedAt"]},
            "$unset": {"passwordHash": ""},
        },
        upsert=True,
    )
    result = requests.update_one(
        {"_id": change["_id"], "status": "approved"},
        {
            "$set": {
                "status": "applied",
                "appliedBy": as_oid(profile["_id"]),
                "appliedAt": updates["updatedAt"],
            },
            "$unset": {"passwordCiphertext": "", "passwordHash": ""},
        },
    )
    if not result.modified_count:
        raise HTTPException(status_code=409, detail="This approved change has already been applied.")
    revoke_club_sessions(db, change["clubId"])
    return {"message": "Approved club credentials applied."}


@router.patch("/clubs/{identity}")
def update_club(request: Request, identity: str, body: dict, profile=Depends(current_profile)):
    db = request.app.state.db
    club = collection(db, "clubs").find_one({"_id": as_oid(identity)})
    if not club:
        raise HTTPException(status_code=404, detail="Club not found.")
    if profile["role"] != Role.ADMIN.value and not can_manage_club(db, identity, profile):
        raise HTTPException(status_code=403, detail="Only this club’s leadership or Student Affairs can edit it.")
    allowed = (
        ["name", "description", "motto", "category", "clubType", "mentor", "mentorIds", "recruitmentOpen", "logoUrl", "domains"]
        if profile["role"] == Role.ADMIN.value
        else ["name", "description", "motto", "category", "logoUrl"]
    )
    updates = {key: body[key] for key in allowed if key in body}
    if "motto" in updates:
        updates["motto"] = normalize_motto(updates["motto"])
    club_email = str(body.get("clubLoginEmail") or "").strip().lower()
    club_password = body.get("clubLoginPassword") or None
    if "mentorIds" in body or "mentor" in body:
        requested_mentors = body.get("mentorIds", [body["mentor"]] if body.get("mentor") else [])
        updates["mentorIds"] = validate_mentor_ids(db, requested_mentors)
        updates["mentor"] = updates["mentorIds"][0] if updates["mentorIds"] else None
    if "domains" in updates:
        updates["domains"] = normalize_domains(updates["domains"])
    if "logoUrl" in updates:
        updates["logoUrl"] = validate_image_data_url(
            updates["logoUrl"], "Club logo", 750_000, {"image/png"}
        )
    if profile["role"] == Role.ADMIN.value and (
        "clubLoginEmail" in body or "clubLoginPassword" in body
    ):
        credentials = collection(db, "club_credentials")
        current_credentials = credentials.find_one({"clubId": club["_id"]})
        auth_updates = {}
        if club_email:
            if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", club_email) or len(club_email) > 254:
                raise HTTPException(status_code=400, detail="Enter a valid club login email.")
            existing_email = credentials.find_one({
                "email": club_email,
                "clubId": {"$ne": club["_id"]},
            }, {"_id": 1})
            if existing_email:
                raise HTTPException(status_code=409, detail="That club login email is already in use.")
            auth_updates["email"] = club_email
        if club_password is not None:
            if not isinstance(club_password, str) or not 8 <= len(club_password) <= 256:
                raise HTTPException(status_code=400, detail="Club login passwords must be 8 to 256 characters.")
            if not club_email and not (current_credentials and current_credentials.get("email")):
                raise HTTPException(status_code=400, detail="Enter a club login email before setting its password.")
            auth_updates["password"] = club_password
        if auth_updates:
            now = datetime.now(timezone.utc)
            if current_credentials and current_credentials.get("supabaseId"):
                update_supabase_user(current_credentials["supabaseId"], auth_updates)
                credential_updates = {
                    "email": club_email or current_credentials["email"],
                    "updatedAt": now,
                }
                credentials.update_one(
                    {"clubId": club["_id"]},
                    {"$set": credential_updates, "$unset": {"passwordHash": ""}},
                )
                revoke_club_sessions(db, club["_id"])
            else:
                email = club_email or (current_credentials or {}).get("email")
                password = auth_updates.get("password")
                if not email or not password:
                    raise HTTPException(
                        status_code=400,
                        detail="Set both a club login email and password to configure its first Supabase login.",
                    )
                user = create_supabase_user(email, password, f"{club.get('name', 'Club')} account")
                credentials.update_one(
                    {"clubId": club["_id"]},
                    {
                        "$set": {
                            "supabaseId": user["id"],
                            "email": email,
                            "updatedAt": now,
                        },
                        "$setOnInsert": {"clubId": club["_id"], "createdAt": now},
                        "$unset": {"passwordHash": ""},
                    },
                    upsert=True,
                )
                revoke_club_sessions(db, club["_id"])
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
    if profile["role"] != Role.ADMIN.value and not is_club_mentor(club, profile["_id"]):
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
    previous = {
        "priorPosition": membership.get("position", "member"),
        "priorOfficeBearerGroup": membership.get("officeBearerGroup", False),
        "hadPriorMembership": True,
        "position": body["position"],
        "officeBearerGroup": True,
        "membershipStatus": "pending",
        "updatedAt": datetime.now(timezone.utc),
    }
    member_collection.update_one({"_id": membership["_id"]}, {
        "$set": previous,
        "$unset": {"positionTitle": "", "priorPositionTitle": ""},
    })
    membership.pop("positionTitle", None)
    membership.pop("priorPositionTitle", None)
    membership.update(previous)
    return serialize_document(membership)


@router.get("/members/mine")
def my_memberships(request: Request, profile=Depends(current_profile)):
    db = request.app.state.db
    query = {
        "profileId": as_oid(profile["_id"]),
        "membershipStatus": {"$in": ["active", "pending"]},
    }
    if has_verified_club_access(db, profile.get("verifiedClubId"), profile):
        query["clubId"] = as_oid(profile["verifiedClubId"])
    memberships = list(collection(db, "members").find(query).sort("joinedDate", -1))
    populate_many(db, memberships, [("clubId", "clubs", ["name", "category"])])
    return [serialize_document(item) for item in memberships]


@router.get("/members")
def list_members(request: Request, clubId: str, includeEnded: bool = False, profile=Depends(current_profile)):
    db = request.app.state.db
    club_id = as_oid(clubId, "clubId")
    club = collection(db, "clubs").find_one({"_id": club_id}, {"mentor": 1, "mentorIds": 1})
    if not club:
        raise HTTPException(status_code=404, detail="Club not found.")
    if (
        not can_review_memberships(db, clubId, profile)
        and not is_club_mentor(club, profile["_id"])
        and not has_verified_club_access(db, club_id, profile)
    ):
        raise HTTPException(
            status_code=403,
            detail="Only this club’s assigned mentor or Student Affairs can view the member roster.",
        )
    member_query = {"clubId": club_id}
    if not includeEnded:
        member_query["membershipStatus"] = {"$in": ["active", "pending"]}
    members = list(collection(db, "members").find(member_query).sort("joinedDate", -1))
    populate_many(db, members, [("profileId", "profiles", ["name", "email"])])
    populate_many(db, members, [("endedBy", "profiles", ["name"])])
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
    club = collection(db, "clubs").find_one({"_id": member["clubId"]}, {"mentor": 1, "mentorIds": 1})
    can_assign = profile["role"] == Role.ADMIN.value or is_club_mentor(club, profile["_id"])
    if not can_assign:
        raise HTTPException(status_code=403, detail="Only this club’s mentor or Student Affairs can change club positions.")
    changed = member.get("position") != body["position"]
    updates = {"position": body["position"]}
    updates["officeBearerGroup"] = (
        body.get("officeBearerGroup", False if changed else member.get("officeBearerGroup", False))
        if body["position"] not in OFFICE_BEARER_POSITIONS
        else True
    )
    updates["updatedAt"] = datetime.now(timezone.utc)
    members.update_one({"_id": member["_id"]}, {"$set": updates, "$unset": {"positionTitle": ""}})
    member.pop("positionTitle", None)
    member.update(updates)
    return serialize_document(member)


@router.delete("/members/{identity}")
def delete_member(request: Request, identity: str, profile=Depends(current_profile)):
    db = request.app.state.db
    members = collection(db, "members")
    member = members.find_one({"_id": as_oid(identity)})
    if not member:
        raise HTTPException(status_code=404, detail="Club member not found.")
    if member.get("membershipStatus") == "ended":
        raise HTTPException(status_code=409, detail="This club membership has already ended.")
    club = collection(db, "clubs").find_one({"_id": member["clubId"]}, {"mentor": 1, "mentorIds": 1})
    is_assigned_mentor = is_club_mentor(club, profile["_id"])
    if profile["role"] != Role.ADMIN.value and not is_assigned_mentor:
        raise HTTPException(status_code=403, detail="Only this club’s assigned mentor or Student Affairs can remove a member.")
    ended_at = datetime.now(timezone.utc)
    ended_by = as_oid(profile["_id"])
    members.update_one({"_id": member["_id"]}, {"$set": {
        "membershipStatus": "ended",
        "endedAt": ended_at,
        "endedBy": ended_by,
        "updatedAt": ended_at,
    }, "$push": {"membershipHistory": {
        "action": "ended",
        "actorId": ended_by,
        "actedAt": ended_at,
    }}})
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
        club_identity = as_oid(clubId, "clubId")
        if not can_review_memberships(db, club_identity, profile) and not has_verified_club_access(
            db, club_identity, profile
        ):
            raise HTTPException(
                status_code=403,
                detail="Only this club’s assigned mentor, Student Affairs, or its verified club account can view applications.",
            )
        query["clubId"] = club_identity
    elif has_verified_club_access(db, profile.get("verifiedClubId"), profile):
        query["clubId"] = as_oid(profile["verifiedClubId"])
    elif profile["role"] == Role.ADMIN.value:
        query["status"] = {"$in": ["pending", "approved", "rejected"]}
    else:
        ids = []
        if profile["role"] == Role.FACULTY.value:
            ids.extend(item["_id"] for item in collection(db, "clubs").find(club_mentor_query(profile["_id"]), {"_id": 1}))
        query["$or"] = [
            {"profileId": as_oid(profile["_id"])},
            *([{"clubId": {"$in": ids}}] if ids else []),
        ]
    applications = list(collection(db, "applications").find(query).sort("appliedDate", -1))
    populate_many(db, applications, [
        ("clubId", "clubs", ["name", "domains"]),
        ("profileId", "profiles", ["name", "email", "registerNumber", "department", "joiningYear", "phone"]),
        ("reviewedBy", "profiles", ["name"]),
    ])
    populate_review_history(db, applications)
    return [serialize_document(item) for item in applications]


@router.post("/applications", status_code=201)
def create_application(request: Request, body: dict, profile=Depends(current_profile)):
    if profile.get("isClubAccount") or profile["role"] not in STUDENT_ROLES:
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
    if collection(db, "members").find_one({
        "clubId": club_id,
        "profileId": as_oid(profile["_id"]),
        "membershipStatus": {"$in": ["active", "pending"]},
    }, {"_id": 1}):
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
    club = collection(db, "clubs").find_one({"_id": application["clubId"]}, {"mentor": 1, "mentorIds": 1})
    is_mentor = profile["role"] == Role.FACULTY.value and is_club_mentor(club, profile["_id"])
    verified_club_access = has_verified_club_access(db, application["clubId"], profile)
    if profile["role"] != Role.ADMIN.value and not is_mentor and not verified_club_access:
        raise HTTPException(
            status_code=403,
            detail="Only this club’s assigned mentor, Student Affairs, or its verified club account can review this application.",
        )
    if application.get("status") != "pending":
        raise HTTPException(status_code=409, detail="This application has already been reviewed.")
    updates = {
        "status": body["status"],
        "reviewedBy": as_oid(profile["_id"]),
        "rejectionFeedback": str(body.get("rejectionFeedback") or "").strip(),
        "updatedAt": datetime.now(timezone.utc),
    }
    history_entry = review_history_entry(
        profile,
        body["status"],
        "club",
        updates["rejectionFeedback"],
        updates["updatedAt"],
    )
    result = applications.update_one({"_id": application["_id"], "status": "pending"}, {
        "$set": updates,
        "$push": {"reviewHistory": history_entry},
    })
    if not result.modified_count:
        raise HTTPException(status_code=409, detail="This application has already been reviewed.")
    application.update(updates)
    application.setdefault("reviewHistory", []).append(history_entry)
    if body["status"] == "approved":
        try:
            members = collection(db, "members")
            prior_membership = members.find_one({
                "clubId": application["clubId"],
                "profileId": application["profileId"],
            })
            if prior_membership and prior_membership.get("membershipStatus") == "ended":
                reactivated_at = datetime.now(timezone.utc)
                members.update_one({"_id": prior_membership["_id"]}, {
                    "$set": {
                        "position": application.get("requestedPosition", "member"),
                        "membershipStatus": "active",
                        "officeBearerGroup": False,
                        "joinedDate": reactivated_at,
                        "updatedAt": reactivated_at,
                    },
                    "$unset": {"endedAt": "", "endedBy": "", "positionTitle": ""},
                    "$push": {"membershipHistory": {
                        "action": "reactivated",
                        "actorId": as_oid(profile["_id"]),
                        "actedAt": reactivated_at,
                        "applicationId": application["_id"],
                    }},
                })
            elif prior_membership:
                raise DuplicateKeyError("Membership already exists.")
            else:
                members.update_one(
                    {"clubId": application["clubId"], "profileId": application["profileId"]},
                    {"$setOnInsert": {
                    "clubId": application["clubId"],
                    "profileId": application["profileId"],
                    "position": application.get("requestedPosition", "member"),
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
                "$pull": {"reviewHistory": history_entry},
            })
            raise HTTPException(status_code=409, detail="This application already has a club membership.") from error
    return serialize_document(application)
