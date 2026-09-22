import { Bot, Gauge, TimerReset, UserRound } from 'lucide-react'

import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useTilt } from '@/hooks/useTilt'
import { cn } from '@/lib/utils'
import type { ClosingTime, ResolutionSplit } from '@/lib/types'

/** Hours as something a person reads: "42m", "3.4h", "2.1d". */
function duration(hours: number | null): string {
  if (hours === null) return '—'
  if (hours < 1) return `${Math.round(hours * 60)}m`
  if (hours < 48) return `${hours.toFixed(1)}h`
  return `${(hours / 24).toFixed(1)}d`
}

export function ClosingTimePanel({ data }: { data: ClosingTime }) {
  const nothingMeasured = data.measured === 0
  const tilt = useTilt<HTMLDivElement>(8)

  return (
    <Card
      ref={tilt.ref}
      onMouseMove={tilt.onMouseMove}
      onMouseLeave={tilt.onMouseLeave}
      className="tilt-3d gap-0 p-5"
    >
      <CardHeader className="p-0 pb-4">
        <CardTitle className="flex items-center gap-1.5">
          <TimerReset className="size-3.5" />
          Closing time
        </CardTitle>
        <CardDescription>
          {nothingMeasured
            ? 'Nothing completed in this range yet'
            : `Average across ${data.measured} completed request${data.measured === 1 ? '' : 's'}`}
        </CardDescription>
      </CardHeader>

      {nothingMeasured ? (
        <p className="text-xs text-muted-foreground">
          Time to close is measured from when a request is created to when it is
          marked completed.
        </p>
      ) : (
        <>
          <span className="text-2xl font-semibold tracking-tight tabular-nums">
            {duration(data.average_hours)}
          </span>
          <span className="mt-0.5 text-xs text-muted-foreground">
            median {duration(data.median_hours)}
          </span>

          <dl className="mt-4 flex flex-col gap-2 border-t border-border pt-3 text-xs">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">Fastest</dt>
              <dd className="font-medium tabular-nums text-success">
                {duration(data.fastest_hours)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">Slowest</dt>
              <dd className="font-medium tabular-nums text-warning">
                {duration(data.slowest_hours)}
              </dd>
            </div>
          </dl>
        </>
      )}

      {/* Never imply the average covers requests it could not see. */}
      {data.unmeasured > 0 ? (
        <p className="mt-3 flex items-start gap-1.5 border-t border-border pt-3 text-[11px] text-foreground-subtle">
          <Gauge className="mt-0.5 size-3 shrink-0" />
          {data.unmeasured} completed request{data.unmeasured === 1 ? '' : 's'} in this
          range {data.unmeasured === 1 ? 'has' : 'have'} no completion timestamp and
          {data.unmeasured === 1 ? ' is' : ' are'} not included.
        </p>
      ) : null}
    </Card>
  )
}

/**
 * How many conversations the agent handled alone.
 *
 * The signal is conversations.assigned_agent_id: auto-assignment fires on
 * handover, so an assignee means a person was pulled in and a null means the
 * agent saw it through by itself.
 */
export function ResolutionPanel({ data }: { data: ResolutionSplit }) {
  const aiShare = data.total === 0 ? 0 : (data.ai_only / data.total) * 100
  const tilt = useTilt<HTMLDivElement>(8)

  return (
    <Card
      ref={tilt.ref}
      onMouseMove={tilt.onMouseMove}
      onMouseLeave={tilt.onMouseLeave}
      className="tilt-3d gap-0 p-5"
    >
      <CardHeader className="p-0 pb-4">
        <CardTitle className="flex items-center gap-1.5">
          <Bot className="size-3.5" />
          Handled by AI alone
        </CardTitle>
        <CardDescription>
          Conversations started in this range, by whether a person was involved
        </CardDescription>
      </CardHeader>

      {data.total === 0 ? (
        <p className="text-xs text-muted-foreground">
          No conversations started in this range.
        </p>
      ) : (
        <>
          <span className="text-2xl font-semibold tracking-tight tabular-nums">
            {aiShare.toFixed(0)}%
          </span>
          <span className="mt-0.5 text-xs text-muted-foreground">
            {data.ai_only} of {data.total} conversations
          </span>

          {/* A single proportion, so one bar rather than a pie. */}
          <div
            className="mt-4 flex h-2 gap-0.5 overflow-hidden rounded-full"
            role="img"
            aria-label={`${data.ai_only} handled by AI alone, ${data.human_involved} involved a person`}
          >
            <div
              className="bg-chart-1"
              style={{ width: `${aiShare}%` }}
            />
            <div className={cn('flex-1 bg-muted')} />
          </div>

          <dl className="mt-3 flex flex-col gap-2 text-xs">
            <div className="flex items-center justify-between gap-3">
              <dt className="flex items-center gap-1.5 text-muted-foreground">
                <span aria-hidden className="size-2 rounded-full bg-chart-1" />
                AI only
              </dt>
              <dd className="font-medium tabular-nums">{data.ai_only}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="flex items-center gap-1.5 text-muted-foreground">
                <UserRound className="size-3" />
                Person involved
              </dt>
              <dd className="font-medium tabular-nums">{data.human_involved}</dd>
            </div>
          </dl>
        </>
      )}
    </Card>
  )
}
