"""The closed set of node types the builder offers and the engine can run.

Single source of truth for both sides: the frontend fetches this via
GET /workflows/catalog to build its node palette and property panels, and
the engine dispatches on the same keys. Adding a node type means adding it
here and giving it a branch in engine.py — nowhere else.
"""

from typing import Any

#: What kind of event starts a run. Each key is wired to a real call site in
#: the application (see engine.fire) — none of these are placeholders.
TRIGGERS: dict[str, dict[str, Any]] = {
    "message_received": {
        "label": "Message received",
        "description": "A customer sends a message on any connected channel.",
        "fields": [
            {"key": "channel", "label": "Channel", "type": "select",
             "options": ["any", "whatsapp", "telegram", "instagram", "email"], "default": "any"},
        ],
    },
    "conversation_created": {
        "label": "Conversation started",
        "description": "A new thread is opened with a contact.",
        "fields": [],
    },
    "handover_raised": {
        "label": "Handover raised",
        "description": "The AI hands a conversation to a person.",
        "fields": [],
    },
    "request_created": {
        "label": "Request created",
        "description": "A request is extracted into the Requests Hub.",
        "fields": [
            {"key": "category", "label": "Category", "type": "select",
             "options": ["any", "human_request", "callback", "order", "reschedule",
                         "cancellation", "billing", "complaint", "other"], "default": "any"},
        ],
    },
    "request_status_changed": {
        "label": "Request status changed",
        "description": "A request is completed or cancelled.",
        "fields": [
            {"key": "to_status", "label": "New status", "type": "select",
             "options": ["any", "pending", "completed", "cancelled"], "default": "any"},
        ],
    },
    "tag_added": {
        "label": "Tag added",
        "description": "A tag is applied to a conversation.",
        "fields": [{"key": "tag", "label": "Tag", "type": "text", "default": ""}],
    },
    "schedule": {
        "label": "On a schedule",
        "description": "Runs every N minutes, with no conversation attached.",
        "fields": [
            {"key": "interval_minutes", "label": "Every (minutes)", "type": "number", "default": 60},
        ],
    },
    "webhook": {
        "label": "Incoming webhook",
        "description": "An external system calls this workflow's own URL.",
        "fields": [],
    },
    "manual": {
        "label": "Manual / test run",
        "description": "Started by hand from the builder.",
        "fields": [],
    },
}

#: Fields available to condition nodes. `source` is the dotted path the
#: engine resolves against a run's context (see engine.resolve_path).
CONDITION_FIELDS: list[dict[str, Any]] = [
    {"key": "message.text", "label": "Message text", "type": "text"},
    {"key": "contact.name", "label": "Contact name", "type": "text"},
    {"key": "contact.channel", "label": "Channel", "type": "select",
     "options": ["whatsapp", "telegram", "instagram", "email"]},
    {"key": "contact.language", "label": "Contact language", "type": "text"},
    {"key": "conversation.status", "label": "Conversation status", "type": "select",
     "options": ["open", "pending", "resolved"]},
    {"key": "conversation.tags", "label": "Conversation tags", "type": "text"},
    {"key": "conversation.message_count", "label": "Message count", "type": "number"},
    {"key": "conversation.is_unread", "label": "Is unread", "type": "boolean"},
    {"key": "conversation.assigned", "label": "Has an assignee", "type": "boolean"},
    {"key": "agent.name", "label": "AI agent name", "type": "text"},
    {"key": "request.category", "label": "Request category", "type": "text"},
    {"key": "request.priority", "label": "Request priority", "type": "select",
     "options": ["low", "normal", "high", "urgent"]},
    {"key": "request.status", "label": "Request status", "type": "select",
     "options": ["pending", "completed", "cancelled"]},
    {"key": "request.title", "label": "Request title", "type": "text"},
    {"key": "webhook.body", "label": "Webhook payload (JSON text)", "type": "text"},
]

OPERATORS: list[dict[str, str]] = [
    {"key": "equals", "label": "is"},
    {"key": "not_equals", "label": "is not"},
    {"key": "contains", "label": "contains"},
    {"key": "not_contains", "label": "does not contain"},
    {"key": "starts_with", "label": "starts with"},
    {"key": "is_empty", "label": "is empty"},
    {"key": "is_not_empty", "label": "is not empty"},
    {"key": "greater_than", "label": "is greater than"},
    {"key": "less_than", "label": "is less than"},
    {"key": "is_true", "label": "is true"},
    {"key": "is_false", "label": "is false"},
]

#: Everything a workflow can actually do. Each has a real implementation in
#: engine.py — nothing here is a stub.
ACTIONS: dict[str, dict[str, Any]] = {
    "send_message": {
        "label": "Send a message",
        "description": "Replies to the contact on their own channel.",
        "fields": [
            {"key": "text", "label": "Message", "type": "textarea", "default": ""},
        ],
    },
    "add_tag": {
        "label": "Add a tag",
        "description": "Tags the conversation.",
        "fields": [{"key": "tag", "label": "Tag", "type": "text", "default": ""}],
    },
    "remove_tag": {
        "label": "Remove a tag",
        "description": "Removes a tag from the conversation.",
        "fields": [{"key": "tag", "label": "Tag", "type": "text", "default": ""}],
    },
    "set_conversation_status": {
        "label": "Set conversation status",
        "description": "Opens, pends or resolves the thread.",
        "fields": [
            {"key": "status", "label": "Status", "type": "select",
             "options": ["open", "pending", "resolved"], "default": "open"},
        ],
    },
    "assign_user": {
        "label": "Assign to a person",
        "description": "Gives the conversation a human owner.",
        "fields": [{"key": "user_id", "label": "User", "type": "user", "default": ""}],
    },
    "assign_agent": {
        "label": "Switch AI agent",
        "description": "Routes the conversation to a different AI agent.",
        "fields": [{"key": "agent_id", "label": "Agent", "type": "agent", "default": ""}],
    },
    "update_agent_config": {
        "label": "Update agent configuration",
        "description": "Changes a setting on an AI agent — status, temperature, model or knowledge base.",
        "fields": [
            {"key": "agent_id", "label": "Agent", "type": "agent", "default": ""},
            {"key": "field", "label": "Setting", "type": "select",
             "options": ["status", "temperature", "model", "knowledge_base_id",
                         "max_output_tokens", "context_history_limit"], "default": "status"},
            {"key": "value", "label": "New value", "type": "text", "default": ""},
        ],
    },
    "create_request": {
        "label": "Create a request",
        "description": "Raises a ticket in the Requests Hub.",
        "fields": [
            {"key": "title", "label": "Title", "type": "text", "default": ""},
            {"key": "category", "label": "Category", "type": "select",
             "options": ["human_request", "callback", "order", "reschedule",
                         "cancellation", "billing", "complaint", "other"], "default": "other"},
            {"key": "priority", "label": "Priority", "type": "select",
             "options": ["low", "normal", "high", "urgent"], "default": "normal"},
        ],
    },
    "update_request_status": {
        "label": "Update the request",
        "description": "Completes or cancels the request that started this run.",
        "fields": [
            {"key": "status", "label": "Status", "type": "select",
             "options": ["pending", "completed", "cancelled"], "default": "completed"},
        ],
    },
    "notify_user": {
        "label": "Notify a person",
        "description": "Sends an in-app notification (the top bar's bell).",
        "fields": [
            {"key": "user_id", "label": "User", "type": "user", "default": ""},
            {"key": "title", "label": "Title", "type": "text", "default": ""},
            {"key": "body", "label": "Body", "type": "textarea", "default": ""},
        ],
    },
    "add_contact_note": {
        "label": "Add an internal note",
        "description": "Writes a staff-only note on the contact.",
        "fields": [{"key": "text", "label": "Note", "type": "textarea", "default": ""}],
    },
    "http_request": {
        "label": "Call an external API",
        "description": "Sends an outbound HTTP request to another system.",
        "fields": [
            {"key": "method", "label": "Method", "type": "select",
             "options": ["GET", "POST", "PUT", "PATCH", "DELETE"], "default": "POST"},
            {"key": "url", "label": "URL", "type": "text", "default": ""},
            {"key": "body", "label": "JSON body", "type": "textarea", "default": ""},
        ],
    },
    "ai_reply": {
        "label": "Let the AI answer",
        "description": "Generates a reply with the conversation's agent and sends it.",
        "fields": [
            {"key": "instruction", "label": "Extra instruction (optional)",
             "type": "textarea", "default": ""},
        ],
    },
}

#: Structural nodes — not triggers, not actions, but the shape of the graph.
FLOW_NODES: dict[str, dict[str, Any]] = {
    "condition": {
        "label": "Condition",
        "description": "Branches on AND/OR groups of field checks. Two outputs: true and false.",
    },
    "delay": {
        "label": "Wait",
        "description": "Pauses the run, then resumes from where it left off.",
    },
    "approval": {
        "label": "Wait for approval",
        "description": "Raises a request and waits until someone completes or cancels it.",
    },
}


def catalog() -> dict[str, Any]:
    return {
        "triggers": [{"key": key, **value} for key, value in TRIGGERS.items()],
        "actions": [{"key": key, **value} for key, value in ACTIONS.items()],
        "flow_nodes": [{"key": key, **value} for key, value in FLOW_NODES.items()],
        "condition_fields": CONDITION_FIELDS,
        "operators": OPERATORS,
    }
