import { Clock, TriangleAlert } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { REPLY_WINDOW_HOURS, hoursSince } from '@/lib/format'

/**
 * Amber glass strip for a conversation whose free-form reply window has
 * closed.
 *
 * Visual only. Nothing here talks to WhatsApp, and the "Send template" button
 * is inert — the real rule is enforced by the WhatsApp Business API, which
 * rejects a free-form message more than 24 hours after the last inbound one.
 * The banner is driven by real `last_incoming_at` data, so it appears on
 * exactly the conversations it would appear on later.
 */
export function ReplyWindowBanner({ lastIncomingAt }: { lastIncomingAt: string | null }) {
  const hours = hoursSince(lastIncomingAt)
  if (hours === null) return null

  const elapsed = Math.floor(hours)

  return (
    <div className="glass-warning flex flex-wrap items-center gap-3 rounded-lg px-4 py-2.5">
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-warning/15 text-warning">
        <TriangleAlert className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-warning">
          Outside the {REPLY_WINDOW_HOURS}-hour reply window
        </p>
        <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
          <Clock className="size-3" />
          Last message from this contact was {elapsed}h ago. A free-form reply will
          be rejected — an approved template is required to reopen the thread.
        </p>
      </div>
      <Button variant="glass" size="sm" disabled className="shrink-0">
        Send template
      </Button>
    </div>
  )
}
