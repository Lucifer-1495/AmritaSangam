import logging
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request

from ..auth import current_profile, require_roles
from ..config import settings
from ..database import serialize_document
from ..models import Role
from ..services.common import (
    as_oid,
    collection,
    id_sequence,
    insert,
    remove_csv_rows_for_email,
    require_fields,
)
from ..services.supabase import create_supabase_user, delete_supabase_user


logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/profiles/me")
def get_my_profile(profile=Depends(current_profile)):
    return profile


@router.patch("/profiles/me")
def update_my_profile(request: Request, body: dict, profile=Depends(current_profile)):
    updates = {}
    for field, maximum in (("phone", 20), ("bio", 500)):
        if field not in body:
            continue
        value = str(body[field]).strip()
        if len(value) > maximum:
            raise HTTPException(status_code=400, detail=f"{field} must be {maximum} characters or fewer.")
        if field == "phone" and value and not re.fullmatch(r"[+\d][\d\s()-]{6,19}", value):
            raise HTTPException(status_code=400, detail="Enter a valid phone number (digits, spaces, +, - or brackets).")
        updates[field] = value
    if "avatarUrl" in body:
        avatar = str(body["avatarUrl"])
        if avatar and not re.fullmatch(r"data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+", avatar):
            raise HTTPException(status_code=400, detail="Profile picture must be a PNG, JPEG or WebP image.")
        if len(avatar) > 400_000:
            raise HTTPException(status_code=400, detail="Profile picture is too large. Choose a smaller image.")
        updates["avatarUrl"] = avatar
    updates["updatedAt"] = datetime.now(timezone.utc)
    collection(request.app.state.db, "profiles").update_one({"_id": as_oid(profile["_id"])}, {"$set": updates})
    return serialize_document(collection(request.app.state.db, "profiles").find_one({"_id": as_oid(profile["_id"])}))


@router.get("/profiles")
def list_profiles(request: Request, profile=Depends(require_roles(Role.ADMIN.value, Role.ICTS.value))):
    records = list(collection(request.app.state.db, "profiles").find({}, {"avatarUrl": 0}).sort("name", 1))
    return [serialize_document(record) for record in records]


@router.get("/profiles/students")
def list_mentored_students(request: Request, profile=Depends(require_roles(Role.FACULTY.value, Role.ADMIN.value))):
    db = request.app.state.db
    assigned_ids = [item["_id"] for item in collection(db, "clubs").find({"mentor": as_oid(profile["_id"])}, {"_id": 1})]
    member_ids = [item["profileId"] for item in collection(db, "members").find({
        "clubId": {"$in": assigned_ids},
        "membershipStatus": "active",
    }, {"profileId": 1})] if assigned_ids else []
    students = list(collection(db, "profiles").find({
        "_id": {"$in": member_ids},
        "role": {"$in": [Role.STUDENT.value, Role.COMMITTEE.value]},
    }, {"name": 1, "email": 1, "role": 1}).sort("name", 1))
    return [serialize_document(student) for student in students]


@router.post("/profiles", status_code=201)
def create_profile(request: Request, body: dict, profile=Depends(require_roles(Role.ICTS.value))):
    require_fields(body, ["name", "email", "password", "role"])
    name = str(body["name"]).strip()
    email = str(body["email"]).strip().lower()
    password = str(body["password"])
    role = body["role"]
    admin_type = body.get("adminType") or "student_affairs"
    designation = str(body.get("designation") or "").strip()
    if not name or len(name) > 100:
        raise HTTPException(status_code=400, detail="Name must be between 1 and 100 characters.")
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        raise HTTPException(status_code=400, detail="Enter a valid email address.")
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters.")
    if role not in (Role.ADMIN.value, Role.FACULTY.value, Role.STUDENT.value):
        raise HTTPException(status_code=400, detail="ICTS can create admin, faculty and student accounts.")
    if role == Role.ADMIN.value and admin_type not in ("student_affairs", "principal", "other_authority"):
        raise HTTPException(status_code=400, detail="Choose Student Affairs, Principal or Other authority for the admin type.")
    if role == Role.ADMIN.value and admin_type == "other_authority" and not designation:
        raise HTTPException(status_code=400, detail="Enter the other authority designation.")
    if len(designation) > 100:
        raise HTTPException(status_code=400, detail="Designation must be 100 characters or fewer.")
    if email == settings.icts_email:
        raise HTTPException(status_code=409, detail="That email belongs to the ICTS account.")

    db = request.app.state.db
    profiles = collection(db, "profiles")
    if profiles.find_one({"email": email}, {"_id": 1}):
        raise HTTPException(status_code=409, detail="An account with this email already exists.")
    profile_data = {"name": name, "email": email, "role": role}
    if role == Role.ADMIN.value:
        profile_data.update({"adminType": admin_type, "designation": designation})
    else:
        department = str(body.get("department") or "").strip().upper()
        try:
            joining_year = int(body.get("joiningYear"))
        except (ValueError, TypeError):
            joining_year = 0
        if not re.fullmatch(r"[A-Z]{2,6}", department):
            raise HTTPException(status_code=400, detail="Department must be 2-6 letters, e.g. CSE.")
        if joining_year < 2000 or joining_year > datetime.now().year + 1:
            raise HTTPException(status_code=400, detail="Enter a valid 4-digit joining year.")
        yy = str(joining_year)[-2:]
        profile_data.update({"department": department, "joiningYear": joining_year})
        if role == Role.FACULTY.value:
            prefix = f"FA{yy}{department}"
            profile_data["facultyId"] = f"{prefix}{id_sequence(db, prefix)}"
        else:
            prefix = f"{department}{yy}"
            profile_data["registerNumber"] = f"{prefix}{id_sequence(db, prefix)}"

    created_user = create_supabase_user(email, password, name)
    profile_data["supabaseId"] = created_user["id"]
    try:
        return insert(db, "profiles", profile_data)
    except Exception as error:
        try:
            delete_supabase_user(created_user["id"])
        except Exception as rollback_error:
            logger.exception("Failed to roll back a Supabase user after profile creation failed.")
            raise HTTPException(
                status_code=500,
                detail="The account was created in Supabase but could not be saved in my AMRITA. Contact the system owner.",
            ) from rollback_error
        raise error


@router.delete("/profiles/{identity}")
def delete_profile(request: Request, identity: str, profile=Depends(require_roles(Role.ICTS.value))):
    db = request.app.state.db
    profiles = collection(db, "profiles")
    target = profiles.find_one({"_id": as_oid(identity)})
    if not target:
        raise HTTPException(status_code=404, detail="Account not found.")
    if target.get("role") == Role.ICTS.value or target.get("supabaseId") == profile.get("supabaseId"):
        raise HTTPException(status_code=409, detail="The ICTS account cannot delete itself.")

    delete_supabase_user(target.get("supabaseId", ""))
    profile_id = target["_id"]
    email = target["email"]
    reports = collection(db, "event_reports")
    for report in reports.find({"attendeeIds": profile_id}, {"rosterCsv": 1, "attendeeCount": 1}):
        csv_data, removed = remove_csv_rows_for_email(report.get("rosterCsv", ""), email)
        reports.update_one({"_id": report["_id"]}, {
            "$set": {"rosterCsv": csv_data},
            "$inc": {"attendeeCount": -removed},
            "$pull": {"attendeeIds": profile_id},
        })
    try:
        collection(db, "clubs").update_many({"mentor": profile_id}, {"$unset": {"mentor": ""}})
        collection(db, "events").update_many(
            {"$or": [{"createdBy": profile_id}, {"mentorReviewedBy": profile_id}, {"studentAffairsReviewedBy": profile_id}]},
            {"$unset": {"createdBy": "", "mentorReviewedBy": "", "studentAffairsReviewedBy": ""}},
        )
        collection(db, "applications").delete_many({"profileId": profile_id})
        collection(db, "applications").update_many({"reviewedBy": profile_id}, {"$unset": {"reviewedBy": ""}})
        collection(db, "members").delete_many({"profileId": profile_id})
        collection(db, "registrations").delete_many({"profileId": profile_id})
        collection(db, "attendance").delete_many({"profileId": profile_id})
        collection(db, "borrows").delete_many({"profileId": profile_id})
        collection(db, "borrows").update_many(
            {"$or": [{"mentorReviewedBy": profile_id}, {"studentAffairsReviewedBy": profile_id}]},
            {"$unset": {"mentorReviewedBy": "", "studentAffairsReviewedBy": ""}},
        )
        collection(db, "messages").delete_many({"senderId": profile_id})
        reports.delete_many({"submittedBy": profile_id})
        reports.update_many({"mentorReviewedBy": profile_id}, {"$unset": {"mentorReviewedBy": ""}})
        reports.update_many({"studentAffairsReviewedBy": profile_id}, {"$unset": {"studentAffairsReviewedBy": ""}})
        collection(db, "funding").update_many({"reviewedBy": profile_id}, {"$unset": {"reviewedBy": ""}})
        collection(db, "auth_sessions").delete_many({"profileId": profile_id})
        profiles.delete_one({"_id": profile_id})
    except Exception as error:
        logger.exception("Supabase login deleted, but MongoDB account cleanup failed.")
        raise HTTPException(
            status_code=500,
            detail="The login was deleted in Supabase, but some data in my AMRITA could not be cleaned up. Retry the deletion to finish cleanup.",
        ) from error
    return {"message": "Account and account-linked records were deleted."}
