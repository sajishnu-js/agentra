import { CalendarRange, CheckCircle2, CircleSlash, Clock, Inbox, LayoutGrid } from 'lucide-react'
import { useState } from 'react'

import { AgentOverviewGrid } from '@/components/AgentOverviewGrid'
import { ClosingTimePanel, ResolutionPanel } from '@/components/ClosingTimePanel'
import { RequestHeatmap } from '@/components/charts/RequestHeatmap'
import { RequestVolumeChart } from '@/components/charts/RequestVolumeChart'
import { ErrorState, LoadingState } from '@/components/StateBlock'
import { StatTile } from '@/components/StatTile'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useApi } from '@/hooks/useApi'
import { useTilt } from '@/hooks/useTilt'
import { agentIconMap } from '@/lib/agentIcons'
import { shortDate } from '@/lib/format'
import type { Agent, AgentSummaryStat, RequestAnalytics } from '@/lib/types'

const OVERALL = 'overall'

/**
 * Presets cover "how are we doing lately", which is what most visits to this
 * dashboard actually ask — a rolling window in one click beats two date
 * pickers. Custom is the escape hatch for the other question, "how did a
 * specific period look" (a promo week, a prior month), via explicit
 * start/end query params the same endpoint also accepts.
 */
const RANGES = [
  { label: '7 days', days: 7 },
  { label: '14 days', days: 14 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
]

/** Shown above the charts only when a specific agent is selected — enough
 * context (icon, name, description) that the numbers below read as "this
 * agent's activity", not a mystery filter. */
function AgentHeaderCard({ agent }: { agent: Agent }) {
  const tilt = useTilt<HTMLDivElement>(4)
  const Icon = agentIconMap[agent.icon] ?? agentIconMap.Bot

  return (
    <Card
      ref={tilt.ref}
      onMouseMove={tilt.onMouseMove}
      onMouseLeave={tilt.onMouseLeave}
      className="glass-interactive tilt-3d flex flex-row items-center gap-4 p-5"
    >
      <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-glow">
        <Icon className="size-6" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-base font-semibold">{agent.name}</p>
        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{agent.description}</p>
      </div>
    </Card>
  )
}

const todayIso = () => new Date().toISOString().slice(0, 10)

export function Home() {
  const [days, setDays] = useState(14)
  const [scope, setScope] = useState<string>(OVERALL)
  const [customRange, setCustomRange] = useState(false)
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')

  const { data: agents } = useApi<Agent[]>('/agents')
  const selectedAgent = scope === OVERALL ? null : (agents ?? []).find((a) => a.id === scope) ?? null

  // A lone start or end has no sensible partner to assume — the request
  // just falls back to the preset window (see the days-based branch below)
  // until both sides of the custom range are actually filled in.
  const customRangeReady = customRange && customStart !== '' && customEnd !== '' && customStart <= customEnd
  const windowQuery = customRangeReady ? `start=${customStart}&end=${customEnd}` : `days=${days}`
  const query = scope === OVERALL ? windowQuery : `${windowQuery}&agent_id=${scope}`
  const { data, error, loading, reload } = useApi<RequestAnalytics>(`/analytics/requests?${query}`)

  const { data: agentStats } = useApi<AgentSummaryStat[]>(
    scope === OVERALL ? `/analytics/agents-summary?days=${days}` : null,
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {RANGES.map((range) => (
          <Button
            key={range.days}
            variant={!customRange && days === range.days ? 'default' : 'glass'}
            size="sm"
            onClick={() => {
              setCustomRange(false)
              setDays(range.days)
            }}
            aria-pressed={!customRange && days === range.days}
          >
            {range.label}
          </Button>
        ))}

        <Button
          variant={customRange ? 'default' : 'glass'}
          size="sm"
          onClick={() => setCustomRange((current) => !current)}
          aria-pressed={customRange}
        >
          <CalendarRange className="size-3.5" />
          Custom
        </Button>

        {customRange ? (
          <div className="flex items-center gap-1.5">
            <Input
              type="date"
              value={customStart}
              max={customEnd || todayIso()}
              onChange={(event) => setCustomStart(event.target.value)}
              aria-label="Custom range start"
              className="h-9 w-auto"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <Input
              type="date"
              value={customEnd}
              min={customStart || undefined}
              max={todayIso()}
              onChange={(event) => setCustomEnd(event.target.value)}
              aria-label="Custom range end"
              className="h-9 w-auto"
            />
          </div>
        ) : null}

        <Select value={scope} onValueChange={setScope}>
          <SelectTrigger className="ml-1 w-64">
            <LayoutGrid className="size-3.5 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={OVERALL}>
              Overall — all {agents?.length ?? 0} agent{agents?.length === 1 ? '' : 's'}
            </SelectItem>
            {(agents ?? []).map((agent) => (
              <SelectItem key={agent.id} value={agent.id}>
                {agent.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {data ? (
          <span className="ml-auto text-xs text-foreground-subtle">
            {shortDate(`${data.range.start}T12:00:00Z`)} –{' '}
            {shortDate(`${data.range.end}T12:00:00Z`)} · {data.timezone}
          </span>
        ) : null}
      </div>

      {selectedAgent ? <AgentHeaderCard agent={selectedAgent} /> : null}

      {loading ? <LoadingState label="Loading dashboard…" /> : null}
      {error ? <ErrorState error={error} onRetry={reload} /> : null}

      {data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile
              label={selectedAgent ? 'Requests handled' : 'Total requests'}
              value={data.totals.total}
              icon={Inbox}
            />
            <StatTile
              label="Pending"
              value={data.totals.pending}
              icon={Clock}
              tint="warning"
            />
            <StatTile
              label="Completed"
              value={data.totals.completed}
              icon={CheckCircle2}
              tint="success"
            />
            <StatTile
              label="Cancelled"
              value={data.totals.cancelled}
              icon={CircleSlash}
              tint="muted"
            />
          </div>

          {scope === OVERALL && agentStats?.length ? (
            <AgentOverviewGrid stats={agentStats} onSelectAgent={setScope} />
          ) : null}

          <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
            <RequestVolumeChart data={data.volume} days={data.range.days} />
            <div className="flex flex-col gap-4">
              <ClosingTimePanel data={data.closing_time} />
              <ResolutionPanel data={data.resolution} />
            </div>
          </div>

          <RequestHeatmap
            byCategory={data.heatmap_by_category}
            byWeekday={data.heatmap_by_weekday}
            timezone={data.timezone}
          />
        </>
      ) : null}
    </div>
  )
}
