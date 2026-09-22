from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class NotificationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    title: str
    body: str | None = None
    link: str | None = None
    is_read: bool
    created_at: datetime


class UnreadCount(BaseModel):
    count: int
