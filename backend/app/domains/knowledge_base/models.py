"""Source documents and their embedded chunks."""

import enum
from datetime import datetime
from uuid import UUID

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base, CreatedAtMixin, UUIDMixin

# Width of the embedding vectors, fixed at the model that produces them.
#
# Deliberately a constant here rather than an environment variable: the number
# is baked into the column type, so it cannot differ between machines without
# the schema differing too. Changing it means editing this line and generating
# a migration that rewrites the column and rebuilds the index.
EMBEDDING_DIMENSIONS = 1024


class SourceType(str, enum.Enum):
    pdf = "pdf"
    docx = "docx"


class KnowledgeBase(Base, UUIDMixin, CreatedAtMixin):
    """A named collection of documents and tables — the unit an agent is
    scoped to. "General Knowledge Base" today, but a business with several
    brands or locations can have more than one."""

    __tablename__ = "knowledge_bases"

    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    icon: Mapped[str] = mapped_column(String(40), default="BookOpen", nullable=False)


class KBDocument(Base, UUIDMixin):
    """A file someone uploaded — business policy, price list, product FAQ."""

    __tablename__ = "kb_documents"

    knowledge_base_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("knowledge_bases.id"),
        nullable=False,
        index=True,
    )
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    source_type: Mapped[SourceType] = mapped_column(
        Enum(SourceType, name="source_type", native_enum=False, create_constraint=True, validate_strings=True),
        nullable=False,
    )
    language: Mapped[str | None] = mapped_column(String(8))
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Absolute path the file was ingested from. Unique, so re-running the
    # ingest CLI over the same folder updates rows instead of duplicating
    # them. Nullable because seeded documents have no file behind them.
    source_path: Mapped[str | None] = mapped_column(Text)

    # SHA-256 of the file bytes. Lets re-ingestion skip a document whose
    # content has not changed — the difference between re-embedding everything
    # and re-embedding only what moved.
    content_hash: Mapped[str | None] = mapped_column(String(64))

    chunks: Mapped[list["KBChunk"]] = relationship(
        back_populates="document",
        cascade="all, delete-orphan",
        order_by="KBChunk.chunk_index",
        lazy="raise",
    )

    __table_args__ = (
        UniqueConstraint("source_path", name="uq_kb_documents_source_path"),
    )


class KBChunk(Base, UUIDMixin, CreatedAtMixin):
    """A retrievable slice of a document, plus its embedding."""

    __tablename__ = "kb_chunks"

    kb_document_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("kb_documents.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)

    # NULL between the chunk being written and the embedding job finishing.
    embedding: Mapped[list[float] | None] = mapped_column(Vector(EMBEDDING_DIMENSIONS))

    # Position within the document, 0-based, so chunks can be re-assembled in
    # order and neighbours fetched around a hit.
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)

    document: Mapped[KBDocument] = relationship(back_populates="chunks", lazy="raise")

    __table_args__ = (
        UniqueConstraint("kb_document_id", "chunk_index", name="uq_kb_chunks_document_index"),
        # HNSW rather than IVFFlat: it needs no training rows, so it works on a
        # table that starts empty, and gives better recall per unit of latency.
        # vector_cosine_ops matches the `<=>` cosine-distance operator, which is
        # what retrieval should use for normalised embeddings.
        Index(
            "ix_kb_chunks_embedding_cosine",
            "embedding",
            postgresql_using="hnsw",
            postgresql_ops={"embedding": "vector_cosine_ops"},
            postgresql_with={"m": 16, "ef_construction": 64},
        ),
    )


class KBTable(Base, UUIDMixin, CreatedAtMixin):
    """A structured knowledge category, shown as a spreadsheet.

    One generic table rather than bespoke Doctors / Treatments / FAQs /
    Insurance tables. The categories are editable content, not code: staff will
    add "Packages" or "Locations" without wanting a migration each time, and
    every one of them renders through the same grid.

    The tradeoff is real — no per-column types or constraints, and no FK from a
    row to anything else. When a category needs to be queried or joined rather
    than just displayed, it has earned its own table.
    """

    __tablename__ = "kb_tables"

    knowledge_base_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("knowledge_bases.id"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    slug: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text)

    # Ordered column definitions: [{"key": "name", "label": "Doctor"}, ...].
    # Drives header order in the UI, which a bare dict of row data cannot.
    columns: Mapped[list[dict]] = mapped_column(JSONB, nullable=False, default=list)

    rows: Mapped[list["KBTableRow"]] = relationship(
        back_populates="table",
        cascade="all, delete-orphan",
        order_by="KBTableRow.position",
        lazy="raise",
    )

    __table_args__ = (
        # Different knowledge bases can each have a table named "faqs" — the
        # slug only needs to be unique within its own knowledge base.
        UniqueConstraint("knowledge_base_id", "slug", name="uq_kb_tables_kb_id_slug"),
    )


class KBTableRow(Base, UUIDMixin, CreatedAtMixin):
    """One row of a structured category."""

    __tablename__ = "kb_table_rows"

    kb_table_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("kb_tables.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # Keys correspond to KBTable.columns[].key.
    data: Mapped[dict] = mapped_column(JSONB, nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    table: Mapped[KBTable] = relationship(back_populates="rows", lazy="raise")
