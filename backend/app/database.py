from pymongo import ASCENDING, MongoClient


def connect_database(uri: str):
    client = MongoClient(uri, serverSelectionTimeoutMS=10_000, tz_aware=True)
    client.admin.command("ping")
    return client, client.get_default_database()


def migrate_legacy_data(database, icts_email: str) -> None:
    profiles = database["profiles"]
    profile_indexes = profiles.index_information()
    for name, index in profile_indexes.items():
        partial = index.get("partialFilterExpression", {})
        if index.get("unique") and index.get("key") == [("role", ASCENDING)] and partial.get("role") == "college_admin":
            profiles.drop_index(name)

    profiles.update_many({"role": "faculty"}, {"$set": {"role": "faculty_coordinator"}})
    profiles.update_many({"role": "admin"}, {"$set": {"role": "college_admin"}})
    profiles.update_many(
        {"role": "college_admin", "adminType": {"$exists": False}},
        {"$set": {"adminType": "student_affairs"}},
    )
    if icts_email:
        profiles.update_many({"email": icts_email}, {"$set": {"role": "icts"}})

    members = database["clubmembers"]
    members.update_many({"membershipStatus": {"$exists": False}}, {"$set": {"membershipStatus": "active"}})
    members.update_many(
        {"position": {"$exists": False}},
        [{
            "$set": {
                "position": {
                    "$switch": {
                        "branches": [
                            {"case": {"$eq": ["$role", "executive"]}, "then": "executive"},
                            {"case": {"$eq": ["$role", "office_bearer"]}, "then": "office_bearer"},
                        ],
                        "default": "member",
                    }
                },
                "positionTitle": "",
                "officeBearerGroup": {"$eq": ["$role", "office_bearer"]},
            }
        }],
    )
    members.update_many({"role": {"$exists": True}}, {"$unset": {"role": ""}})
    member_indexes = members.index_information()
    for name, index in member_indexes.items():
        if index.get("unique") and index.get("key") == [
            ("clubId", ASCENDING), ("profileId", ASCENDING), ("positionTitle", ASCENDING)
        ]:
            members.drop_index(name)

    duplicates = list(members.aggregate([
        {"$group": {"_id": {"clubId": "$clubId", "profileId": "$profileId"}, "records": {"$push": "$$ROOT"}, "count": {"$sum": 1}}},
        {"$match": {"count": {"$gt": 1}}},
    ]))
    priority = {"member": 0, "executive": 1, "office_bearer": 2, "secretary": 3, "treasurer": 4, "vice_president": 5, "president": 6}
    for group in duplicates:
        records = sorted(group["records"], key=lambda item: priority.get(item.get("position", item.get("role", "")), 0), reverse=True)
        keep, remove = records[0], records[1:]
        members.update_one(
            {"_id": keep["_id"]},
            {"$set": {
                "officeBearerGroup": any(item.get("officeBearerGroup") is True for item in records),
                "positionTitle": keep.get("positionTitle") or next((item.get("positionTitle") for item in records if item.get("positionTitle")), ""),
            }},
        )
        members.delete_many({"_id": {"$in": [item["_id"] for item in remove]}})

    clubs = database["clubs"]
    clubs.update_many({"mentor": {"$exists": False}, "facultyCoordinator": {"$exists": True}}, [
        {"$set": {"mentor": "$facultyCoordinator"}}
    ])
    clubs.update_many({"clubType": {"$exists": False}}, {"$set": {"clubType": "non_technical"}})
    clubs.update_many({"recruitmentOpen": {"$exists": False}}, {"$set": {"recruitmentOpen": False}})

    events = database["events"]
    events.update_many({"status": "pending"}, {"$set": {"status": "mentor_pending"}})
    events.update_many({"status": {"$exists": False}}, {"$set": {"status": "mentor_pending"}})
    events.update_many({"status": "approved", "mentorReviewedBy": {"$exists": False}}, {"$set": {"mentorReviewedBy": None}})
    for event in events.find({"eventType": {"$exists": False}}, {"clubId": 1}):
        club = clubs.find_one({"_id": event.get("clubId")}, {"clubType": 1})
        events.update_one({"_id": event["_id"], "eventType": {"$exists": False}}, {"$set": {"eventType": (club or {}).get("clubType", "non_technical")}})
    for event in events.find({"registeredCount": {"$exists": False}}, {"_id": 1}):
        count = database["eventregistrations"].count_documents({"eventId": event["_id"], "status": {"$ne": "cancelled"}})
        events.update_one({"_id": event["_id"], "registeredCount": {"$exists": False}}, {"$set": {"registeredCount": count}})

    borrows = database["equipmentborrows"]
    for borrow in borrows.find({"clubId": {"$exists": False}}, {"equipmentId": 1}):
        equipment = database["equipment"].find_one({"_id": borrow.get("equipmentId")}, {"clubId": 1})
        if equipment and equipment.get("clubId"):
            borrows.update_one({"_id": borrow["_id"]}, {"$set": {"clubId": equipment["clubId"]}})

    database["profiles"].create_index("supabaseId", unique=True)
    database["profiles"].create_index("email", unique=True)
    database["clubs"].create_index("name", unique=True)
    database["venues"].create_index("name", unique=True)
    database["clubmembers"].create_index([("clubId", ASCENDING), ("profileId", ASCENDING)], unique=True)
    database["eventregistrations"].create_index([("eventId", ASCENDING), ("profileId", ASCENDING)], unique=True)
    database["attendances"].create_index([("eventId", ASCENDING), ("profileId", ASCENDING)], unique=True)
    database["eventreports"].create_index("eventId", unique=True)
    database["clubbudgets"].create_index([("clubId", ASCENDING), ("academicYear", ASCENDING)], unique=True)
    database["membershipapplications"].create_index(
        [("clubId", ASCENDING), ("profileId", ASCENDING)],
        unique=True,
        partialFilterExpression={"status": "pending"},
    )
    database["budgettransactions"].create_index(
        "fundingRequestId",
        unique=True,
        partialFilterExpression={"fundingRequestId": {"$exists": True}},
    )
    database["clubmessages"].create_index([("clubId", ASCENDING), ("group", ASCENDING), ("createdAt", -1)])
    database["auth_sessions"].create_index("expiresAt", expireAfterSeconds=0)


def serialize(value):
    from datetime import date, datetime
    from bson import ObjectId

    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, dict):
        return {key: serialize(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [serialize(item) for item in value]
    return value


def serialize_document(document):
    return serialize(document) if document is not None else None
