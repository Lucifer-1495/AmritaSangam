import logging
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request

from ..auth import current_profile, require_roles
from ..campus_directory import sync_mentor_accounts
from ..config import settings
from ..database import serialize_document
from ..models import Role
from ..services.common import (
    as_oid,
    club_mentor_query,
    collection,
    FACULTY_DEPARTMENTS,
    id_sequence,
    insert,
    profile_identity_fields,
    remove_csv_rows_for_email,
    remove_csv_rows_for_value,
    require_fields,
    STUDENT_DEPARTMENTS,
    student_register_number,
)
from ..services.supabase import create_supabase_user, delete_supabase_user, update_supabase_user


logger = logging.getLogger(__name__)
router = APIRouter()
ADMIN_DESIGNATIONS = {"Dean", "Associate Dean", "Head of Department", "Director", "Other"}


@router.get("/profiles/me")
def get_my_profile(profile=Depends(current_profile)):
    return profile


@router.patch("/profiles/me")
def update_my_profile(request: Request, body: dict, profile=Depends(current_profile)):
    if profile.get("isClubAccount"):
        raise HTTPException(status_code=403, detail="Shared club account profiles cannot be edited.")
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
    updated_profile = collection(request.app.state.db, "profiles").find_one({"_id": as_oid(profile["_id"])})
    updated_profile.update(profile_identity_fields(updated_profile))
    updated_profile["verifiedClubId"] = profile.get("verifiedClubId")
    return serialize_document(updated_profile)


@router.get("/profiles")
def list_profiles(request: Request, profile=Depends(require_roles(Role.ADMIN.value, Role.ICTS.value))):
    records = list(collection(request.app.state.db, "profiles").find({}, {"avatarUrl": 0}).sort("name", 1))
    for record in records:
        record.update(profile_identity_fields(record))
    return [serialize_document(record) for record in records]


@router.get("/profiles/students")
def list_mentored_students(request: Request, profile=Depends(require_roles(Role.FACULTY.value, Role.ADMIN.value))):
    db = request.app.state.db
    assigned_ids = [item["_id"] for item in collection(db, "clubs").find(club_mentor_query(profile["_id"]), {"_id": 1})]
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
    if role == Role.ADMIN.value and admin_type == "other_authority" and designation not in ADMIN_DESIGNATIONS:
        raise HTTPException(status_code=400, detail="Choose an authority designation from the ICTS account options.")
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
        allowed_departments = FACULTY_DEPARTMENTS if role == Role.FACULTY.value else STUDENT_DEPARTMENTS
        if department not in allowed_departments:
            raise HTTPException(status_code=400, detail="Choose a department from the ICTS account options.")
        if joining_year < 2000 or joining_year > datetime.now().year + 1:
            raise HTTPException(status_code=400, detail="Enter a valid 4-digit joining year.")
        yy = str(joining_year)[-2:]
        profile_data.update({"department": department, "joiningYear": joining_year})
        if role == Role.FACULTY.value:
            prefix = f"FA{yy}{department}"
            profile_data["facultyId"] = f"{prefix}{id_sequence(db, prefix)}"
        else:
            school_code = STUDENT_DEPARTMENTS[department][0]
            section = str(body.get("section") or "").strip().upper()
            profile_data.update({
                "campusCode": "BL",
                "schoolCode": school_code,
                "programCode": "U4",
                "section": section,
                "registerNumber": student_register_number(db, school_code, department, joining_year, section),
            })

    created_user = create_supabase_user(email, password, name)
    profile_data["supabaseId"] = created_user["id"]
    created_profile = None
    try:
        created_profile = insert(db, "profiles", profile_data)
        if role == Role.FACULTY.value:
            sync_mentor_accounts(db, {**profile_data, "_id": as_oid(created_profile["_id"])})
        return created_profile
    except Exception as error:
        try:
            if created_profile:
                profiles.delete_one({"_id": as_oid(created_profile["_id"])})
            delete_supabase_user(created_user["id"])
        except Exception as rollback_error:
            logger.exception("Failed to roll back a Supabase user after profile creation failed.")
            raise HTTPException(
                status_code=500,
                detail="The account was created in Supabase but could not be saved in Amrita Sangam. Contact the system owner.",
            ) from rollback_error
        raise error


@router.patch("/profiles/{identity}")
def update_profile(request: Request, identity: str, body: dict, profile=Depends(require_roles(Role.ICTS.value))):
    db = request.app.state.db
    profiles = collection(db, "profiles")
    profile_id = as_oid(identity)
    target = profiles.find_one({"_id": profile_id})
    if not target:
        raise HTTPException(status_code=404, detail="Account not found.")
    if target.get("role") == Role.ICTS.value or target.get("supabaseId") == profile.get("supabaseId"):
        raise HTTPException(status_code=409, detail="The ICTS account cannot edit itself here.")

    name = str(body.get("name", target.get("name", ""))).strip()
    email = str(body.get("email", target.get("email", ""))).strip().lower()
    role = body.get("role", target.get("role"))
    if not name or len(name) > 100:
        raise HTTPException(status_code=400, detail="Name must be between 1 and 100 characters.")
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        raise HTTPException(status_code=400, detail="Enter a valid email address.")
    if email == settings.icts_email:
        raise HTTPException(status_code=409, detail="That email belongs to the ICTS account.")
    duplicate = profiles.find_one({"email": email})
    if duplicate and duplicate.get("_id") != profile_id:
        raise HTTPException(status_code=409, detail="An account with this email already exists.")
    if role not in (Role.ADMIN.value, Role.FACULTY.value, Role.STUDENT.value):
        raise HTTPException(status_code=400, detail="Choose an editable account type.")

    updates = {"name": name, "email": email, "role": role}
    removed_fields = set()
    if role == Role.ADMIN.value:
        admin_type = body.get("adminType", target.get("adminType", "student_affairs"))
        designation = str(body.get("designation", target.get("designation", ""))).strip()
        if admin_type not in ("student_affairs", "principal", "other_authority"):
            raise HTTPException(status_code=400, detail="Choose Student Affairs, Principal or Other authority for the admin type.")
        if admin_type == "other_authority" and designation not in ADMIN_DESIGNATIONS:
            raise HTTPException(status_code=400, detail="Choose an authority designation from the ICTS account options.")
        if len(designation) > 100:
            raise HTTPException(status_code=400, detail="Designation must be 100 characters or fewer.")
        updates.update({"adminType": admin_type, "designation": designation})
        removed_fields.update({"department", "joiningYear", "section", "campusCode", "schoolCode", "programCode", "facultyId", "registerNumber"})
    else:
        department = str(body.get("department", target.get("department", ""))).strip().upper()
        try:
            joining_year = int(body.get("joiningYear", target.get("joiningYear")))
        except (ValueError, TypeError):
            joining_year = 0
        departments = FACULTY_DEPARTMENTS if role == Role.FACULTY.value else STUDENT_DEPARTMENTS
        if department not in departments:
            raise HTTPException(status_code=400, detail="Choose a department from the ICTS account options.")
        if joining_year < 2000 or joining_year > datetime.now().year + 1:
            raise HTTPException(status_code=400, detail="Enter a valid 4-digit joining year.")
        updates.update({"department": department, "joiningYear": joining_year})
        removed_fields.update({"adminType", "designation"})
        if role == Role.FACULTY.value:
            if (
                target.get("role") != Role.FACULTY.value
                or target.get("department") != department
                or target.get("joiningYear") != joining_year
                or not target.get("facultyId")
            ):
                prefix = f"FA{str(joining_year)[-2:]}{department}"
                updates["facultyId"] = f"{prefix}{id_sequence(db, prefix)}"
            removed_fields.update({"section", "campusCode", "schoolCode", "programCode", "registerNumber"})
        else:
            school_code = departments[department][0]
            section = str(body.get("section", target.get("section", ""))).strip().upper()
            if section not in departments[department][1]:
                raise HTTPException(status_code=400, detail="Choose a valid section for the selected department.")
            if (
                target.get("role") != Role.STUDENT.value
                or target.get("department") != department
                or target.get("joiningYear") != joining_year
                or target.get("section") != section
                or not target.get("registerNumber")
            ):
                updates["registerNumber"] = student_register_number(db, school_code, department, joining_year, section)
            updates.update({
                "campusCode": "BL",
                "schoolCode": school_code,
                "programCode": "U4",
                "section": section,
            })
            removed_fields.add("facultyId")

    for field, maximum in (("phone", 20), ("bio", 500)):
        if field in body:
            value = str(body[field]).strip()
            if len(value) > maximum:
                raise HTTPException(status_code=400, detail=f"{field} must be {maximum} characters or fewer.")
            if field == "phone" and value and not re.fullmatch(r"[+\d][\d\s()-]{6,19}", value):
                raise HTTPException(status_code=400, detail="Enter a valid phone number (digits, spaces, +, - or brackets).")
            updates[field] = value
    password = body.get("password")
    if password is not None and password != "":
        if not isinstance(password, str) or len(password) < 8:
            raise HTTPException(status_code=400, detail="Password must be at least 8 characters.")
    if not target.get("supabaseId"):
        raise HTTPException(status_code=409, detail="This account has no linked Supabase login to update.")

    updates["updatedAt"] = datetime.now(timezone.utc)
    unset_fields = removed_fields - updates.keys()
    changed_fields = set(updates) | unset_fields
    old_values = {field: target[field] for field in changed_fields if field in target}
    db_update = {"$set": updates}
    if unset_fields:
        db_update["$unset"] = {field: "" for field in unset_fields}
    profiles.update_one({"_id": profile_id}, db_update)

    auth_updates = {}
    if email != target.get("email"):
        auth_updates.update({"email": email, "email_confirm": True})
    if name != target.get("name"):
        auth_updates["user_metadata"] = {"full_name": name}
    if password:
        auth_updates["password"] = password
    if auth_updates:
        try:
            update_supabase_user(target.get("supabaseId", ""), auth_updates)
        except HTTPException:
            rollback = {"$set": old_values}
            new_fields = changed_fields - old_values.keys()
            if new_fields:
                rollback["$unset"] = {field: "" for field in new_fields}
            profiles.update_one({"_id": profile_id}, rollback)
            raise

    if password or email != target.get("email"):
        collection(db, "auth_sessions").delete_many({"profileId": profile_id})
    if role == Role.FACULTY.value:
        sync_mentor_accounts(db, {**target, **updates, "_id": profile_id})
    elif target.get("role") == Role.FACULTY.value:
        collection(db, "clubs").update_many({"mentor": profile_id}, {"$unset": {"mentor": ""}})
        collection(db, "clubs").update_many({"mentorIds": profile_id}, {"$pull": {"mentorIds": profile_id}})
    return serialize_document(profiles.find_one({"_id": profile_id}))


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
        roster = report.get("rosterCsv", "")
        has_roll_column = bool(roster) and "Roll number" in roster.splitlines()[0]
        if has_roll_column and target.get("registerNumber"):
            csv_data, removed = remove_csv_rows_for_value(roster, "Roll number", target["registerNumber"])
        elif has_roll_column:
            csv_data, removed = remove_csv_rows_for_value(roster, "Name", target.get("name", ""))
        else:
            csv_data, removed = remove_csv_rows_for_email(roster, email)
        reports.update_one({"_id": report["_id"]}, {
            "$set": {"rosterCsv": csv_data},
            "$inc": {"attendeeCount": -removed},
            "$pull": {"attendeeIds": profile_id},
        })
    try:
        collection(db, "clubs").update_many({"mentor": profile_id}, {"$unset": {"mentor": ""}})
        collection(db, "clubs").update_many({"mentorIds": profile_id}, {"$pull": {"mentorIds": profile_id}})
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
            detail="The login was deleted in Supabase, but some data in Amrita Sangam could not be cleaned up. Retry the deletion to finish cleanup.",
        ) from error
    return {"message": "Account and account-linked records were deleted."}
