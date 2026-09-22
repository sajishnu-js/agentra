"""Application settings, loaded from environment / .env."""

from functools import lru_cache

from pydantic import computed_field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    project_name: str = "Agentra"
    environment: str = "local"
    debug: bool = True
    api_prefix: str = "/api/v1"

    database_url: str = "postgresql+asyncpg://agentra:agentra@localhost:5433/agentra"
    # Separate from DEBUG: echoing every statement is useful when chasing a
    # query, and unreadable the rest of the time.
    db_echo: bool = False
    redis_url: str = "redis://localhost:6380/0"

    cors_origins: str = "http://localhost:5173"

    # Embeddings run locally through sentence-transformers. Both of the
    # supported models are 1024-dimension and multilingual (Arabic + English):
    #   BAAI/bge-m3                       — no prefix, 8192-token window
    #   intfloat/multilingual-e5-large    — needs query:/passage: prefixes
    # embedding.py handles the prefix difference.
    embedding_model: str = "BAAI/bge-m3"
    # None lets sentence-transformers choose — "mps" on Apple Silicon, else
    # "cpu". Override to pin it.
    embedding_device: str | None = None

    # --- Channels ---
    # From @BotFather. Never hardcoded; the adapter refuses to start without it.
    telegram_bot_token: str | None = None

    # WhatsApp Cloud API (Meta). A permanent system-user token and the phone
    # number id it sends from — both from the Meta developer console, under
    # the WhatsApp product on the business's app.
    whatsapp_access_token: str | None = None
    whatsapp_phone_number_id: str | None = None
    # Shared secret Meta echoes back in the GET verification handshake when
    # the webhook URL is registered — arbitrary, chosen by whoever configures
    # the app, not issued by Meta.
    whatsapp_verify_token: str | None = None
    # The Meta *app's* secret (not the access token above) — used to verify
    # the X-Hub-Signature-256 HMAC on every inbound POST, so a webhook URL
    # leaking publicly does not let anyone forge customer messages.
    whatsapp_app_secret: str | None = None

    # Instagram Messaging API (Meta) — same Graph API family as WhatsApp, but
    # scoped to the Instagram professional account's linked Page.
    instagram_access_token: str | None = None
    instagram_page_id: str | None = None
    instagram_verify_token: str | None = None
    instagram_app_secret: str | None = None

    # Outbound email via plain SMTP. Inbound arrives as a provider's inbound-
    # parse webhook (SendGrid/Postmark/Mailgun-shaped), not IMAP polling —
    # running a mail server or polling loop is a separate, much larger piece
    # of infrastructure than this app takes on.
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_from_address: str | None = None
    smtp_use_tls: bool = True
    # Shared secret the inbound-parse provider must send back (header or
    # query param — see app/webhooks/router.py) — email has no Meta-style
    # signed-payload convention, so this is the equivalent guard against
    # anyone who discovers the URL forging inbound "customer" messages.
    email_webhook_secret: str | None = None

    # --- LLM ---
    # "gemini" for the real thing, "echo" to exercise the pipeline with no API
    # key and no token spend.
    llm_provider: str = "gemini"
    gemini_api_key: str | None = None
    # Pinned deliberately rather than "gemini-flash-latest": a floating
    # alias can change the model under a business without warning.
    gemini_model: str = "gemini-3.6-flash"

    # --- Workspace ---
    # Used wherever "business local time" matters — opening hours, analytics
    # bucketing. UTC by default so a fresh deployment behaves sensibly with no
    # configuration; override per workspace.
    business_timezone: str = "UTC"

    # --- Handover ---
    # Lowest model-reported confidence still allowed to reach a customer:
    # "high" is strict (only fully grounded answers go out), "low" effectively
    # disables the self-assessment gate. Keyword rules are unaffected by this.
    # Tune once real customer messages show how often the model is right about
    # its own uncertainty.
    ai_min_confidence: str = "medium"

    # Turn off the hard keyword layer entirely. Only useful for measuring how
    # the model behaves without it — leave it on in normal operation.
    keyword_handover_enabled: bool = True

    # --- Request extraction ---
    # A second model call per turn, purely for classification. Turn it off to
    # halve model usage, at the cost of the Requests Hub not filling itself.
    request_extraction_enabled: bool = True
    # How many earlier messages to send as context. Enough to resolve "yes,
    # Thursday works"; few enough that a long thread does not dominate the
    # prompt or the token bill.
    extraction_history_messages: int = 8

    # --- Retrieval ---
    # How many knowledge base chunks to put in front of the model. Enough to
    # cover a question, few enough that the model is not invited to wander.
    retrieval_top_k: int = 5
    # Below this cosine similarity a chunk is treated as noise. bge-m3 scores
    # are compressed: on the current corpus a good match lands around
    # 0.44-0.55 and a nonsense question still scores 0.39, so this floor is a
    # loose safety net rather than a real filter. The grounding instruction in
    # the system prompt is what actually stops a wrong answer — it correctly
    # defers even when weak chunks get through. Tune this once there are real
    # customer questions to calibrate against.
    retrieval_min_similarity: float = 0.40

    # --- Queue ---
    rq_queue_name: str = "agentra"
    # Generous: a job embeds, retrieves, calls Gemini and sends a reply.
    rq_job_timeout: int = 180

    # This deployment's own public HTTPS origin — e.g. https://support.example.com,
    # no trailing slash. Needed to hand a channel a reachable URL rather than
    # a bare relative /uploads/... path when a customer-facing message has to
    # reference an uploaded file: Instagram's Send API requires attachments
    # be a public URL rather than an upload, and any channel's plain-text
    # fallback for an attachment ("here's the file: <url>") needs one too.
    public_base_url: str | None = None

    # --- File storage ---
    # Uploaded knowledge-base documents and message attachments, written to
    # disk under the backend package root regardless of the process's working
    # directory (see app/core/storage.py). Local disk, not object storage —
    # matches this app's self-hosted, single-node deployment model.
    upload_dir: str = "uploads"

    @field_validator("ai_min_confidence")
    @classmethod
    def _known_confidence(cls, value: str) -> str:
        allowed = {"low", "medium", "high"}
        lowered = value.strip().lower()
        if lowered not in allowed:
            raise ValueError(
                f"AI_MIN_CONFIDENCE must be one of {sorted(allowed)}, got {value!r}"
            )
        return lowered

    @field_validator(
        "embedding_device",
        "telegram_bot_token",
        "gemini_api_key",
        "whatsapp_access_token",
        "whatsapp_phone_number_id",
        "whatsapp_verify_token",
        "whatsapp_app_secret",
        "instagram_access_token",
        "instagram_page_id",
        "instagram_verify_token",
        "instagram_app_secret",
        "smtp_host",
        "smtp_username",
        "smtp_password",
        "smtp_from_address",
        "email_webhook_secret",
        "public_base_url",
        mode="before",
    )
    @classmethod
    def _blank_is_none(cls, value: object) -> object:
        """Treat a blank value in .env as unset rather than as "".

        Without this, `EMBEDDING_DEVICE=` parses as the empty string and is
        handed to SentenceTransformer as device="", and an empty
        TELEGRAM_BOT_TOKEN looks configured to every `if token:` check.
        """
        if isinstance(value, str) and value.strip() == "":
            return None
        return value

    @computed_field
    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
