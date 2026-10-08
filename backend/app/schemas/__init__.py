from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class MongoDocument(BaseModel):
    model_config = ConfigDict(extra="allow", populate_by_name=True, arbitrary_types_allowed=True)
    id: str | None = Field(default=None, alias="_id")


class ProfileDocument(MongoDocument):
    supabaseId: str
    name: str
    email: str
    role: str = "student"
    adminType: str | None = None
    department: str = ""
    joiningYear: int | None = None


class ClubDocument(MongoDocument):
    name: str
    description: str
    category: str = "Community"
    clubType: str = "non_technical"
    mentor: Any = None
    recruitmentOpen: bool = False


class EventDocument(MongoDocument):
    title: str
    eventDate: datetime
    clubId: Any
    status: str = "mentor_pending"
    capacity: int = 100


class ApiMessage(BaseModel):
    message: str
