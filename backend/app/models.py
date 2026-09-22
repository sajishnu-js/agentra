"""Single import site for every ORM model.

Alembic's autogenerate only sees models that have been imported, so this
module exists to pull all of them onto Base.metadata.
"""

from app.domains.agents.models import Agent
from app.domains.audit.models import AuditLog
from app.domains.auth.models import Session
from app.domains.contacts.models import Contact, ContactNote
from app.domains.conversations.models import Conversation, Message
from app.domains.inboxes.models import Inbox
from app.domains.knowledge_base.models import (
    KBChunk,
    KBDocument,
    KBTable,
    KBTableRow,
    KnowledgeBase,
)
from app.domains.notifications.models import Notification
from app.domains.requests.models import Request
from app.domains.settings.models import WorkspaceSettings
from app.domains.users.models import User
from app.domains.workflows.models import (
    Workflow,
    WorkflowExecution,
    WorkflowExecutionStep,
    WorkflowVersion,
)

__all__ = [
    "Agent",
    "AuditLog",
    "Contact",
    "ContactNote",
    "Conversation",
    "Inbox",
    "KBChunk",
    "KBDocument",
    "KBTable",
    "KBTableRow",
    "KnowledgeBase",
    "Message",
    "Notification",
    "Request",
    "Session",
    "User",
    "Workflow",
    "WorkflowExecution",
    "WorkflowExecutionStep",
    "WorkflowVersion",
    "WorkspaceSettings",
]
