from datetime import datetime, timezone
import argparse

from .config import settings
from .database import connect_database, migrate_legacy_data


def seed(demo=False):
    if not demo:
        raise RuntimeError("Sample data seeding requires the explicit --demo flag.")
    if not settings.mongo_uri:
        raise RuntimeError("MONGO_URI is required to seed Amrita Sangam.")
    client, db = connect_database(settings.mongo_uri)
    try:
        migrate_legacy_data(db, settings.icts_email)
        venues = db["venues"]
        auditorium = venues.find_one_and_update(
            {"name": "Main Auditorium"},
            {"$set": {"isDemoData": True},
             "$setOnInsert": {"capacity": 500, "location": "Academic Block A", "isAvailable": True,
                              "createdAt": datetime.now(timezone.utc), "updatedAt": datetime.now(timezone.utc)}},
            upsert=True,
            return_document=True,
        )
        tech_lab = venues.find_one_and_update(
            {"name": "Innovation Lab"},
            {"$set": {"isDemoData": True},
             "$setOnInsert": {"capacity": 60, "location": "Computer Science Department", "isAvailable": True,
                              "createdAt": datetime.now(timezone.utc), "updatedAt": datetime.now(timezone.utc)}},
            upsert=True,
            return_document=True,
        )

        clubs = db["clubs"]
        community = clubs.find_one_and_update(
            {"name": "Campus Connect"},
            {"$set": {"isDemoData": True},
             "$setOnInsert": {
                "description": "Bring students together through campus-wide experiences, volunteering, and community.",
                "category": "Community", "clubType": "non_technical", "recruitmentOpen": True,
                "foundedDate": datetime.now(timezone.utc), "createdAt": datetime.now(timezone.utc),
                "updatedAt": datetime.now(timezone.utc),
            }},
            upsert=True,
            return_document=True,
        )
        tech_club = clubs.find_one_and_update(
            {"name": "Microsoft Student Club"},
            {"$set": {"isDemoData": True},
             "$setOnInsert": {
                "description": "A student-led technology community for workshops, hackathons, and emerging ideas.",
                "category": "Technology", "clubType": "technical", "recruitmentOpen": True,
                "foundedDate": datetime.now(timezone.utc), "createdAt": datetime.now(timezone.utc),
                "updatedAt": datetime.now(timezone.utc),
            }},
            upsert=True,
            return_document=True,
        )
        events = db["events"]
        seed_events = [
            {
                "title": "Build Night: Ideas to Impact",
                "description": "An evening of collaborative prototyping, practical demos, and good ideas made real.",
                "eventDate": datetime(2026, 11, 12, 17, tzinfo=timezone.utc),
                "clubId": tech_club["_id"], "venueId": tech_lab["_id"], "capacity": 60,
                "eventType": "technical",
            },
            {
                "title": "Campus Connect Open House",
                "description": "Meet student organizers, discover campus communities, and find your next thing.",
                "eventDate": datetime(2026, 11, 19, 16, tzinfo=timezone.utc),
                "clubId": community["_id"], "venueId": auditorium["_id"], "capacity": 250,
                "eventType": "non_technical",
            },
        ]
        for event in seed_events:
            events.update_one(
                {"title": event["title"], "clubId": event["clubId"]},
                {"$set": {"isDemoData": True},
                 "$setOnInsert": {
                    **event, "status": "approved", "registeredCount": 0,
                    "createdAt": datetime.now(timezone.utc), "updatedAt": datetime.now(timezone.utc),
                }},
                upsert=True,
            )
        for club_id, allocated, spent in ((tech_club["_id"], 50000, 12500), (community["_id"], 80000, 45000)):
            db["clubbudgets"].update_one(
                {"clubId": club_id, "academicYear": "2026-2027"},
                {"$set": {"isDemoData": True},
                 "$setOnInsert": {
                    "totalAllocated": allocated, "totalSpent": spent,
                    "createdAt": datetime.now(timezone.utc), "updatedAt": datetime.now(timezone.utc),
                }},
                upsert=True,
            )
        equipment = [
            (tech_club["_id"], "Raspberry Pi Kits", "Starter kits for hands-on prototyping sessions.", 15),
            (community["_id"], "Portable PA System", "Portable audio equipment for campus gatherings.", 2),
        ]
        for club_id, name, description, quantity in equipment:
            db["equipment"].update_one(
                {"clubId": club_id, "name": name},
                {"$set": {"isDemoData": True},
                 "$setOnInsert": {
                    "description": description, "totalQuantity": quantity, "availableQuantity": quantity,
                    "condition": "good", "createdAt": datetime.now(timezone.utc), "updatedAt": datetime.now(timezone.utc),
                }},
                upsert=True,
            )
        announcements = [
            (tech_club["_id"], "Build Night registrations are open", "Save your seat for an evening of prototyping and practical technology demos.", "high"),
            (community["_id"], "Meet your campus community", "Join our open house to meet student organizers and explore clubs across campus.", "normal"),
        ]
        for club_id, title, content, priority in announcements:
            db["announcements"].update_one(
                {"clubId": club_id, "title": title},
                {"$set": {"isDemoData": True},
                 "$setOnInsert": {
                    "content": content, "priority": priority, "postedDate": datetime.now(timezone.utc),
                    "createdAt": datetime.now(timezone.utc), "updatedAt": datetime.now(timezone.utc),
                }},
                upsert=True,
            )
        print("Amrita Sangam sample data is ready. Existing data was preserved.")
    finally:
        client.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed clearly labeled Amrita Sangam demo data.")
    parser.add_argument("--demo", action="store_true", help="Confirm that sample data should be added.")
    seed(demo=parser.parse_args().demo)
