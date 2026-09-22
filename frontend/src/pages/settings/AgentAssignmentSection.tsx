import { BookOpen, Bot as BotIcon } from 'lucide-react'
import { useState } from 'react'

import { ErrorState, LoadingState } from '@/components/StateBlock'
import { Card } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useApi } from '@/hooks/useApi'
import { agentIconMap } from '@/lib/agentIcons'
import { api, ApiError } from '@/lib/api'
import type { Agent, KnowledgeBaseSummary, User } from '@/lib/types'
import { SectionHeader } from '@/pages/settings/shared'

const UNASSIGNED = 'unassigned'

function OwnerCell({ agent, users, onChanged }: { agent: Agent; users: User[]; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function assign(value: string) {
    setBusy(true)
    setError(null)
    try {
      await api.patch(`/agents/${agent.id}`, { owner_user_id: value === UNASSIGNED ? null : value })
      onChanged()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not update the owner')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <Select value={agent.owner_user_id ?? UNASSIGNED} onValueChange={(value) => void assign(value)} disabled={busy}>
        <SelectTrigger className="h-8 w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
          {users.map((person) => (
            <SelectItem key={person.id} value={person.id}>
              {person.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error ? <p className="mt-1 text-[11px] text-destructive">{error}</p> : null}
    </div>
  )
}

/**
 * Two related facts on one screen: which staff member is responsible for
 * each AI agent's configuration, and which knowledge base backs it. The
 * mapping itself is read-only here — it's enforced 1:1 by a unique
 * constraint (agents/models.py) and changed from the agent's own
 * configuration page, not re-editable from this summary.
 */
export function AgentAssignmentSection() {
  const { data: agents, error: agentsError, loading: agentsLoading, reload } = useApi<Agent[]>('/agents')
  // Requires manage_users specifically — a narrower permission than this
  // section's own manage_agents gate. An admin with one but not the other
  // would otherwise see a silently empty owner dropdown with no indication
  // why; surfacing the error here is the difference between that and an
  // honest "this list couldn't load."
  const { data: users, error: usersError } = useApi<User[]>('/users')
  const { data: knowledgeBases } = useApi<KnowledgeBaseSummary[]>('/knowledge-base/collections')

  const kbById = new Map((knowledgeBases ?? []).map((kb) => [kb.id, kb]))

  return (
    <Card className="gap-0 overflow-hidden p-0">
      <SectionHeader
        icon={BotIcon}
        title="Agents & knowledge base"
        description="Who owns each AI agent's configuration, and the knowledge base dedicated to it."
      />

      {usersError ? (
        <p className="px-5 pt-4 text-xs text-destructive" role="alert">
          Couldn't load the staff list, so owners can't be reassigned here right now: {usersError}
        </p>
      ) : null}

      {/* Guarded on `!agents`, not bare `agentsLoading`/`agentsError`: each
          row's OwnerCell calls this list's reload() right after its own
          assign() succeeds. An unguarded switch here would unmount every
          row — including another row's in-flight busy state or error
          message — the instant any one row's owner change succeeds. */}
      {agentsLoading && !agents ? (
        <LoadingState label="Loading agents…" />
      ) : agentsError && !agents ? (
        <ErrorState error={agentsError} onRetry={reload} />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agent</TableHead>
                <TableHead>Knowledge base</TableHead>
                <TableHead>Owner</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(agents ?? []).map((agent) => {
                const Icon = agentIconMap[agent.icon] ?? agentIconMap.Bot
                const kb = agent.knowledge_base_id ? kbById.get(agent.knowledge_base_id) : null
                return (
                  <TableRow key={agent.id}>
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
                          <Icon className="size-4" />
                        </span>
                        <span className="text-sm font-medium">{agent.name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        <BookOpen className="size-3.5" />
                        {kb?.name ?? '—'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <OwnerCell agent={agent} users={users ?? []} onChanged={reload} />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  )
}
