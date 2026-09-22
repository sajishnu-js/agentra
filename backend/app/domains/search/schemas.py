from uuid import UUID

from pydantic import BaseModel


class SearchResult(BaseModel):
    type: str  # "conversation" | "agent" | "knowledge_base" | "request"
    id: UUID
    title: str
    subtitle: str
    link: str
