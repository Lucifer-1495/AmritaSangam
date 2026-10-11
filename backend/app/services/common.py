import csv
import base64
import hashlib
import hmac
import io
import math
import re
import secrets
from datetime import datetime, timezone

from bson import ObjectId
from fastapi import HTTPException

from ..database import serialize_document
from ..models import COLLECTIONS, Role


OFFICE_BEARER_POSITIONS = ["office_bearer", "president", "vice_president", "treasurer", "secretary"]
LEADERSHIP_POSITIONS = ["executive", *OFFICE_BEARER_POSITIONS]
STUDENT_ROLES = [Role.STUDENT.value, Role.COMMITTEE.value]
STUDENT_DEPARTMENTS = {
    "CSE": ("SC", ("A", "B", "C")),
    "AIE": ("SC", ("D", "E", "F")),
    "AID": ("SC", ("G",)),
    "ECE": ("EN", ("H", "I", "J")),
    "EAC": ("EN", ("K",)),
    "EEE": ("EN", ("L",)),
    "ELC": ("EN", ("M",)),
    "MEE": ("EN", ("N",)),
}
FACULTY_DEPARTMENTS = {
    "ECE": "Department of Electronics and Communication Engineering (ECE)",
    "EEE": "Department of Electrical and Electronics Engineering (EEE)",
    "MEE": "Department of Mechanical Engineering",
    "MAT": "Department of Mathematics",
    "PHY": "Department of Physics",
    "CHE": "Department of Chemistry",
    "ENG": "Department of English",
    "CSE": "Department of Computer Science and Engineering (CSE)",
    "MBA": "Department of Management & Commerce / MBA Programs",
    "CIR": "CIR",
}
SCHOOL_NAMES = {
    "SC": "School of Computing",
    "EN": "School of Engineering",
    "MBA": "School of Business",
}
DEPARTMENT_SCHOOLS = {
    "CSE": "SC",
    "AIE": "SC",
    "AID": "SC",
    "ECE": "EN",
    "EAC": "EN",
    "EEE": "EN",
    "ELC": "EN",
    "MEE": "EN",
    "MBA": "MBA",
}


def collection(db, name):
    return db[COLLECTIONS.get(name, name)]


def as_oid(value, field="id"):
    if isinstance(value, ObjectId):
        return value
    try:
        return ObjectId(str(value))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail=f"Invalid {field}.")


def require_fields(body: dict, fields: list[str]):
    missing = [field for field in fields if body.get(field) is None or body.get(field) == ""]
    if missing:
        raise HTTPException(status_code=400, detail=f"Required fields: {', '.join(missing)}")


def require_rejection_feedback(body: dict):
    if not isinstance(body.get("rejectionFeedback"), str) or not body["rejectionFeedback"].strip():
        raise HTTPException(status_code=400, detail="Provide a reason when rejecting a request.")


def now():
    return datetime.now(timezone.utc)


def parse_date(value, message="Enter a valid date."):
    if isinstance(value, datetime):
        parsed = value
    else:
        try:
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail=message)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed


def parse_number(value, field, minimum=None):
    try:
        result = float(value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail=f"Enter a valid number for {field}.")
    if not math.isfinite(result) or (minimum is not None and result < minimum):
        suffix = f" (at least {minimum:g})" if minimum is not None else ""
        raise HTTPException(status_code=400, detail=f"{field} must be a valid number{suffix}.")
    return result


def insert(db, name, values):
    record = dict(values)
    record.setdefault("createdAt", now())
    record.setdefault("updatedAt", record["createdAt"])
    result = collection(db, name).insert_one(record)
    record["_id"] = result.inserted_id
    return serialize_document(record)


def populate_many(db, records, fields):
    for record in records:
        for field, target, projection in fields:
            if record is None or not record.get(field):
                continue
            project = {name: 1 for name in projection} if projection else None
            record[field] = collection(db, target).find_one({"_id": record[field]}, project)
    return records


def club_mentor_ids(club):
    if not club:
        return []
    values = [club.get("mentor"), *(club.get("mentorIds") or [])]
    identities = []
    for value in values:
        identity = value.get("_id") if isinstance(value, dict) else value
        if identity and str(identity) not in {str(item) for item in identities}:
            identities.append(identity)
    return identities


def event_club_ids(event):
    identities = [event.get("clubId"), *(event.get("coHostIds") or [])]
    return list({str(identity): identity for identity in identities if identity}.values())


def event_involves_club(event, club_id):
    return str(club_id) in {str(identity) for identity in event_club_ids(event)}


def mentor_approval_assignments(db, event):
    assignments = []
    for club_id in event_club_ids(event):
        club = collection(db, "clubs").find_one({"_id": as_oid(club_id)})
        if not club or club.get("organizationType") == "event_organizer":
            continue
        mentor_ids = club_mentor_ids(club)
        if not mentor_ids:
            raise HTTPException(
                status_code=409,
                detail=f"Assign a faculty mentor to {club.get('name', 'each participating club')} before submitting this request.",
            )
        assignments.extend({
            "clubId": as_oid(club["_id"]),
            "mentorId": as_oid(mentor_id),
            "status": "pending",
        } for mentor_id in mentor_ids)
    return assignments


def review_mentor_assignment(record, profile_id, status, reviewed_at):
    assignments = record.get("mentorApprovals") or []
    pending = [
        assignment for assignment in assignments
        if assignment.get("status") == "pending"
        and str(assignment.get("mentorId")) == str(profile_id)
    ]
    if not pending:
        return False, False
    for assignment in pending:
        assignment["status"] = status
        assignment["reviewedBy"] = as_oid(profile_id)
        assignment["reviewedAt"] = reviewed_at
    complete = all(assignment.get("status") == "approved" for assignment in assignments)
    return True, complete


def is_club_mentor(club, profile_id):
    return str(profile_id) in {str(identity) for identity in club_mentor_ids(club)}


def club_mentor_query(profile_id):
    identity = as_oid(profile_id)
    return {"$or": [{"mentor": identity}, {"mentorIds": identity}]}


def populate_club_mentors(db, clubs, projection=("name", "email")):
    profiles = collection(db, "profiles")
    for club in clubs:
        identities = club_mentor_ids(club)
        if identities:
            club["mentors"] = list(profiles.find(
                {"_id": {"$in": identities}},
                {field: 1 for field in projection},
            ))
        else:
            club["mentors"] = []
    return clubs


def active_membership(db, club_id, profile_id):
    return collection(db, "members").find_one({
        "clubId": as_oid(club_id),
        "profileId": as_oid(profile_id),
        "membershipStatus": "active",
    })


def can_manage_club(db, club_id, profile):
    club = collection(db, "clubs").find_one({"_id": as_oid(club_id)})
    if not club:
        raise HTTPException(status_code=404, detail="Club not found.")
    if profile["role"] == Role.ADMIN.value or is_club_mentor(club, profile["_id"]):
        return True
    membership = collection(db, "members").find_one({
        "clubId": club["_id"],
        "profileId": as_oid(profile["_id"]),
        "membershipStatus": "active",
        "position": "executive",
        "officeBearerGroup": {"$ne": True},
    })
    return bool(membership)


def can_review_memberships(db, club_id, profile):
    if profile["role"] == Role.ADMIN.value:
        return True
    club = collection(db, "clubs").find_one({"_id": as_oid(club_id)}, {"mentor": 1, "mentorIds": 1})
    if not club:
        return False
    if profile["role"] == Role.FACULTY.value and is_club_mentor(club, profile["_id"]):
        return True
    return False


def is_office_bearer(membership):
    return bool(
        membership
        and membership.get("membershipStatus") == "active"
        and (
            membership.get("position") in OFFICE_BEARER_POSITIONS
            or (membership.get("position") == "executive" and membership.get("officeBearerGroup"))
        )
    )


def has_office_bearer_membership(db, profile_id):
    return bool(collection(db, "members").find_one({
        "profileId": as_oid(profile_id),
        "membershipStatus": "active",
        "$or": [
            {"position": {"$in": OFFICE_BEARER_POSITIONS}},
            {"position": "executive", "officeBearerGroup": True},
        ],
    }, {"_id": 1}))


def has_verified_club_access(db, club_id, profile):
    verified_club_id = profile.get("verifiedClubId")
    if profile.get("isClubAccount"):
        return bool(verified_club_id and str(verified_club_id) == str(club_id))
    if (
        profile.get("role") not in STUDENT_ROLES
        or not verified_club_id
        or str(verified_club_id) != str(club_id)
    ):
        return False
    return is_office_bearer(active_membership(db, club_id, profile["_id"]))


def is_executive(membership):
    return bool(
        membership
        and membership.get("membershipStatus") == "active"
        and membership.get("position") == "executive"
        and not membership.get("officeBearerGroup")
    )


def profile_identity_fields(profile):
    role = profile.get("role")
    register_number = str(profile.get("registerNumber") or "")
    faculty_number = str(profile.get("facultyId") or "")
    faculty_department = next((
        code for code in sorted(FACULTY_DEPARTMENTS, key=len, reverse=True)
        if re.fullmatch(rf"FA\d{{2}}{code}\d+", faculty_number)
    ), None)
    identity_type = (
        "faculty" if role == Role.FACULTY.value
        else "student" if role in STUDENT_ROLES
        else "faculty" if not role and faculty_department
        else "student" if not role and register_number.startswith("BL.")
        else None
    )
    register_school = register_number.split(".")[1] if register_number.count(".") >= 2 else None
    school_code = profile.get("schoolCode") or register_school or DEPARTMENT_SCHOOLS.get(
        str(profile.get("department") or "").upper()
    ) or DEPARTMENT_SCHOOLS.get(faculty_department)
    return {
        "identityType": identity_type,
        "school": SCHOOL_NAMES.get(school_code),
    }


def hash_shared_password(password):
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 310_000)
    encoded_salt = base64.urlsafe_b64encode(salt).decode()
    encoded_digest = base64.urlsafe_b64encode(digest).decode()
    return f"pbkdf2_sha256$310000${encoded_salt}${encoded_digest}"


def verify_shared_password(password, encoded):
    try:
        scheme, rounds, encoded_salt, expected = encoded.split("$", 3)
        if scheme != "pbkdf2_sha256":
            return False
        salt = base64.urlsafe_b64decode(encoded_salt.encode())
        expected_digest = base64.urlsafe_b64decode(expected.encode())
        actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, int(rounds))
    except (AttributeError, TypeError, ValueError):
        return False
    return hmac.compare_digest(actual, expected_digest)


def review_history_entry(profile, status, stage, feedback="", reviewed_at=None):
    return {
        "reviewerId": as_oid(profile["_id"]),
        "reviewerName": profile.get("name") or "Club account",
        "status": status,
        "stage": stage,
        "feedback": feedback,
        "reviewedAt": reviewed_at or now(),
    }


def populate_review_history(db, records):
    profiles = collection(db, "profiles")
    for record in records:
        for entry in record.get("reviewHistory", []):
            reviewer_id = entry.get("reviewerId")
            if reviewer_id:
                entry["reviewer"] = profiles.find_one({"_id": reviewer_id}, {"name": 1}) or {
                    "name": entry.get("reviewerName") or "Former account"
                }
    return records


def is_student_affairs(profile):
    return profile.get("role") == Role.ADMIN.value and profile.get("adminType") == "student_affairs"


def require_club_position(db, club_id, profile, positions):
    if profile["role"] == Role.ADMIN.value:
        return None
    membership = active_membership(db, club_id, profile["_id"])
    if not membership:
        raise HTTPException(status_code=403, detail="You must be a member of this club.")
    matches = membership.get("position") in positions and not (
        membership.get("position") == "executive"
        and membership.get("officeBearerGroup")
        and "executive" in positions
    )
    if not matches:
        raise HTTPException(status_code=403, detail=f"This action requires a club {' or '.join(positions)} role.")
    return membership


def visible_club_ids(db, profile, positions=None):
    query = {"profileId": as_oid(profile["_id"]), "membershipStatus": "active"}
    if positions:
        query["$or"] = [{"position": {"$in": positions}}]
        if "office_bearer" in positions:
            query["$or"].append({"position": "executive", "officeBearerGroup": True})
    ids = [record["clubId"] for record in collection(db, "members").find(query, {"clubId": 1})]
    if profile["role"] == Role.ADMIN.value:
        ids.extend(record["_id"] for record in collection(db, "clubs").find({}, {"_id": 1}))
    if profile["role"] == Role.FACULTY.value:
        ids.extend(record["_id"] for record in collection(db, "clubs").find(club_mentor_query(profile["_id"]), {"_id": 1}))
    return list({str(identity): identity for identity in ids}.values())


def require_club_manager(db, club_id, profile):
    if not club_id:
        raise HTTPException(status_code=400, detail="A clubId is required.")
    if not can_manage_club(db, club_id, profile):
        raise HTTPException(status_code=403, detail="Only this club’s committee, assigned faculty, or an admin can do that.")


def build_attendance_roster(db, event_id, title):
    attendance = list(collection(db, "attendance").find({
        "eventId": as_oid(event_id), "status": "present"
    }).sort("checkInTime", 1))
    attendees = []
    for item in attendance:
        person = collection(db, "profiles").find_one(
            {"_id": item.get("profileId")}, {"name": 1, "registerNumber": 1}
        )
        if person:
            item["profileId"] = person
            attendees.append(item)
    output = io.StringIO(newline="")
    writer = csv.writer(output, lineterminator="\r\n")
    writer.writerow(["Name", "Roll number"])
    for item in attendees:
        writer.writerow([
            item["profileId"].get("name", ""),
            item["profileId"].get("registerNumber", ""),
        ])
    filename = re.sub(r"[^a-z0-9]+", "-", title, flags=re.IGNORECASE).strip("-").lower()
    return {
        "attendeeCount": len(attendees),
        "attendeeIds": [item["profileId"]["_id"] for item in attendees],
        "rosterFileName": f"{filename}-od-attendance.csv",
        "rosterCsv": output.getvalue().rstrip("\r\n"),
    }


def remove_csv_rows_for_email(csv_data, email):
    return remove_csv_rows_for_value(csv_data, "email", email)


def remove_csv_rows_for_value(csv_data, heading, value):
    rows = list(csv.reader(io.StringIO(str(csv_data or ""))))
    if not rows:
        return "", 0
    value_column = next((index for index, column in enumerate(rows[0]) if column.lower() == heading.lower()), None)
    if value_column is None:
        return csv_data, 0
    kept = [rows[0]]
    removed = 0
    for row in rows[1:]:
        if value_column < len(row) and row[value_column].lower() == str(value).lower():
            removed += 1
        else:
            kept.append(row)
    output = io.StringIO(newline="")
    csv.writer(output, lineterminator="\r\n").writerows(kept)
    return output.getvalue().rstrip("\r\n"), removed


def id_sequence(db, prefix, maximum=999):
    result = collection(db, "counters").find_one_and_update(
        {"_id": prefix},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True,
    )
    if result["seq"] > maximum:
        raise HTTPException(status_code=409, detail=f"All {maximum} IDs for {prefix} are used. Contact the system owner.")
    return str(result["seq"]).zfill(3)


def student_register_number(db, school_code, department, joining_year, section):
    department_info = STUDENT_DEPARTMENTS.get(department)
    if not department_info or section not in department_info[1]:
        raise HTTPException(status_code=400, detail="Choose a valid section for the selected department.")
    expected_school, sections = department_info
    if school_code != expected_school:
        raise HTTPException(status_code=400, detail="Choose the school assigned to the selected department.")
    section_offsets = {section_code: index * 100 for index, section_code in enumerate(sections)}
    year_code = str(joining_year)[-2:]
    counter_prefix = f"BL.{school_code}.U4{department}{year_code}.{section}"
    class_roll = int(id_sequence(db, counter_prefix, maximum=99)) + section_offsets[section]
    return f"BL.{school_code}.U4{department}{year_code}{class_roll:03d}"


def assert_mentor(db, identity):
    if not collection(db, "profiles").find_one({"_id": as_oid(identity), "role": Role.FACULTY.value}, {"_id": 1}):
        raise HTTPException(status_code=400, detail="Choose a faculty mentor account created by ICTS.")
