"""Local embeddings via sentence-transformers.

No network call at inference time and no API key — the model weights are
downloaded once from Hugging Face and cached under ~/.cache/huggingface.

Both supported models output 1024 dimensions, which is what
EMBEDDING_DIMENSIONS and the kb_chunks.embedding column are set to. That is
checked at load time rather than trusted, because a mismatch would otherwise
surface as a confusing insert error much later.
"""

from __future__ import annotations

from functools import lru_cache
from typing import TYPE_CHECKING

from app.core.config import settings
from app.domains.knowledge_base.models import EMBEDDING_DIMENSIONS

if TYPE_CHECKING:
    from sentence_transformers import SentenceTransformer

# Models that need an asymmetric prefix. E5 was trained with "query: " and
# "passage: " markers and loses a noticeable amount of retrieval quality
# without them; bge-m3 was trained without any, so adding one would hurt.
E5_QUERY_PREFIX = "query: "
E5_PASSAGE_PREFIX = "passage: "


def _needs_e5_prefix(model_name: str) -> bool:
    return "e5" in model_name.lower()


@lru_cache(maxsize=1)
def get_model() -> SentenceTransformer:
    """Load the model once per process.

    First call downloads roughly 2.2 GB. Import is local to the function so
    that importing this module stays cheap for anything that never embeds.
    """
    from sentence_transformers import SentenceTransformer

    model = SentenceTransformer(settings.embedding_model, device=settings.embedding_device)

    actual = model.get_embedding_dimension()
    if actual != EMBEDDING_DIMENSIONS:
        raise RuntimeError(
            f"{settings.embedding_model} produces {actual}-dimension vectors, but "
            f"kb_chunks.embedding is {EMBEDDING_DIMENSIONS}. Either pick a "
            f"1024-dimension model or change EMBEDDING_DIMENSIONS and write a "
            f"migration that rewrites the column and rebuilds the index."
        )
    return model


def model_description() -> str:
    model = get_model()
    return (
        f"{settings.embedding_model} "
        f"({model.get_embedding_dimension()}d, device={model.device})"
    )


def embed_passages(texts: list[str], batch_size: int = 8) -> list[list[float]]:
    """Embed document chunks for storage."""
    if not texts:
        return []
    model = get_model()
    prepared = (
        [f"{E5_PASSAGE_PREFIX}{text}" for text in texts]
        if _needs_e5_prefix(settings.embedding_model)
        else texts
    )
    # normalize_embeddings=True is what makes cosine distance meaningful and
    # must match what embed_query does, or every similarity is wrong.
    vectors = model.encode(
        prepared,
        batch_size=batch_size,
        normalize_embeddings=True,
        show_progress_bar=False,
        convert_to_numpy=True,
    )
    return [vector.tolist() for vector in vectors]


def embed_query(text: str) -> list[float]:
    """Embed a search question. Same normalisation as embed_passages."""
    model = get_model()
    prepared = (
        f"{E5_QUERY_PREFIX}{text}"
        if _needs_e5_prefix(settings.embedding_model)
        else text
    )
    vector = model.encode(
        prepared,
        normalize_embeddings=True,
        show_progress_bar=False,
        convert_to_numpy=True,
    )
    return vector.tolist()
