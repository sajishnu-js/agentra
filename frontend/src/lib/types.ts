/**
 * Response types, mirroring the Pydantic schemas in backend/app/domains.
 *
 * Hand-written rather than generated: the surface is small enough that a
 * codegen step would be more machinery than it saves. If it grows, generate
 * these from /openapi.json instead of letting them drift.
 */

export type Channel = 'telegram' | 'whatsapp' | 'instagram' | 'email'
export type ConversationStatus = 'open' | 'pending' | 'resolved'
export type MessageDirection = 'incoming' | 'outgoing'
export type MessageStatus =
  | 'received'
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed'
export type RequestStatus = 'pending' | 'completed' | 'cancelled'
export type HandoverReason = 'keyword' | 'ai_uncertain' | 'llm_error' | 'manual'
export type RequestPriority = 'low' | 'normal' | 'high' | 'urgent'
export type RequestCategory =
  | 'human_request'
  | 'callback'
  | 'order'
  | 'reschedule'
  | 'cancellation'
  | 'billing'
  | 'complaint'
  | 'other'
export type AgentStatus = 'active' | 'paused' | 'draft'
export type InboxStatus = 'connected' | 'disconnected' | 'pending'
export type SourceType = 'pdf' | 'docx'
export type UserRole = 'super_admin' | 'admin' | 'agent'

export type ContactSummary = {
  id: string
  name: string
  phone_number: string | null
  channel: Channel
  language: string | null
}

export type Contact = ContactSummary & { created_at: string }

export type UserSummary = {
  id: string
  name: string
  avatar_url: string | null
}

export type AgentSummary = {
  id: string
  name: string
}

export type UserWorkload = {
  id: string
  name: string
  avatar_url: string | null
  role: UserRole
  open_conversations: number
  open_requests: number
}

export type BusinessHours = {
  is_open: boolean
  timezone: string
  local_time: string
  weekday: string
  today_hours: string | null
  next_open: string | null
}

export type User = {
  id: string
  name: string
  email: string
  avatar_url: string | null
  role: UserRole
  is_active: boolean
  job_title: string | null
  phone: string | null
  // NULL means "use the workspace default" — see AuthProvider's `timezone`.
  timezone: string | null
  theme_preference: string | null
  accent_preference: string | null
  // Only meaningful when role === 'admin' — see auth/permissions.py.
  granted_permissions: string[]
  created_at: string
}

export type UserCreatePayload = {
  name: string
  email: string
  role: UserRole
  job_title?: string | null
  phone?: string | null
  avatar_url?: string | null
  granted_permissions?: string[]
}

export type UserUpdateAdminPayload = Partial<{
  name: string
  email: string
  avatar_url: string | null
  job_title: string | null
  phone: string | null
  role: UserRole
  is_active: boolean
  granted_permissions: string[]
}>

export type MeResponse = {
  user: User
  permissions: string[]
  implicit: boolean
}

export type Session = {
  id: string
  created_at: string
  last_seen_at: string
  user_agent: string | null
  ip_address: string | null
  is_current: boolean
}

export type AuditLog = {
  id: string
  actor_user_id: string | null
  actor_name: string | null
  action: string
  entity_type: string
  entity_id: string | null
  summary: string
  context: Record<string, unknown> | null
  created_at: string
}

export type AuditLogPage = {
  items: AuditLog[]
  total: number
}

export type WorkspaceSettings = {
  id: string
  workspace_name: string
  support_email: string | null
  default_language: string
  timezone: string
  notify_new_request: boolean
  notify_handover: boolean
  notify_agent_error: boolean
  notify_daily_summary: boolean
  session_idle_timeout_minutes: number
  audit_log_retention_days: number
  require_confirmation_for_deletes: boolean
  ip_allowlist: string | null
  default_model: string
  default_temperature: number
  default_max_output_tokens: number
}

export type IntegrationStatus = {
  llm_provider: string
  gemini_configured: boolean
  gemini_model: string
  telegram_configured: boolean
  whatsapp_verify_token_configured: boolean
  whatsapp_app_secret_configured: boolean
  instagram_verify_token_configured: boolean
  instagram_app_secret_configured: boolean
  email_webhook_secret_configured: boolean
  public_base_url: string | null
}

export type LoginRequirement = {
  require_login: boolean
}

export type MessagePreview = {
  text: string | null
  direction: MessageDirection
  created_at: string
}

export type Message = {
  id: string
  conversation_id: string
  direction: MessageDirection
  text: string | null
  status: MessageStatus
  kb_chunks_used: { chunk_id: string; kb_document_id: string; score: number }[] | null
  is_staff_reply: boolean
  attachment_url: string | null
  attachment_filename: string | null
  attachment_content_type: string | null
  attachment_size: number | null
  edited_at: string | null
  created_at: string
}

export type ConversationListItem = {
  id: string
  status: ConversationStatus
  assigned_agent_id: string | null
  last_incoming_at: string | null
  created_at: string
  handover_reason: HandoverReason | null
  handover_detail: string | null
  handover_at: string | null
  tags: string[]
  is_unread: boolean
  is_pinned: boolean
  contact: ContactSummary
  assigned_agent: UserSummary | null
  agent: AgentSummary | null
  last_message: MessagePreview | null
  message_count: number
}

export type RequestSummary = {
  id: string
  category: RequestCategory
  priority: RequestPriority
  title: string
  status: RequestStatus
  created_at: string
}

export type ConversationDetail = {
  id: string
  status: ConversationStatus
  last_incoming_at: string | null
  created_at: string
  handover_reason: HandoverReason | null
  handover_detail: string | null
  handover_at: string | null
  tags: string[]
  is_unread: boolean
  is_pinned: boolean
  contact: ContactSummary
  assigned_agent: UserSummary | null
  agent: AgentSummary | null
  requests: RequestSummary[]
  message_count: number
}

export type ContactNoteAuthor = {
  id: string
  name: string
}

export type ContactNote = {
  id: string
  contact_id: string
  author: ContactNoteAuthor | null
  text: string
  created_at: string
}

export type AgentRequest = {
  id: string
  conversation_id: string
  category: RequestCategory
  priority: RequestPriority
  title: string
  status: RequestStatus
  created_at: string
  completed_at: string | null
  contact: { id: string; name: string; channel: Channel }
  assigned_agent: UserSummary | null
}

export type Agent = {
  id: string
  name: string
  description: string | null
  status: AgentStatus
  model: string
  system_prompt: string
  temperature: number
  created_at: string
  knowledge_base_id: string | null
  icon: string
  guardrails: string
  tools_enabled: string[]
  response_behaviour: string
  fallback_message: string | null
  context_history_limit: number
  max_output_tokens: number
  owner_user_id: string | null
}

export type AgentTestTurn = {
  role: 'customer' | 'business'
  text: string
}

export type AgentTestConfig = {
  system_prompt: string
  guardrails: string
  response_behaviour: string
  temperature: number
  model: string
  knowledge_base_id: string | null
  context_history_limit: number
  max_output_tokens: number
}

export type AgentTestResponse = {
  reply: string
  confidence: 'low' | 'medium' | 'high'
  context_sufficient: boolean
  model: string
  sources: { chunk_id: string; kb_document_id: string; score: number }[] | null
}

export type KnowledgeBaseSummary = {
  id: string
  name: string
  description: string | null
  icon: string
  created_at: string
  document_count: number
  table_count: number
  agents: { id: string; name: string }[]
}

export type Inbox = {
  id: string
  name: string
  channel: Channel
  status: InboxStatus
  account_identifier: string | null
  last_synced_at: string | null
  created_at: string
  default_agent_id: string | null
  default_agent: AgentSummary | null
}

export type KBDocument = {
  id: string
  knowledge_base_id: string
  title: string
  source_type: SourceType
  language: string | null
  uploaded_at: string
  chunk_count: number
  file_url: string | null
}

export type KBChunk = {
  id: string
  kb_document_id: string
  content: string
  chunk_index: number
  created_at: string
}

export type KBColumn = { key: string; label: string }

export type KBTableSummary = {
  id: string
  knowledge_base_id: string
  name: string
  slug: string
  description: string | null
  columns: KBColumn[]
  row_count: number
}

export type KBTableRow = { id: string; data: Record<string, string>; position: number }

export type KBTableDetail = {
  id: string
  knowledge_base_id: string
  name: string
  slug: string
  description: string | null
  columns: KBColumn[]
  rows: KBTableRow[]
}

export type VolumePoint = {
  date: string
  pending: number
  completed: number
  cancelled: number
}

export type HeatmapCell = {
  /** A request category, or a weekday index as a string. */
  row: string
  hour: number
  count: number
}

export type ClosingTime = {
  average_hours: number | null
  median_hours: number | null
  fastest_hours: number | null
  slowest_hours: number | null
  measured: number
  unmeasured: number
}

export type ResolutionSplit = {
  ai_only: number
  human_involved: number
  total: number
}

export type RequestAnalytics = {
  range: { start: string; end: string; days: number }
  timezone: string
  agent_id: string | null
  totals: { total: number; pending: number; completed: number; cancelled: number }
  volume: VolumePoint[]
  heatmap_by_category: HeatmapCell[]
  heatmap_by_weekday: HeatmapCell[]
  closing_time: ClosingTime
  resolution: ResolutionSplit
}

export type AgentSummaryStat = {
  agent_id: string
  agent_name: string
  icon: string
  conversations: number
  messages_in: number
  messages_out: number
  requests_total: number
  requests_pending: number
  requests_completed: number
  kb_citation_rate: number
}

export type NavCounts = {
  pending_requests: number
  open_conversations: number
  notify_new_request: boolean
}

export type Notification = {
  id: string
  title: string
  body: string | null
  link: string | null
  is_read: boolean
  created_at: string
}

export type SearchResultType = 'conversation' | 'agent' | 'knowledge_base' | 'request'

export type SearchResult = {
  type: SearchResultType
  id: string
  title: string
  subtitle: string
  link: string
}

// ---- Workflows ----

export type WorkflowStatus = 'draft' | 'active' | 'paused'

export type WorkflowExecutionStatus =
  | 'running'
  | 'waiting_delay'
  | 'waiting_approval'
  | 'success'
  | 'failed'

export type StepStatus = 'success' | 'failed' | 'skipped'

/** Mirrors schemas.NodeKind. `condition`/`delay`/`approval` carry no `type`
 * — their behaviour comes entirely from `config`. */
export type WorkflowNodeKind = 'trigger' | 'condition' | 'action' | 'delay' | 'approval'

export type WorkflowNodeConfig = Record<string, unknown>

export type WorkflowNodeData = {
  id: string
  kind: WorkflowNodeKind
  type: string
  position: { x: number; y: number }
  config: WorkflowNodeConfig
}

export type WorkflowEdgeData = {
  id: string
  source: string
  target: string
  branch?: 'true' | 'false' | null
}

export type WorkflowGraph = {
  nodes: WorkflowNodeData[]
  edges: WorkflowEdgeData[]
}

export type Workflow = {
  id: string
  name: string
  description: string | null
  status: WorkflowStatus
  graph: WorkflowGraph
  agent_id: string | null
  agent: AgentSummary | null
  schedule_interval_minutes: number | null
  schedule_next_run_at: string | null
  webhook_token: string | null
  created_at: string
  version_count: number
  execution_count: number
  last_execution_at: string | null
}

export type WorkflowVersion = {
  id: string
  version_number: number
  graph: WorkflowGraph
  created_at: string
}

export type WorkflowStep = {
  id: string
  node_id: string
  node_type: string
  status: StepStatus
  detail: string | null
  started_at: string
  finished_at: string | null
}

export type WorkflowExecution = {
  id: string
  workflow_id: string
  status: WorkflowExecutionStatus
  trigger_type: string
  trigger_context: Record<string, unknown>
  conversation_id: string | null
  resume_at: string | null
  retry_count: number
  error: string | null
  created_at: string
  finished_at: string | null
  steps: WorkflowStep[]
}

export type ValidationIssue = {
  level: 'error' | 'warning'
  message: string
  node_id: string | null
}

export type ValidationResult = {
  valid: boolean
  issues: ValidationIssue[]
}

/** One configurable input on a node, as described by the backend catalog —
 * this is what drives the property panel's form rendering. */
export type CatalogField = {
  key: string
  label: string
  type: 'text' | 'textarea' | 'number' | 'select' | 'boolean' | 'user' | 'agent'
  options?: string[]
  default?: string | number
}

export type CatalogEntry = {
  key: string
  label: string
  description: string
  fields?: CatalogField[]
}

export type WorkflowCatalog = {
  triggers: CatalogEntry[]
  actions: CatalogEntry[]
  flow_nodes: CatalogEntry[]
  condition_fields: CatalogField[]
  operators: { key: string; label: string }[]
}

export type ConditionRule = {
  field: string
  operator: string
  value: string
}

export type ConditionGroup = {
  match: 'all' | 'any'
  rules: ConditionRule[]
}
