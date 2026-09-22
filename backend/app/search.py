"""Retrieval test: embed a question, print the closest knowledge base chunks.

    python -m app.search "How much is laser hair removal?"
    python -m app.search "هل تقبلون تأمين دامان؟"
    python -m app.search "parking" --limit 10 --full

Read-only, and there is no LLM anywhere in it. The point is to judge retrieval
quality by eye before anything generates an answer from these chunks.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import textwrap
from uuid import UUID

# Registers every ORM model, so SQLAlchemy can configure the whole mapper
# graph. Only knowledge_base is touched here today, but the moment any
# domain gains a cross-domain relationship this becomes load-bearing, and
# the failure it prevents reads like an unrelated bug.
import app.models  # noqa: F401
from app.core.database import SessionLocal, engine
from app.domains.knowledge_base.embedding import model_description
from app.domains.knowledge_base.retrieval import search, searchable_chunk_count

SNIPPET_WORDS = 60


def snippet(text: str, full: bool) -> str:
    body = text if full else " ".join(text.split()[:SNIPPET_WORDS])
    if not full and len(text.split()) > SNIPPET_WORDS:
        body += " …"
    return textwrap.indent(textwrap.fill(body, width=88), "     ")


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("question", help="the question to search for")
    parser.add_argument(
        "--limit", type=int, default=5, help="how many chunks to return (default 5)"
    )
    parser.add_argument(
        "--full", action="store_true", help="print whole chunks instead of a snippet"
    )
    parser.add_argument(
        "--kb",
        type=UUID,
        default=None,
        help="restrict search to one knowledge base id (default: search all)",
    )
    args = parser.parse_args()

    async with SessionLocal() as session:
        total = await searchable_chunk_count(session)
        if total == 0:
            print(
                "No embedded chunks in the database. Run:\n"
                '  python -m app.ingest <folder> --reset',
                file=sys.stderr,
            )
            return 1

        print(f"Model     {model_description()}")
        print(f"Searching {total:,} embedded chunks")
        print(f"Question  {args.question}")
        print()

        hits = await search(
            session, args.question, limit=args.limit, knowledge_base_id=args.kb
        )

    if not hits:
        print("No results.")
        await engine.dispose()
        return 0

    for hit in hits:
        # Similarity, not distance: 1.0 is identical, 0.0 is unrelated.
        print(
            f" {hit.rank}. {hit.similarity:.3f}  "
            f"{hit.document_title}  "
            f"[{hit.document_source_type}, {hit.document_language or 'unknown'}, "
            f"chunk {hit.chunk_index}]"
        )
        print(snippet(hit.content, args.full))
        print()

    await engine.dispose()
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
