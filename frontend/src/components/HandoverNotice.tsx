import { AlertTriangle, Bot, ServerCrash, UserRound } from 'lucide-react'

import { relativeAge } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { HandoverReason } from '@/lib/types'

/**
 * Why a conversation is waiting on a person.
 *
 * The reason is the useful part: a keyword hit means a customer raised
 * something urgent and the AI was never allowed to answer, while
 * ai_uncertain means it drafted something it did not trust. Those need
 * different reactions from staff, so they do not get the same colour.
 */

type Meta = {
  label: string
  tint: string
  icon: typeof AlertTriangle
  blurb: string
}

const HANDOVER: Record<HandoverReason, Meta> = {
  keyword: {
    label: 'Needs a person',
    tint: 'pill-danger',
    icon: AlertTriangle,
    blurb: 'A trigger term matched, so the AI was never called.',
  },
  ai_uncertain: {
    label: 'AI unsure',
    tint: 'pill-warning',
    icon: Bot,
    blurb: 'The agent drafted a reply but could not ground it. Draft withheld.',
  },
  llm_error: {
    label: 'AI unavailable',
    tint: 'pill-info',
    icon: ServerCrash,
    blurb: 'The model could not be reached. Nothing was answered.',
  },
  manual: {
    label: 'Taken over',
    tint: 'pill-info',
    icon: UserRound,
    blurb: 'A team member picked this thread up.',
  },
}

/** Compact pill, for list rows and headers. */
export function HandoverBadge({
  reason,
  className,
}: {
  reason: HandoverReason
  className?: string
}) {
  const meta = HANDOVER[reason]
  return (
    <span className={cn('pill', meta.tint, className)}>
      <span aria-hidden className="pill-dot" />
      {meta.label}
    </span>
  )
}

/** The full strip shown above a thread that needs attention. */
export function HandoverNotice({
  reason,
  detail,
  at,
}: {
  reason: HandoverReason
  detail: string | null
  at: string | null
}) {
  const meta = HANDOVER[reason]
  const Icon = meta.icon

  return (
    <div className="glass-warning flex flex-wrap items-start gap-3 rounded-lg px-4 py-2.5">
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-warning/15 text-warning">
        <Icon className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-xs font-medium text-warning">
          {meta.label}
          {at ? (
            <span className="font-normal text-muted-foreground">
              · raised {relativeAge(at)}
            </span>
          ) : null}
        </p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{meta.blurb}</p>
        {detail ? (
          // Monospace because this is machine-written: matched terms, or the
          // confidence the model reported.
          <p className="mt-1 font-mono text-[11px] break-words text-foreground-subtle">
            {detail}
          </p>
        ) : null}
      </div>
    </div>
  )
}
