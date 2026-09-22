import {
  AtSign,
  Bell,
  Bot,
  CalendarClock,
  CheckCircle2,
  Clock,
  Filter,
  Globe,
  Hand,
  MessageSquarePlus,
  MessagesSquare,
  Play,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  StickyNote,
  Tag,
  TagsIcon,
  Ticket,
  UserPlus,
  Webhook,
  type LucideIcon,
} from 'lucide-react'

import type { WorkflowNodeKind } from '@/lib/types'

/** Icon per catalog key. Same fixed-lookup pattern as agentIcons/kbIcons —
 * the backend sends a key, this maps it to a glyph. */
export const workflowNodeIcons: Record<string, LucideIcon> = {
  // triggers
  message_received: MessagesSquare,
  conversation_created: MessageSquarePlus,
  handover_raised: Hand,
  request_created: Ticket,
  request_status_changed: CheckCircle2,
  tag_added: TagsIcon,
  schedule: CalendarClock,
  webhook: Webhook,
  manual: Play,
  // actions
  send_message: Send,
  add_tag: Tag,
  remove_tag: Tag,
  set_conversation_status: CheckCircle2,
  assign_user: UserPlus,
  assign_agent: Bot,
  update_agent_config: Settings2,
  create_request: Ticket,
  update_request_status: CheckCircle2,
  notify_user: Bell,
  add_contact_note: StickyNote,
  http_request: Globe,
  ai_reply: Sparkles,
  // flow
  condition: Filter,
  delay: Clock,
  approval: ShieldCheck,
}

export const workflowNodeFallbackIcon = AtSign

/** Accent per node kind, so the canvas reads at a glance: triggers start
 * things, conditions branch, actions do, waits pause. */
export const nodeKindStyles: Record<
  WorkflowNodeKind,
  { ring: string; chip: string; label: string }
> = {
  trigger: {
    ring: 'border-success/50',
    chip: 'bg-success/15 text-success',
    label: 'Trigger',
  },
  condition: {
    ring: 'border-warning/50',
    chip: 'bg-warning/15 text-warning',
    label: 'Condition',
  },
  action: {
    ring: 'border-brand/50',
    chip: 'bg-brand-soft text-brand-text',
    label: 'Action',
  },
  delay: {
    ring: 'border-muted-foreground/40',
    chip: 'bg-muted text-muted-foreground',
    label: 'Wait',
  },
  approval: {
    ring: 'border-brand-2/50',
    chip: 'bg-brand-soft text-brand-text',
    label: 'Approval',
  },
}
