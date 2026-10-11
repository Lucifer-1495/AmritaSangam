from datetime import datetime, timezone
import re


VENUES = (
    "Amriteswari Hall",
    "Sudhamani Hall",
    "Krishna Hall",
    "Vyasa Hall",
    "Rama Hall",
    "Valmiki Hall",
    "Stage between B and C Block",
    "College Playground",
)

CLUBS = (
    "Aavishkara - The Science Forum",
    "ACE - Amrita Centre for Entrepreneurship",
    "ACM - Association of Computing Machinery",
    "ACM-W - Association of Computing Machinery-Women",
    "ACROM & IEEE-RAS - Amrita Club for Robotics and Mechatronics & IEEE-Robotics and Automation Society",
    "Agentblazer Club",
    "AMAL - Amrita Management and Leadership Club",
    "ATLAS",
    "Code Chef",
    "CSI - Computer Society of India",
    "ECCF - Electronics, Computers and Communication Forum",
    "FACE - Forum for Aspiring Computer Engineers",
    "FORGE - Forum for Game Engineering",
    "GDG (Google Developer Group)",
    "IEEE AESS - Aerospace And Electronic System Society",
    "IEEE Circuits and Systems",
    "IEEE Computer Society",
    "IEEE - Computational Intelligence Society Chapter",
    "IEEE ComSoc (IEEE - Communication Society)",
    "IEEE Innovation Club",
    "IEEE PELS (IEEE - Power Electronics Society)",
    "IEEE PES (Power & Energy Society) and IAS (Industry Applications Society) Joint Student Branch Chapter",
    "IEEE Sensors Council",
    "IEEE SIGHT (IEEE - Special Group on Humanitarian Technology)",
    "IEEE Signal Processing",
    "IEEE Student Branch",
    "IEEE System Council",
    "IEEE VTS (IEEE Vehicular Technology Society)",
    "IEEE WIE (IEEE - Women in Engineering)",
    "Ingenium - The Mechanical Department Forum",
    "JIDO - The Industrial Automation Club",
    "Microsoft Ignite Students Club (MISC)",
    "National Students Data Corp (NSDC)",
    "NEURON - The AI Club",
    "SAE - Society of Automotive Engineers",
    "SANKHYA - The Mathematics Club",
    "The Robotics Society (TRS) - Student Chapter",
    "Vidyuth - The Electrical Department Forum",
    "VYOM - The Astro Physics Club",
    "Abhinaya - The Drama Club",
    "Chethana - The Sports Club",
    "Dharohar - The Heritage Club",
    "Dhwani - The Literary Club",
    "EPIC - The Movie Club",
    "Kala - The Fine Arts Club",
    "Lekhani - The Press Club",
    "Narthana - The Dance Club",
    "Prakriti - The Environmental Club",
    "Prerana - The Social Outreach Club",
    "Quiz Club",
    "Raaga - The Music Club",
    "Samatva - The Yoga Club",
    "Smriti - The Photography and Design Club",
    "Squad - Patriotism and Adventure Club",
    "TAB (Toast Masters Amrita Bengaluru)",
    "Vedavani - The Vedanta and Sanskrit Club",
)

EVENT_ORGANIZERS = (
    "DASTHAN",
    "Aarohan - Science Fair",
    *(f"Freshers - {department}" for department in (
        "CSE", "AIE", "AID", "ECE", "EAC", "EEE", "ELC", "MEE",
        "MAT", "PHY", "CHE", "ENG", "MBA", "CIR",
    )),
)

CLUB_RENAMES = {
    "squad": "Squad - Patriotism and Adventure Club",
    "microsoft ignite students club": "Microsoft Ignite Students Club (MISC)",
    "misc": "Microsoft Ignite Students Club (MISC)",
    "aarohan": "Aarohan - Science Fair",
}

CLUB_MENTORS = {
    "Aavishkara - The Science Forum": [("Dr. Sivakumar B.", "Chemistry"), ("Dr. Nizampatnam Neelima", "ECE")],
    "ACE - Amrita Centre for Entrepreneurship": [("Mr. Anirudh P.", "CIR")],
    "ACM - Association of Computing Machinery": [("Dr. Niharika Panda", "SOC")],
    "ACM-W - Association of Computing Machinery-Women": [("Dr. Sanghamitra Mishra", "SOC")],
    "ACROM & IEEE-RAS - Amrita Club for Robotics and Mechatronics & IEEE-Robotics and Automation Society": [("Dr. Pandiri Durga Nagendra Kiran", "S-AI")],
    "Agentblazer Club": [("Ms. Shijina Padmanabhan K.", "CIR")],
    "AMAL - Amrita Management and Leadership Club": [("Mr. Ankit Jain", "CIR")],
    "ATLAS": [("Dr. Vineetha Jain", "SOC")],
    "Code Chef": [("Dr. Vishwas H. N.", "SOC")],
    "CSI - Computer Society of India": [("Mr. Saddala Rajeswara Reddy", "SOC")],
    "ECCF - Electronics, Computers and Communication Forum": [("Ms. Priya B. K.", "ECE")],
    "FACE - Forum for Aspiring Computer Engineers": [("Ms. Divya K. V.", "SOC"), ("Dr. Manju Khanna", "SOC")],
    "FORGE - Forum for Game Engineering": [("Dr. Shinu M. R.", "SOC")],
    "GDG (Google Developer Group)": [("Dr. Reena Panwar", "SOC")],
    "IEEE AESS - Aerospace And Electronic System Society": [("Dr. Sushant Shendre", "ECE"), ("Dr. C. Paramasivam", "ECE")],
    "IEEE Circuits and Systems": [("Dr. Sushant Shendre", "ECE"), ("Dr. C. Paramasivam", "ECE")],
    "IEEE Computer Society": [("Dr. Sreebha Bhaskaran", "SOC")],
    "IEEE - Computational Intelligence Society Chapter": [("Dr. Nidhin Prabhakar T. V.", "SOC")],
    "IEEE ComSoc (IEEE - Communication Society)": [("Dr. Ashish Goswami", "ECE"), ("Dr. Surekha Paneerselvam", "EEE")],
    "IEEE Innovation Club": [("Dr. Ashish Goswami", "ECE"), ("Dr. Surekha Paneerselvam", "EEE")],
    "IEEE PELS (IEEE - Power Electronics Society)": [("Ms. Sailaja V.", "EEE")],
    "IEEE PES (Power & Energy Society) and IAS (Industry Applications Society) Joint Student Branch Chapter": [("Dr. Deepa K.", "EEE"), ("Dr. Jitendra Bahadur", "ECE")],
    "IEEE Sensors Council": [],
    "IEEE SIGHT (IEEE - Special Group on Humanitarian Technology)": [("Ms. Kaveri Hatti", "ECE")],
    "IEEE Signal Processing": [("Dr. Sushma B.", "ECE")],
    "IEEE Student Branch": [("Dr. Sreeja Kochuvila", "ECE"), ("Dr. Navin Kumar", "ECE")],
    "IEEE System Council": [("Dr. Harshit Srivastava", "ECE")],
    "IEEE VTS (IEEE Vehicular Technology Society)": [("Dr. Anusaya Swain", "ECE")],
    "IEEE WIE (IEEE - Women in Engineering)": [("Dr. Puja Sengupta", "ME")],
    "Ingenium - The Mechanical Department Forum": [("Dr. Ulhas K. Annigeri", "ME"), ("Dr. Bikram Singh Solanki", "ME"), ("Dr. Prashanth B. N.", "ME")],
    "JIDO - The Industrial Automation Club": [("Dr. Niranjan D. K.", "SOC"), ("Dr. Peeta Basa Pati", "SOC")],
    "Microsoft Ignite Students Club (MISC)": [("Dr. Niranjan D. K.", "SOC"), ("Dr. Peeta Basa Pati", "SOC")],
    "National Students Data Corp (NSDC)": [("Dr. Niranjan D. K.", "SOC"), ("Dr. Peeta Basa Pati", "SOC")],
    "NEURON - The AI Club": [("Dr. Manju Venugopalan", "SOC")],
    "SAE - Society of Automotive Engineers": [("Dr. Vinod Kotebhavi", "ME"), ("Dr. J. Ramprabhakar", "EEE")],
    "SANKHYA - The Mathematics Club": [("Ms. Nimmy P.", "Mathematics"), ("Dr. Kesavulu Naidu", "Mathematics")],
    "The Robotics Society (TRS) - Student Chapter": [("Dr. Prashanth B. N.", "ME"), ("Dr. Vivek Venugopal", "ECE")],
    "Vidyuth - The Electrical Department Forum": [("Dr. Manitha P. V.", "EEE")],
    "VYOM - The Astro Physics Club": [("Mr. Manjunatha H.", "Physics")],
    "Abhinaya - The Drama Club": [("Ms. Karishma Nair N.", "CIR")],
    "Chethana - The Sports Club": [("Mr. K. Ramakrishnan", "Physical Education")],
    "Dharohar - The Heritage Club": [("Dr. Tanashree Redij", "Amritadarshanam")],
    "Dhwani - The Literary Club": [("Ms. Sanjana K. Chandran", "English")],
    "EPIC - The Movie Club": [("Ms. Priji Mol V. B.", "Mathematics")],
    "Kala - The Fine Arts Club": [("Dr. Reena Panwar", "CSE"), ("Ms. Nimmy P.", "Mathematics")],
    "Lekhani - The Press Club": [("Dr. Revathy Hemachandran", "English")],
    "Narthana - The Dance Club": [("Dr. Shashikumar M. E.", "ME")],
    "Prakriti - The Environmental Club": [("Dr. Saurabh Sharma", "Amritadarshanam")],
    "Prerana - The Social Outreach Club": [("Dr. Priyanka Vivek", "CSE")],
    "Quiz Club": [("Dr. K. Sireesha", "EEE")],
    "Raaga - The Music Club": [("Dr. Sivakumar B.", "Chemistry"), ("Ms. Srinithi N.", "CIR")],
    "Samatva - The Yoga Club": [("Mr. Pavan Kumar", "Amritadarshanam"), ("Mr. Raghavendra Ravi Kiran", "ME")],
    "Smriti - The Photography and Design Club": [("Mr. Sagar B.", "ECE")],
    "Squad - Patriotism and Adventure Club": [("Dr. Shashikumar M. E.", "ME"), ("Dr. Revathy Hemachandran", "English")],
    "TAB (Toast Masters Amrita Bengaluru)": [("Ms. Hima Bindu Chilla", "ACIP")],
    "Vedavani - The Vedanta and Sanskrit Club": [("Mr. Vinay H. A.", "Amritadarshanam")],
}


def normalized_person_name(value):
    return re.sub(r"[^a-z0-9]", "", str(value or "").casefold())


def sync_mentor_accounts(database, profile):
    if profile.get("role") != "faculty_coordinator":
        return
    normalized_name = normalized_person_name(profile.get("name"))
    if not normalized_name:
        return
    clubs = database["clubs"]
    for club in clubs.find({"mentorDirectory.name": {"$exists": True}}):
        has_match = any(
            normalized_person_name(mentor.get("name")) == normalized_name
            for mentor in club.get("mentorDirectory", [])
        )
        if has_match:
            clubs.update_one(
                {"_id": club["_id"]},
                {"$addToSet": {"mentorIds": profile["_id"]}},
            )


def ensure_campus_directory(database):
    timestamp = datetime.now(timezone.utc)
    venues = database["venues"]
    for name in VENUES:
        existing = venues.find_one({"name": {"$regex": f"^{name}$", "$options": "i"}})
        if existing and existing["name"] != name and not venues.find_one({"name": name, "_id": {"$ne": existing["_id"]}}):
            venues.update_one({"_id": existing["_id"]}, {"$set": {"name": name, "updatedAt": timestamp}})
        venues.update_one(
            {"name": name},
            {"$setOnInsert": {
                "name": name,
                "location": "Amrita Bengaluru Campus",
                "capacity": None,
                "isAvailable": True,
                "createdAt": timestamp,
                "updatedAt": timestamp,
            }},
            upsert=True,
        )

    clubs = database["clubs"]
    for old_name, new_name in CLUB_RENAMES.items():
        existing = clubs.find_one({"name": {"$regex": f"^{old_name}$", "$options": "i"}})
        if existing and not clubs.find_one({"name": new_name, "_id": {"$ne": existing["_id"]}}):
            clubs.update_one({"_id": existing["_id"]}, {"$set": {"name": new_name, "updatedAt": timestamp}})

    for name in CLUBS:
        clubs.update_one(
            {"name": name},
            {"$set": {"organizationType": "club"},
             "$setOnInsert": {
                "name": name,
                "description": f"Student community: {name}.",
                "category": "Campus club",
                "clubType": "non_technical",
                "domains": ["General"],
                "mentor": None,
                "recruitmentOpen": False,
                "createdAt": timestamp,
                "updatedAt": timestamp,
            }},
            upsert=True,
        )

    for name, mentors in CLUB_MENTORS.items():
        club = clubs.find_one({"name": name}, {"_id": 1})
        if club:
            clubs.update_one(
                {"_id": club["_id"]},
                {"$set": {"mentorDirectory": [{"name": person, "affiliation": department} for person, department in mentors]}},
            )
    for account in database["profiles"].find({"role": "faculty_coordinator"}, {"name": 1}):
        sync_mentor_accounts(database, account)


    for name in EVENT_ORGANIZERS:
        clubs.update_one(
            {"name": name},
            {"$set": {
                "organizationType": "event_organizer",
                "category": "Campus event organizer",
                "recruitmentOpen": False,
            },
             "$setOnInsert": {
                "name": name,
                "description": f"Student Affairs-managed campus event organizer: {name}.",
                "clubType": "non_technical",
                "domains": [],
                "mentor": None,
                "createdAt": timestamp,
                "updatedAt": timestamp,
            }},
            upsert=True,
        )
