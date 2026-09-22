from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_serializer

from app.domains.contacts.masking import mask_phone_number
from app.domains.contacts.models import Channel


class ContactRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    phone_number: str | None = None

    @field_serializer("phone_number")
    def _mask_phone(self, value: str | None) -> str | None:
        """Masked on the way out — see contacts/masking.py. The raw number
        stays in the database for operational use; it never reaches a client."""
        return mask_phone_number(value)
    channel: Channel
    language: str | None = None
    created_at: datetime


class ContactNoteAuthor(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str


class ContactNoteCreate(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


class ContactNoteRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    contact_id: UUID
    # None when the author's account has since been deleted (author_user_id
    # is ON DELETE SET NULL) — the note itself outlives the account.
    author: ContactNoteAuthor | None = None
    text: str
    created_at: datetime
