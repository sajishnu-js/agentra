import { useState } from 'react'

import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useTilt } from '@/hooks/useTilt'
import { cn } from '@/lib/utils'
import type { HeatmapCell } from '@/lib/types'

/**
 * When requests arrive, by hour of day against a second dimension.
 *
 * A CSS grid rather than Recharts: Recharts has no heatmap primitive, and the
 * usual workaround — a ScatterChart with fixed-size square marks — cannot size
 * its cells to the plot area, so the grid never tiles and reads as a dot
 * matrix. A grid of real elements also gets per-cell labels, keyboard focus and
 * responsive sizing for free. The bar chart above it is Recharts, which is what
 * Recharts is good at.
 *
 * Sequential encoding: one hue (--chart-1) at five opacity steps, light to
 * dark. Never a rainbow — the quantity is ordered, so the colour must be too.
 * The row dimension is categorical, but the *cell value* is a magnitude, which
 * is what the colour encodes.
 */

const HOURS = Array.from({ length: 24 }, (_, hour) => hour)
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// Five steps, so a reader can tell them apart. More steps look smoother and are
// harder to actually decode.
const STEPS = [0.18, 0.38, 0.58, 0.78, 1]

const CATEGORY_LABELS: Record<string, string> = {
  human_request: 'Human',
  callback: 'Callback',
  order: 'Order',
  reschedule: 'Reschedule',
  cancellation: 'Cancellation',
  billing: 'Billing',
  complaint: 'Complaint',
  other: 'Other',
}

// Fixed order, so a category does not jump rows between date ranges just
// because it had no requests in one of them.
const CATEGORY_ORDER = [
  'human_request',
  'callback',
  'order',
  'reschedule',
  'cancellation',
  'billing',
  'complaint',
  'other',
]

type Grouping = 'category' | 'weekday'

function stepFor(count: number, max: number): number | null {
  if (count === 0) return null
  const index = Math.min(STEPS.length - 1, Math.floor((count / max) * STEPS.length))
  return STEPS[index]
}

export function RequestHeatmap({
  byCategory,
  byWeekday,
  timezone,
}: {
  byCategory: HeatmapCell[]
  byWeekday: HeatmapCell[]
  timezone: string
}) {
  const [grouping, setGrouping] = useState<Grouping>('category')
  const tilt = useTilt<HTMLDivElement>(3)

  const data = grouping === 'category' ? byCategory : byWeekday
  const rows =
    grouping === 'category'
      ? CATEGORY_ORDER
      : WEEKDAYS.map((_, index) => String(index))
  const label = (row: string) =>
    grouping === 'category'
      ? (CATEGORY_LABELS[row] ?? row)
      : WEEKDAYS[Number(row)]

  const counts = new Map(data.map((cell) => [`${cell.row}-${cell.hour}`, cell.count]))
  const max = Math.max(1, ...data.map((cell) => cell.count))

  return (
    <Card
      ref={tilt.ref}
      onMouseMove={tilt.onMouseMove}
      onMouseLeave={tilt.onMouseLeave}
      className="glass-interactive tilt-3d p-5"
    >
      <CardHeader className="flex-row items-start justify-between gap-3 p-0 pb-4">
        <div className="flex flex-col gap-1">
          <CardTitle>When do callers need you most</CardTitle>
          <CardDescription>
            Hour of day by {grouping === 'category' ? 'request type' : 'weekday'},{' '}
            {timezone.replace('_', ' ')}
          </CardDescription>
        </div>
        <div className="glass flex shrink-0 items-center gap-0.5 rounded-full p-0.5">
          {(['category', 'weekday'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setGrouping(option)}
              aria-pressed={grouping === option}
              className={cn(
                'rounded-full px-2.5 py-1 text-[11px] font-medium capitalize transition-colors',
                grouping === option
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {option}
            </button>
          ))}
        </div>
      </CardHeader>

      <div className="overflow-x-auto">
        <div className="min-w-[38rem]">
          {/* Hour ruler. Every third hour is labelled so the axis stays legible. */}
          <div className="mb-1 flex gap-0.5 pl-24">
            {HOURS.map((hour) => (
              <div
                key={hour}
                className="flex-1 text-center text-[10px] text-foreground-subtle"
              >
                {hour % 3 === 0 ? String(hour).padStart(2, '0') : ''}
              </div>
            ))}
          </div>

          {rows.map((row) => (
            <div key={row} className="mb-0.5 flex items-center gap-0.5">
              <div className="w-24 shrink-0 truncate pr-2 text-[11px] text-muted-foreground">
                {label(row)}
              </div>
              {HOURS.map((hour) => {
                const count = counts.get(`${row}-${hour}`) ?? 0
                const step = stepFor(count, max)
                return (
                  <div
                    key={hour}
                    className="h-5 flex-1 rounded-[3px]"
                    style={
                      step === null
                        ? { backgroundColor: 'var(--muted)' }
                        : { backgroundColor: 'var(--chart-1)', opacity: step }
                    }
                    title={`${label(row)} · ${String(hour).padStart(2, '0')}:00 — ${count} request${count === 1 ? '' : 's'}`}
                    aria-label={`${label(row)} at ${hour}:00, ${count} requests`}
                  />
                )
              })}
            </div>
          ))}

          {/* Legend: a sequential scale needs one, since the steps are the key. */}
          <div className="mt-3 flex items-center justify-end gap-1.5 text-[10px] text-foreground-subtle">
            <span>Fewer</span>
            <span
              className="size-3 rounded-[3px]"
              style={{ backgroundColor: 'var(--muted)' }}
            />
            {STEPS.map((step) => (
              <span
                key={step}
                className="size-3 rounded-[3px]"
                style={{ backgroundColor: 'var(--chart-1)', opacity: step }}
              />
            ))}
            <span>More ({max})</span>
          </div>
        </div>
      </div>

      <table className="sr-only">
        <caption>
          Requests by {grouping === 'category' ? 'request type' : 'weekday'} and hour
        </caption>
        <thead>
          <tr>
            <th scope="col">{grouping === 'category' ? 'Type' : 'Weekday'}</th>
            {HOURS.map((hour) => (
              <th key={hour} scope="col">
                {hour}:00
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row}>
              <th scope="row">{label(row)}</th>
              {HOURS.map((hour) => (
                <td key={hour}>{counts.get(`${row}-${hour}`) ?? 0}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}
