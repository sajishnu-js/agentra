import re
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.storage import UploadTooLarge, delete_upload, public_url, save_upload
from app.domains.agents.models import Agent
from app.domains.audit.service import record_audit
from app.domains.auth.dependencies import require_permission
from app.domains.knowledge_base.chunking import CHUNK_OVERLAP_WORDS, CHUNK_WORDS, chunk_text
from app.domains.knowledge_base.ingest import Outcome, ingest_file, replace_chunks
from app.domains.knowledge_base.models import (
    KBChunk,
    KBDocument,
    KBTable,
    KBTableRow,
    KnowledgeBase,
)
from app.domains.knowledge_base.parsing import is_supported, parse_file, title_from_path
from app.domains.knowledge_base.schemas import (
    KBChunkRead,
    KBColumnCreate,
    KBColumnUpdate,
    KBDocumentRead,
    KBDocumentUpdate,
    KBTableCreate,
    KBTableDetail,
    KBTableRowCreate,
    KBTableRowRead,
    KBTableRowUpdate,
    KBTableSummary,
    KBTableUpdate,
    KnowledgeBaseCreate,
    KnowledgeBaseRead,
)
from app.domains.users.models import User

router = APIRouter(prefix="/knowledge-base", tags=["knowledge_base"])


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-")
    return slug or "table"


async def _unique_table_slug(db: AsyncSession, knowledge_base_id: UUID, name: str) -> str:
    """`name`, slugified, de-duplicated within the knowledge base.

    Server-derived rather than client-supplied: staff naming a category types
    a plain label ("Approval Limits"), never an identifier — this is the only
    place that has to think about the difference.
    """
    base = _slugify(name)
    slug = base
    suffix = 2
    while await db.scalar(
        select(KBTable.id).where(
            KBTable.knowledge_base_id == knowledge_base_id, KBTable.slug == slug
        )
    ):
        slug = f"{base}-{suffix}"
        suffix += 1
    return slug


@router.post(
    "/collections",
    response_model=KnowledgeBaseRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_knowledge_base(
    payload: KnowledgeBaseCreate,
    admin: User = Depends(require_permission("manage_knowledge_base")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    knowledge_base = KnowledgeBase(
        name=payload.name, description=payload.description, icon=payload.icon
    )
    db.add(knowledge_base)
    await db.flush()
    await record_audit(
        db,
        actor=admin,
        action="create",
        entity_type="knowledge_base",
        entity_id=knowledge_base.id,
        summary=f"{admin.name} created knowledge base {knowledge_base.name}",
    )
    return {
        "id": knowledge_base.id,
        "name": knowledge_base.name,
        "description": knowledge_base.description,
        "icon": knowledge_base.icon,
        "created_at": knowledge_base.created_at,
        "document_count": 0,
        "table_count": 0,
        "agents": [],
    }


@router.get("/collections", response_model=list[KnowledgeBaseRead])
async def list_knowledge_bases(db: AsyncSession = Depends(get_db)) -> list[dict]:
    """Every knowledge base, with document/table counts and the agents using it."""
    document_count = (
        select(func.count(KBDocument.id))
        .where(KBDocument.knowledge_base_id == KnowledgeBase.id)
        .scalar_subquery()
    )
    table_count = (
        select(func.count(KBTable.id))
        .where(KBTable.knowledge_base_id == KnowledgeBase.id)
        .scalar_subquery()
    )
    result = await db.execute(
        select(
            KnowledgeBase,
            document_count.label("document_count"),
            table_count.label("table_count"),
        ).order_by(KnowledgeBase.created_at)
    )
    rows = result.all()
    if not rows:
        return []

    agents_result = await db.execute(
        select(Agent.id, Agent.name, Agent.knowledge_base_id).where(
            Agent.knowledge_base_id.isnot(None)
        )
    )
    agents_by_kb: dict[UUID, list[dict]] = {}
    for agent_id, agent_name, kb_id in agents_result.all():
        agents_by_kb.setdefault(kb_id, []).append({"id": agent_id, "name": agent_name})

    return [
        {
            "id": kb.id,
            "name": kb.name,
            "description": kb.description,
            "icon": kb.icon,
            "created_at": kb.created_at,
            "document_count": doc_count,
            "table_count": tbl_count,
            "agents": agents_by_kb.get(kb.id, []),
        }
        for kb, doc_count, tbl_count in rows
    ]


@router.delete("/collections/{knowledge_base_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_knowledge_base(
    knowledge_base_id: UUID,
    admin: User = Depends(require_permission("manage_knowledge_base")),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete a knowledge base and everything in it.

    KnowledgeBase itself has no ON DELETE CASCADE from its documents/tables
    (unlike KBChunk<-KBDocument and KBTableRow<-KBTable, which do), so those
    have to go first or the foreign key blocks this delete outright. Bulk
    DELETEs, not a loop of session.delete() — the DB-level cascades on the
    child tables handle chunks/rows either way, and this avoids loading
    potentially thousands of chunk rows into memory just to remove them.

    Refuses to run while any agent still points at this knowledge base
    (checked explicitly for a clean 400, rather than surfacing the
    database's own foreign key violation) — deleting out from under a live
    agent is exactly the kind of surprise this guards against.
    """
    knowledge_base = await db.get(KnowledgeBase, knowledge_base_id)
    if knowledge_base is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Knowledge base not found"
        )

    in_use_by = await db.scalar(
        select(Agent.name).where(Agent.knowledge_base_id == knowledge_base_id).limit(1)
    )
    if in_use_by is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"This knowledge base is still assigned to {in_use_by}. Reassign or clear that agent's knowledge base first.",
        )

    await db.execute(delete(KBDocument).where(KBDocument.knowledge_base_id == knowledge_base_id))
    await db.execute(delete(KBTable).where(KBTable.knowledge_base_id == knowledge_base_id))
    await record_audit(
        db,
        actor=admin,
        action="delete",
        entity_type="knowledge_base",
        entity_id=knowledge_base.id,
        summary=f"{admin.name} deleted knowledge base {knowledge_base.name}",
    )
    await db.delete(knowledge_base)
    await db.flush()


@router.get("/documents", response_model=list[KBDocumentRead])
async def list_documents(
    knowledge_base_id: UUID | None = None, db: AsyncSession = Depends(get_db)
) -> list[dict]:
    """Documents with their chunk counts.

    A correlated scalar subquery rather than a join plus GROUP BY, so
    documents with no chunks yet still come back with a count of 0.
    """
    chunk_count = (
        select(func.count(KBChunk.id))
        .where(KBChunk.kb_document_id == KBDocument.id)
        .scalar_subquery()
    )
    query = select(KBDocument, chunk_count.label("chunk_count")).order_by(
        KBDocument.uploaded_at.desc()
    )
    if knowledge_base_id is not None:
        query = query.where(KBDocument.knowledge_base_id == knowledge_base_id)
    result = await db.execute(query)
    return [
        {
            "id": document.id,
            "knowledge_base_id": document.knowledge_base_id,
            "title": document.title,
            "source_type": document.source_type,
            "language": document.language,
            "uploaded_at": document.uploaded_at,
            "chunk_count": count,
            "file_url": public_url(document.source_path),
        }
        for document, count in result.all()
    ]


@router.get("/documents/{document_id}/chunks", response_model=list[KBChunkRead])
async def list_chunks(
    document_id: UUID, db: AsyncSession = Depends(get_db)
) -> list[KBChunk]:
    result = await db.execute(
        select(KBChunk)
        .where(KBChunk.kb_document_id == document_id)
        .order_by(KBChunk.chunk_index)
    )
    return list(result.scalars())


def _document_read(document: KBDocument, chunk_count: int) -> dict:
    return {
        "id": document.id,
        "knowledge_base_id": document.knowledge_base_id,
        "title": document.title,
        "source_type": document.source_type,
        "language": document.language,
        "uploaded_at": document.uploaded_at,
        "chunk_count": chunk_count,
        "file_url": public_url(document.source_path),
    }


@router.post("/documents", response_model=KBDocumentRead, status_code=status.HTTP_201_CREATED)
async def upload_document(
    knowledge_base_id: UUID = Form(...),
    file: UploadFile = File(...),
    admin: User = Depends(require_permission("manage_knowledge_base")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Upload a .docx/.pdf, parse it, chunk it and embed it into one knowledge base."""
    knowledge_base = await db.get(KnowledgeBase, knowledge_base_id)
    if knowledge_base is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Knowledge base not found")

    filename = file.filename or ""
    if not is_supported(Path(filename)):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"{Path(filename).suffix or 'This file type'} is not supported — upload a .docx or .pdf.",
        )

    try:
        saved_path, _size = await save_upload(file, category="kb_documents")
    except UploadTooLarge as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc

    result = await ingest_file(db, saved_path, knowledge_base_id=knowledge_base_id, force=True)
    if result.outcome is not Outcome.ingested:
        delete_upload(saved_path)
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"Could not process {filename}: {result.detail}"
        )

    document = await db.scalar(
        select(KBDocument).where(KBDocument.source_path == str(saved_path))
    )
    if document is None:
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR, "Upload succeeded but the document row went missing"
        )

    # ingest_file derives its title from the on-disk path, which is a random
    # uuid4 (see save_upload) — re-derive from the name the user actually
    # typed, the only place that name is still available.
    document.title = title_from_path(Path(filename))
    await db.flush()

    await record_audit(
        db,
        actor=admin,
        action="create",
        entity_type="kb_document",
        entity_id=document.id,
        summary=f"{admin.name} uploaded {document.title} to {knowledge_base.name}",
    )
    return _document_read(document, result.chunk_count)


@router.patch("/documents/{document_id}", response_model=KBDocumentRead)
async def update_document(
    document_id: UUID,
    payload: KBDocumentUpdate,
    admin: User = Depends(require_permission("manage_knowledge_base")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Rename a document or correct its language — metadata only, no re-parse."""
    document = await db.get(KBDocument, document_id)
    if document is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")

    if payload.title is not None:
        document.title = payload.title
    if payload.language is not None:
        document.language = payload.language
    await db.flush()

    chunk_count = await db.scalar(
        select(func.count(KBChunk.id)).where(KBChunk.kb_document_id == document.id)
    )
    await record_audit(
        db,
        actor=admin,
        action="update",
        entity_type="kb_document",
        entity_id=document.id,
        summary=f"{admin.name} updated {document.title}",
    )
    return _document_read(document, chunk_count or 0)


@router.post("/documents/{document_id}/replace", response_model=KBDocumentRead)
async def replace_document(
    document_id: UUID,
    file: UploadFile = File(...),
    admin: User = Depends(require_permission("manage_knowledge_base")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Swap the file behind an existing document, re-extracting and
    re-embedding its content while keeping the same document id."""
    document = await db.get(KBDocument, document_id)
    if document is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")

    filename = file.filename or ""
    if not is_supported(Path(filename)):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"{Path(filename).suffix or 'This file type'} is not supported — upload a .docx or .pdf.",
        )

    try:
        new_path, _size = await save_upload(file, category="kb_documents")
    except UploadTooLarge as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc

    try:
        parsed = parse_file(new_path)
    except Exception as exc:  # noqa: BLE001 — reported to the caller, not fatal
        delete_upload(new_path)
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Could not read {filename}: {exc}") from exc

    if not parsed.text.strip():
        delete_upload(new_path)
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "No extractable text — a scanned PDF needs OCR, which this deployment does not support.",
        )

    chunks = chunk_text(parsed.text, size=CHUNK_WORDS, overlap=CHUNK_OVERLAP_WORDS)
    if not chunks:
        delete_upload(new_path)
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No words left after parsing.")

    old_path = document.source_path
    # Same on-disk-random-name caveat as upload_document: re-derive from the
    # name the user just typed, not parsed.title (which read the disk path).
    document.title = title_from_path(Path(filename))
    document.source_type = parsed.source_type
    document.language = parsed.language
    document.content_hash = parsed.content_hash
    document.source_path = str(new_path)
    chunk_count = await replace_chunks(db, document, [chunk.text for chunk in chunks])
    await db.flush()
    delete_upload(old_path)

    await record_audit(
        db,
        actor=admin,
        action="update",
        entity_type="kb_document",
        entity_id=document.id,
        summary=f"{admin.name} replaced the file behind {document.title}",
    )
    return _document_read(document, chunk_count)


@router.delete("/documents/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(
    document_id: UUID,
    admin: User = Depends(require_permission("manage_knowledge_base")),
    db: AsyncSession = Depends(get_db),
) -> None:
    document = await db.get(KBDocument, document_id)
    if document is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")

    source_path = document.source_path
    await record_audit(
        db,
        actor=admin,
        action="delete",
        entity_type="kb_document",
        entity_id=document.id,
        summary=f"{admin.name} deleted {document.title}",
    )
    await db.delete(document)  # cascades to chunks (ondelete=CASCADE)
    await db.flush()
    delete_upload(source_path)


@router.get("/tables", response_model=list[KBTableSummary])
async def list_tables(
    knowledge_base_id: UUID | None = None, db: AsyncSession = Depends(get_db)
) -> list[dict]:
    """The structured categories, with row counts but not the rows."""
    row_count = (
        select(func.count(KBTableRow.id))
        .where(KBTableRow.kb_table_id == KBTable.id)
        .scalar_subquery()
    )
    query = select(KBTable, row_count.label("row_count")).order_by(KBTable.name)
    if knowledge_base_id is not None:
        query = query.where(KBTable.knowledge_base_id == knowledge_base_id)
    result = await db.execute(query)
    return [
        {
            "id": table.id,
            "knowledge_base_id": table.knowledge_base_id,
            "name": table.name,
            "slug": table.slug,
            "description": table.description,
            "columns": table.columns,
            "row_count": count,
        }
        for table, count in result.all()
    ]


@router.post("/tables", response_model=KBTableDetail, status_code=status.HTTP_201_CREATED)
async def create_table(
    payload: KBTableCreate,
    admin: User = Depends(require_permission("manage_knowledge_base")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    knowledge_base = await db.get(KnowledgeBase, payload.knowledge_base_id)
    if knowledge_base is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Knowledge base not found")

    slug = await _unique_table_slug(db, payload.knowledge_base_id, payload.name)
    table = KBTable(
        knowledge_base_id=payload.knowledge_base_id,
        name=payload.name,
        slug=slug,
        description=payload.description,
        columns=[column.model_dump() for column in payload.columns],
    )
    db.add(table)
    await db.flush()
    await record_audit(
        db,
        actor=admin,
        action="create",
        entity_type="kb_table",
        entity_id=table.id,
        summary=f"{admin.name} created table {table.name} in {knowledge_base.name}",
    )
    return {
        "id": table.id,
        "knowledge_base_id": table.knowledge_base_id,
        "name": table.name,
        "slug": table.slug,
        "description": table.description,
        "columns": table.columns,
        "rows": [],
    }


@router.get("/tables/{table_id}", response_model=KBTableDetail)
async def read_table(table_id: UUID, db: AsyncSession = Depends(get_db)) -> KBTable:
    # By id, not slug: slugs are only unique *within* a knowledge base (see
    # the composite constraint on KBTable), so two different KBs can each
    # have a "faqs" table — a slug-only lookup would be ambiguous about
    # which one it means.
    result = await db.execute(
        select(KBTable).where(KBTable.id == table_id).options(selectinload(KBTable.rows))
    )
    table = result.scalar_one_or_none()
    if table is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"No table with id {table_id}"
        )
    return table


async def _get_table_or_404(db: AsyncSession, table_id: UUID, *, with_rows: bool = False) -> KBTable:
    query = select(KBTable).where(KBTable.id == table_id)
    if with_rows:
        query = query.options(selectinload(KBTable.rows))
    table = await db.scalar(query)
    if table is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"No table with id {table_id}")
    return table


def _table_detail(table: KBTable) -> dict:
    return {
        "id": table.id,
        "knowledge_base_id": table.knowledge_base_id,
        "name": table.name,
        "slug": table.slug,
        "description": table.description,
        "columns": table.columns,
        "rows": [
            {"id": row.id, "data": row.data, "position": row.position} for row in table.rows
        ],
    }


@router.patch("/tables/{table_id}", response_model=KBTableDetail)
async def update_table(
    table_id: UUID,
    payload: KBTableUpdate,
    admin: User = Depends(require_permission("manage_knowledge_base")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Rename or redescribe a table. The slug is immutable once created — it
    only exists to disambiguate tables within a knowledge base, and nothing
    outside this row depends on it, but changing it under an open UI tab
    would be a needless surprise for no benefit."""
    table = await _get_table_or_404(db, table_id, with_rows=True)
    if payload.name is not None:
        table.name = payload.name
    if payload.description is not None:
        table.description = payload.description
    await db.flush()
    await record_audit(
        db,
        actor=admin,
        action="update",
        entity_type="kb_table",
        entity_id=table.id,
        summary=f"{admin.name} updated table {table.name}",
    )
    return _table_detail(table)


@router.delete("/tables/{table_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_table(
    table_id: UUID,
    admin: User = Depends(require_permission("manage_knowledge_base")),
    db: AsyncSession = Depends(get_db),
) -> None:
    table = await _get_table_or_404(db, table_id)
    await record_audit(
        db,
        actor=admin,
        action="delete",
        entity_type="kb_table",
        entity_id=table.id,
        summary=f"{admin.name} deleted table {table.name}",
    )
    await db.delete(table)  # cascades to rows (ondelete=CASCADE)
    await db.flush()


@router.post("/tables/{table_id}/columns", response_model=KBTableDetail, status_code=status.HTTP_201_CREATED)
async def add_column(
    table_id: UUID,
    payload: KBColumnCreate,
    admin: User = Depends(require_permission("manage_knowledge_base")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    table = await _get_table_or_404(db, table_id, with_rows=True)
    if any(column["key"] == payload.key for column in table.columns):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"Column '{payload.key}' already exists on this table"
        )

    # Reassigned, not appended-to-in-place: `columns` is a plain JSONB list
    # with no SQLAlchemy mutation tracking, so an in-place .append() would
    # silently never reach the database.
    table.columns = [*table.columns, payload.model_dump()]
    for row in table.rows:
        row.data = {**row.data, payload.key: ""}
    await db.flush()
    await record_audit(
        db,
        actor=admin,
        action="update",
        entity_type="kb_table",
        entity_id=table.id,
        summary=f"{admin.name} added column '{payload.label}' to {table.name}",
    )
    return _table_detail(table)


@router.patch("/tables/{table_id}/columns/{key}", response_model=KBTableDetail)
async def update_column(
    table_id: UUID,
    key: str,
    payload: KBColumnUpdate,
    admin: User = Depends(require_permission("manage_knowledge_base")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Rename a column's display label. The key itself — what every row's
    `data` dict is keyed by — stays fixed; relabelling should never risk
    silently orphaning existing row data."""
    table = await _get_table_or_404(db, table_id, with_rows=True)
    if not any(column["key"] == key for column in table.columns):
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"No column '{key}' on this table")

    table.columns = [
        {**column, "label": payload.label} if column["key"] == key else column
        for column in table.columns
    ]
    await db.flush()
    await record_audit(
        db,
        actor=admin,
        action="update",
        entity_type="kb_table",
        entity_id=table.id,
        summary=f"{admin.name} renamed column '{key}' to '{payload.label}' on {table.name}",
    )
    return _table_detail(table)


@router.delete("/tables/{table_id}/columns/{key}", response_model=KBTableDetail)
async def delete_column(
    table_id: UUID,
    key: str,
    admin: User = Depends(require_permission("manage_knowledge_base")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    table = await _get_table_or_404(db, table_id, with_rows=True)
    if not any(column["key"] == key for column in table.columns):
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"No column '{key}' on this table")

    table.columns = [column for column in table.columns if column["key"] != key]
    for row in table.rows:
        if key in row.data:
            row.data = {k: v for k, v in row.data.items() if k != key}
    await db.flush()
    await record_audit(
        db,
        actor=admin,
        action="update",
        entity_type="kb_table",
        entity_id=table.id,
        summary=f"{admin.name} removed column '{key}' from {table.name}",
    )
    return _table_detail(table)


@router.post(
    "/tables/{table_id}/rows", response_model=KBTableRowRead, status_code=status.HTTP_201_CREATED
)
async def create_row(
    table_id: UUID,
    payload: KBTableRowCreate,
    admin: User = Depends(require_permission("manage_knowledge_base")),
    db: AsyncSession = Depends(get_db),
) -> KBTableRow:
    table = await _get_table_or_404(db, table_id, with_rows=True)
    valid_keys = {column["key"] for column in table.columns}
    unknown = set(payload.data) - valid_keys
    if unknown:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown column(s): {', '.join(sorted(unknown))}")

    # Every declared column gets a slot, even if the caller left it blank —
    # keeps every row's key set identical to `table.columns`, which is what
    # lets the frontend render a fixed grid of inputs with no per-row gaps.
    data = {key: payload.data.get(key, "") for key in valid_keys}
    row = KBTableRow(kb_table_id=table.id, data=data, position=len(table.rows))
    db.add(row)
    await db.flush()
    await record_audit(
        db,
        actor=admin,
        action="create",
        entity_type="kb_table_row",
        entity_id=row.id,
        summary=f"{admin.name} added a row to {table.name}",
    )
    return row


@router.patch("/tables/{table_id}/rows/{row_id}", response_model=KBTableRowRead)
async def update_row(
    table_id: UUID,
    row_id: UUID,
    payload: KBTableRowUpdate,
    admin: User = Depends(require_permission("manage_knowledge_base")),
    db: AsyncSession = Depends(get_db),
) -> KBTableRow:
    table = await _get_table_or_404(db, table_id, with_rows=True)
    row = next((r for r in table.rows if r.id == row_id), None)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Row not found on this table")

    valid_keys = {column["key"] for column in table.columns}
    unknown = set(payload.data) - valid_keys
    if unknown:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown column(s): {', '.join(sorted(unknown))}")

    row.data = {**row.data, **payload.data}
    await db.flush()
    await record_audit(
        db,
        actor=admin,
        action="update",
        entity_type="kb_table_row",
        entity_id=row.id,
        summary=f"{admin.name} edited a row in {table.name}",
    )
    return row


@router.delete("/tables/{table_id}/rows/{row_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_row(
    table_id: UUID,
    row_id: UUID,
    admin: User = Depends(require_permission("manage_knowledge_base")),
    db: AsyncSession = Depends(get_db),
) -> None:
    table = await _get_table_or_404(db, table_id, with_rows=True)
    row = next((r for r in table.rows if r.id == row_id), None)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Row not found on this table")

    await record_audit(
        db,
        actor=admin,
        action="delete",
        entity_type="kb_table_row",
        entity_id=row.id,
        summary=f"{admin.name} deleted a row from {table.name}",
    )
    await db.delete(row)
    await db.flush()
