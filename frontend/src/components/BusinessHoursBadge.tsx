import { Clock } from 'lucide-react'

import { useApi } from '@/hooks/useApi'
import { cn } from '@/lib/utils'
import type { BusinessHours } from '@/lib/types'

/**
 * Subtle open/closed indicator.
 *
 * Informational only — nothing is blocked outside hours. It exists so a staff
 * member seeing a quiet queue at 23:00 knows why, and so anyone checking from
 * another timezone reads the clinic's clock rather than their own. The server
 * computes it for exactly that reason.
 */
export function BusinessHoursBadge() {
  // Refreshed on a slow poll: the state only changes at an opening or closing
  // time, so a minute of staleness is invisible.
  const { data } = useApi<BusinessHours>('/settings/business-hours', {
    pollMs: 60000,
  })

  if (!data) return null

  return (
    <span
      className={cn(
        'pill hidden lg:inline-flex',
        data.is_open ? 'pill-success' : 'pill-muted',
      )}
      title={
        data.is_open
          ? `Open until ${data.today_hours?.split('-')[1]} · ${data.timezone}`
          : `Closed · opens ${data.next_open ?? 'later'} · ${data.timezone}`
      }
    >
      <span aria-hidden className="pill-dot" />
      <Clock aria-hidden className="size-3" />
      {data.is_open ? 'Open' : 'Closed'}
      <span className="font-normal opacity-70">{data.local_time}</span>
    </span>
  )
}
