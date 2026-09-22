import { cn } from '@/lib/utils'
import type {
  AgentStatus,
  ConversationStatus,
  InboxStatus,
  RequestPriority,
  RequestStatus,
  StepStatus,
  WorkflowExecutionStatus,
  WorkflowStatus,
} from '@/lib/types'

/**
 * Status and priority pills. The `.pill` recipe in index.css supplies the
 * wash, ring and coloured glow; these maps only choose the tint, so a status
 * looks the same everywhere it appears.
 */

type Tint = 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'muted'

const tintClass: Record<Tint, string> = {
  brand: 'pill-brand',
  success: 'pill-success',
  warning: 'pill-warning',
  danger: 'pill-danger',
  info: 'pill-info',
  muted: 'pill-muted',
}

function Pill({
  tint,
  children,
  dot = true,
  className,
}: {
  tint: Tint
  children: React.ReactNode
  dot?: boolean
  className?: string
}) {
  return (
    <span className={cn('pill', tintClass[tint], className)}>
      {dot ? <span aria-hidden className="pill-dot" /> : null}
      {children}
    </span>
  )
}

const requestStatusTint: Record<RequestStatus, Tint> = {
  pending: 'warning',
  completed: 'success',
  cancelled: 'muted',
}

const requestStatusLabel: Record<RequestStatus, string> = {
  pending: 'Pending',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

export function RequestStatusPill({ status }: { status: RequestStatus }) {
  return <Pill tint={requestStatusTint[status]}>{requestStatusLabel[status]}</Pill>
}

const priorityTint: Record<RequestPriority, Tint> = {
  urgent: 'danger',
  high: 'warning',
  normal: 'brand',
  low: 'muted',
}

const priorityLabel: Record<RequestPriority, string> = {
  urgent: 'Urgent',
  high: 'High',
  normal: 'Normal',
  low: 'Low',
}

export function PriorityPill({ priority }: { priority: RequestPriority }) {
  return <Pill tint={priorityTint[priority]}>{priorityLabel[priority]}</Pill>
}

const conversationStatusTint: Record<ConversationStatus, Tint> = {
  open: 'brand',
  pending: 'warning',
  resolved: 'success',
}

const conversationStatusLabel: Record<ConversationStatus, string> = {
  open: 'Open',
  pending: 'Pending',
  resolved: 'Resolved',
}

export function ConversationStatusPill({ status }: { status: ConversationStatus }) {
  return (
    <Pill tint={conversationStatusTint[status]}>{conversationStatusLabel[status]}</Pill>
  )
}

const agentStatusTint: Record<AgentStatus, Tint> = {
  active: 'success',
  paused: 'warning',
  draft: 'muted',
}

const agentStatusLabel: Record<AgentStatus, string> = {
  active: 'Active',
  paused: 'Paused',
  draft: 'Draft',
}

export function AgentStatusPill({ status }: { status: AgentStatus }) {
  return <Pill tint={agentStatusTint[status]}>{agentStatusLabel[status]}</Pill>
}

const inboxStatusTint: Record<InboxStatus, Tint> = {
  connected: 'success',
  disconnected: 'danger',
  pending: 'warning',
}

const inboxStatusLabel: Record<InboxStatus, string> = {
  connected: 'Connected',
  disconnected: 'Disconnected',
  pending: 'Not connected',
}

export function InboxStatusPill({ status }: { status: InboxStatus }) {
  return <Pill tint={inboxStatusTint[status]}>{inboxStatusLabel[status]}</Pill>
}

const workflowStatusTint: Record<WorkflowStatus, Tint> = {
  active: 'success',
  paused: 'warning',
  draft: 'muted',
}

const workflowStatusLabel: Record<WorkflowStatus, string> = {
  active: 'Enabled',
  paused: 'Paused',
  draft: 'Draft',
}

export function WorkflowStatusPill({ status }: { status: WorkflowStatus }) {
  return <Pill tint={workflowStatusTint[status]}>{workflowStatusLabel[status]}</Pill>
}

const executionStatusTint: Record<WorkflowExecutionStatus, Tint> = {
  running: 'brand',
  waiting_delay: 'info',
  waiting_approval: 'warning',
  success: 'success',
  failed: 'danger',
}

const executionStatusLabel: Record<WorkflowExecutionStatus, string> = {
  running: 'Running',
  waiting_delay: 'Waiting',
  waiting_approval: 'Awaiting approval',
  success: 'Succeeded',
  failed: 'Failed',
}

export function ExecutionStatusPill({ status }: { status: WorkflowExecutionStatus }) {
  return <Pill tint={executionStatusTint[status]}>{executionStatusLabel[status]}</Pill>
}

const stepStatusTint: Record<StepStatus, Tint> = {
  success: 'success',
  failed: 'danger',
  skipped: 'muted',
}

export function StepStatusPill({ status }: { status: StepStatus }) {
  return (
    <Pill tint={stepStatusTint[status]} dot={false} className="h-4.5 px-1.5 text-[10px]">
      {status}
    </Pill>
  )
}

/** Category labels. The enum values are snake_case; these are for people. */
const categoryLabel: Record<string, string> = {
  human_request: 'Human',
  callback: 'Callback',
  order: 'Order',
  reschedule: 'Reschedule',
  cancellation: 'Cancellation',
  billing: 'Billing',
  complaint: 'Complaint',
  other: 'Other',
}

export function CategoryPill({ category }: { category: string }) {
  return (
    <Pill tint="info" dot={false}>
      {categoryLabel[category] ?? category}
    </Pill>
  )
}
