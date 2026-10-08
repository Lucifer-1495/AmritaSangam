import csv
import io
import math
import re
from datetime import datetime, timezone

from bson import ObjectId
from fastapi import HTTPException

from ..database import serialize_document
from ..models import COLLECTIONS, Role


OFFICE_BEARER_POSITIONS = ["office_bearer", "president", "vice_president", "treasurer", "secretary"]
LEADERSHIP_POSITIONS = ["executive", *OFFICE_BEARER_POSITIONS]
STUDENT_ROLES = [Role.STUDENT.value, Role.COMMITTEE.value]


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
    if profile["role"] == Role.ADMIN.value or str(club.get("mentor")) == profile["_id"]:
        return True
    return bool(collection(db, "members").find_one({
        "clubId": club["_id"],
        "profileId": as_oid(profile["_id"]),
        "membershipStatus": "active",
        "position": {"$in": LEADERSHIP_POSITIONS},
    }))


def can_review_memberships(db, club_id, profile):
    if profile["role"] == Role.ADMIN.value:
        return True
    club = collection(db, "clubs").find_one({"_id": as_oid(club_id)}, {"mentor": 1})
    if not club:
        return False
    if profile["role"] == Role.FACULTY.value and str(club.get("mentor", "")) == profile["_id"]:
        return True
    membership = active_membership(db, club_id, profile["_id"])
    return bool(membership and (
        membership.get("position") in OFFICE_BEARER_POSITIONS
        or (membership.get("position") == "executive" and membership.get("officeBearerGroup"))
    ))


def require_club_position(db, club_id, profile, positions):
    if profile["role"] == Role.ADMIN.value:
        return None
    membership = active_membership(db, club_id, profile["_id"])
    if not membership:
        raise HTTPException(status_code=403, detail="You must be a member of this club.")
    matches = membership.get("position") in positions
    custom_bearer = (
        "office_bearer" in positions
        and membership.get("officeBearerGroup")
        and membership.get("position") == "executive"
    )
    if not matches and not custom_bearer:
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
        ids.extend(record["_id"] for record in collection(db, "clubs").find({"mentor": as_oid(profile["_id"])}, {"_id": 1}))
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
        person = collection(db, "profiles").find_one({"_id": item.get("profileId")}, {"name": 1, "email": 1})
        if person:
            item["profileId"] = person
            attendees.append(item)
    output = io.StringIO(newline="")
    writer = csv.writer(output, lineterminator="\r\n")
    writer.writerow(["Name", "Email", "Attendance status", "Checked in at"])
    for item in attendees:
        checked_in = item.get("checkInTime")
        writer.writerow([
            item["profileId"].get("name", ""),
            item["profileId"].get("email", ""),
            item.get("status", ""),
            checked_in.isoformat() if checked_in else "",
        ])
    filename = re.sub(r"[^a-z0-9]+", "-", title, flags=re.IGNORECASE).strip("-").lower()
    return {
        "attendeeCount": len(attendees),
        "attendeeIds": [item["profileId"]["_id"] for item in attendees],
        "rosterFileName": f"{filename}-od-attendance.csv",
        "rosterCsv": output.getvalue().rstrip("\r\n"),
    }


def remove_csv_rows_for_email(csv_data, email):
    rows = list(csv.reader(io.StringIO(str(csv_data or ""))))
    if not rows:
        return "", 0
    email_column = next((index for index, heading in enumerate(rows[0]) if heading.lower() == "email"), None)
    if email_column is None:
        return csv_data, 0
    kept = [rows[0]]
    removed = 0
    for row in rows[1:]:
        if email_column < len(row) and row[email_column].lower() == email.lower():
            removed += 1
        else:
            kept.append(row)
    output = io.StringIO(newline="")
    csv.writer(output, lineterminator="\r\n").writerows(kept)
    return output.getvalue().rstrip("\r\n"), removed


def id_sequence(db, prefix):
    result = collection(db, "counters").find_one_and_update(
        {"_id": prefix},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True,
    )
    if result["seq"] > 999:
        raise HTTPException(status_code=409, detail=f"All 999 IDs for {prefix} are used. Contact the system owner.")
    return str(result["seq"]).zfill(3)


def assert_mentor(db, identity):
    if not collection(db, "profiles").find_one({"_id": as_oid(identity), "role": Role.FACULTY.value}, {"_id": 1}):
        raise HTTPException(status_code=400, detail="Choose a faculty mentor account created by ICTS.")

