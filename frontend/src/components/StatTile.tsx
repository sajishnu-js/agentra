import type { LucideIcon } from 'lucide-react'

import { Card } from '@/components/ui/card'
import { useCountUp } from '@/hooks/useCountUp'
import { useTilt } from '@/hooks/useTilt'
import { cn } from '@/lib/utils'

type Tint = 'brand' | 'success' | 'warning' | 'muted'

/**
 * A single headline number.
 *
 * The number is the point, so it gets display-scale type with tight tracking
 * and tabular figures — digits line up between cards instead of jittering.
 * The icon chip carries the tint, and a matching hairline along the top edge
 * ties the card to it without colouring the whole surface.
 */

const iconTint: Record<Tint, string> = {
  brand: 'bg-brand-soft text-brand-text ring-brand/25',
  success: 'bg-success/12 text-success ring-success/25',
  warning: 'bg-warning/12 text-warning ring-warning/25',
  muted: 'bg-muted text-muted-foreground ring-border',
}

const edgeTint: Record<Tint, string> = {
  brand: 'from-transparent via-brand/70 to-transparent',
  success: 'from-transparent via-success/60 to-transparent',
  warning: 'from-transparent via-warning/60 to-transparent',
  muted: 'from-transparent via-muted-foreground/30 to-transparent',
}

export function StatTile({
  label,
  value,
  icon: Icon,
  tint = 'brand',
  hint,
  className,
}: {
  label: string
  /** A number animates in (see useCountUp) — real motion tied to the value
   * actually changing (a new request, a filter switching agents), not
   * decoration. A string renders as-is, for a tile that isn't a plain count. */
  value: number | string
  icon: LucideIcon
  tint?: Tint
  hint?: string
  className?: string
}) {
  const tilt = useTilt<HTMLDivElement>(8)
  const animated = useCountUp(typeof value === 'number' ? value : 0)
  const display = typeof value === 'number' ? animated.toLocaleString() : value

  return (
    <Card
      ref={tilt.ref}
      onMouseMove={tilt.onMouseMove}
      onMouseLeave={tilt.onMouseLeave}
      className={cn(
        'glass-interactive tilt-3d relative gap-0 overflow-hidden p-5',
        className,
      )}
    >
      {/* Replaces the generic sheen with one that matches the metric's tint. */}
      <span
        aria-hidden
        className={cn(
          'absolute inset-x-4 top-0 h-px bg-gradient-to-r',
          edgeTint[tint],
        )}
      />

      <div className="flex items-start justify-between gap-3">
        <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          {label}
        </span>
        <span
          className={cn(
            'grid size-9 shrink-0 place-items-center rounded-xl ring-1',
            iconTint[tint],
          )}
        >
          <Icon className="size-4" />
        </span>
      </div>

      {/* leading-[1.15] rather than leading-none: at 2.125rem the digits'
          own overshoot sits outside a line box set to exactly 1em, so the
          number was being clipped by a few pixels at the top and bottom. */}
      <span className="mt-4 text-[2.125rem] leading-[1.15] font-semibold tracking-tight tabular-nums">
        {display}
      </span>

      {hint ? (
        <span className="mt-2 text-xs text-muted-foreground">{hint}</span>
      ) : null}
    </Card>
  )
}
