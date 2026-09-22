from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.domains.knowledge_base.models import SourceType


class KnowledgeBaseCreate(BaseModel):
    name: str
    description: str | None = None
    icon: str = "BookOpen"


class KnowledgeBaseAgentRef(BaseModel):
    """The bare minimum of an agent, for the "used by" list on a KB."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str


class KnowledgeBaseRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    description: str | None = None
    icon: str
    created_at: datetime
    document_count: int
    table_count: int
    agents: list[KnowledgeBaseAgentRef]


class KBDocumentRead(BaseModel):
    """A document plus how many chunks it produced."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    knowledge_base_id: UUID
    title: str
    source_type: SourceType
    language: str | None = None
    uploaded_at: datetime
    chunk_count: int
    # None for documents ingested from outside the uploads/ tree (the seeded
    # demo corpus, or anything loaded via the CLI folder-ingest tool) — there
    # is genuinely no file to serve for those, only a real upload has one.
    file_url: str | None = None


class KBDocumentUpdate(BaseModel):
    """Metadata-only edits — renaming or recategorising a document without
    touching its extracted content. Replacing the file itself is a separate
    endpoint, since it re-runs extraction rather than patching a row."""

    title: str | None = Field(default=None, min_length=1, max_length=300)
    language: str | None = None


class KBChunkRead(BaseModel):
    """Chunk metadata without the embedding — 1024 floats are not useful in an
    API response, and leaving them out keeps payloads small."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    kb_document_id: UUID
    content: str
    chunk_index: int
    created_at: datetime


class KBColumn(BaseModel):
    key: str
    label: str


class KBTableSummary(BaseModel):
    """A structured category, without its rows."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    knowledge_base_id: UUID
    name: str
    slug: str
    description: str | None = None
    columns: list[KBColumn]
    row_count: int


class KBTableRowRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    data: dict[str, str]
    position: int


class KBTableDetail(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    knowledge_base_id: UUID
    name: str
    slug: str
    description: str | None = None
    columns: list[KBColumn]
    rows: list[KBTableRowRead]


class KBTableCreate(BaseModel):
    knowledge_base_id: UUID
    name: str = Field(min_length=1, max_length=120)
    description: str | None = None
    # Starter columns, optional — a table can also be created empty and have
    # columns added afterward. The slug is always server-derived from `name`
    # (see _unique_slug in router.py), never client-supplied: staff naming a
    # category should never have to think about identifier formatting.
    columns: list[KBColumn] = []


class KBTableUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = None


class KBColumnCreate(BaseModel):
    key: str = Field(min_length=1, max_length=60, pattern=r"^[a-z][a-z0-9_]*$")
    label: str = Field(min_length=1, max_length=120)


class KBColumnUpdate(BaseModel):
    label: str = Field(min_length=1, max_length=120)


class KBTableRowCreate(BaseModel):
    data: dict[str, str] = {}


class KBTableRowUpdate(BaseModel):
    data: dict[str, str]
