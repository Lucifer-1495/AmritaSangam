from enum import Enum


class Role(str, Enum):
    STUDENT = "student"
    COMMITTEE = "club_committee"
    FACULTY = "faculty_coordinator"
    ADMIN = "college_admin"
    ICTS = "icts"


COLLECTIONS = {
    "profiles": "profiles",
    "clubs": "clubs",
    "events": "events",
    "venues": "venues",
    "registrations": "eventregistrations",
    "members": "clubmembers",
    "attendance": "attendances",
    "equipment": "equipment",
    "borrows": "equipmentborrows",
    "budgets": "clubbudgets",
    "funding": "fundingrequests",
    "transactions": "budgettransactions",
    "applications": "membershipapplications",
    "announcements": "announcements",
    "event_reports": "eventreports",
    "messages": "clubmessages",
    "counters": "counters",
}
