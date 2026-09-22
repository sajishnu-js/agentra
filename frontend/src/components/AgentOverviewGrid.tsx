import { MessagesSquare, Ticket } from 'lucide-react'

import { Card } from '@/components/ui/card'
import { useTilt } from '@/hooks/useTilt'
import { agentIconMap } from '@/lib/agentIcons'
import type { AgentSummaryStat } from '@/lib/types'
import { cn } from '@/lib/utils'

/**
 * One tilt-responsive card per agent, real counts from
 * /analytics/agents-summary — conversations, messages, open requests, and
 * how often a reply actually cited the knowledge base. Clicking a card is
 * the drill-down: it hands the agent id up to Home, which re-fetches every
 * other panel scoped to just that agent — the same result as picking it
 * from the dropdown, just from the data itself.
 */
function AgentOverviewCard({
  stat,
  onSelect,
}: {
  stat: AgentSummaryStat
  onSelect: () => void
}) {
  const tilt = useTilt<HTMLButtonElement>(10)
  const Icon = agentIconMap[stat.icon] ?? agentIconMap.Bot
  const citationPercent = Math.round(stat.kb_citation_rate * 100)

  return (
    <button
      ref={tilt.ref}
      onMouseMove={tilt.onMouseMove}
      onMouseLeave={tilt.onMouseLeave}
      onClick={onSelect}
      type="button"
      // min-w-0: a grid item defaults to min-width:auto, so without this the
      // card refuses to shrink below its longest line and the whole 5-column
      // row overflows. overflow-hidden clips the corner glow below, which is
      // positioned outside the box and was pushing the grid 24px wide.
      className="tilt-3d glass-interactive group relative flex min-w-0 flex-col gap-3 overflow-hidden rounded-2xl p-4 text-left transition-transform hover:-translate-y-0.5"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-glow">
          <Icon className="size-4.5" />
        </span>
        <p className="min-w-0 truncate text-sm font-semibold" title={stat.agent_name}>
          {stat.agent_name}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex min-w-0 items-center gap-1.5">
          <MessagesSquare className="size-3.5 shrink-0" />
          <span className="truncate">
            {stat.conversations} conv · {stat.messages_in + stat.messages_out} msgs
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          <Ticket className="size-3.5 shrink-0" />
          {stat.requests_pending} open
        </span>
      </div>

      <div>
        <div className="flex items-center justify-between text-[10px] tracking-wide text-foreground-subtle uppercase">
          <span>Grounded in KB</span>
          <span className="tabular-nums">{citationPercent}%</span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-gradient-to-r from-brand to-brand-2 transition-[width] duration-700 ease-out"
            style={{ width: `${citationPercent}%` }}
          />
        </div>
      </div>

      <span
        aria-hidden
        className={cn(
          'ambient-glow absolute -top-6 -right-6 -z-10 size-24 bg-brand opacity-0 transition-opacity duration-300',
          'group-hover:opacity-20',
        )}
      />
    </button>
  )
}

export function AgentOverviewGrid({
  stats,
  onSelectAgent,
}: {
  stats: AgentSummaryStat[]
  onSelectAgent: (agentId: string) => void
}) {
  if (!stats.length) return null

  return (
    <Card className="gap-3 p-5">
      <div>
        <p className="text-sm font-semibold">Agents at a glance</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Click an agent to see its own view — real activity for the selected window.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {stats.map((stat) => (
          <AgentOverviewCard key={stat.agent_id} stat={stat} onSelect={() => onSelectAgent(stat.agent_id)} />
        ))}
      </div>
    </Card>
  )
}
