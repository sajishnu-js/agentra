import { Bot, Plus, Search, Workflow as WorkflowIcon } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { EmptyState, ErrorState, LoadingState } from '@/components/StateBlock'
import { WorkflowStatusPill } from '@/components/StatusPill'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useApi } from '@/hooks/useApi'
import { useTilt } from '@/hooks/useTilt'
import { api, ApiError } from '@/lib/api'
import { relativeTime, shortDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { Agent, Workflow } from '@/lib/types'

const NO_AGENT = '__none__'

function CreateWorkflowDialog({
  agents,
  defaultAgentId,
  onCreated,
}: {
  agents: Agent[]
  defaultAgentId: string | null
  onCreated: (workflow: Workflow) => void
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [agentId, setAgentId] = useState(defaultAgentId ?? NO_AGENT)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setName('')
    setDescription('')
    setAgentId(defaultAgentId ?? NO_AGENT)
    setError(null)
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim() || saving) return
    setSaving(true)
    setError(null)
    try {
      const created = await api.post<Workflow>('/workflows', {
        name: name.trim(),
        description: description.trim() || null,
        agent_id: agentId === NO_AGENT ? null : agentId,
        // Every workflow starts with a manual trigger already placed: an
        // empty canvas gives no hint about what a workflow even is, and this
        // is also the node the Test button runs from.
        graph: {
          nodes: [
            {
              id: 'trigger-1',
              kind: 'trigger',
              type: 'manual',
              position: { x: 80, y: 160 },
              config: {},
            },
          ],
          edges: [],
        },
      })
      setOpen(false)
      reset()
      onCreated(created)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not create this workflow')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Button
        onClick={() => {
          reset()
          setOpen(true)
        }}
      >
        <Plus className="size-4" />
        New Workflow
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New workflow</DialogTitle>
            <DialogDescription>
              Name it here — the visual builder opens right after.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="wf-name">Name</Label>
              <Input
                id="wf-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Escalate urgent compliance questions"
                autoFocus
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="wf-description">Description</Label>
              <Textarea
                id="wf-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What this automation is for"
                rows={2}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Agent (optional)</Label>
              <Select value={agentId} onValueChange={setAgentId}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_AGENT}>Not tied to one agent</SelectItem>
                  {agents.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      {agent.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {error ? (
              <p className="text-xs text-destructive" role="alert">
                {error}
              </p>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="glass" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={saving || !name.trim()}>
                {saving ? 'Creating…' : 'Create & build'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

function WorkflowCard({ workflow }: { workflow: Workflow }) {
  const tilt = useTilt<HTMLDivElement>(8)
  const nodeCount = workflow.graph?.nodes?.length ?? 0
  const triggers = (workflow.graph?.nodes ?? []).filter((node) => node.kind === 'trigger')

  return (
    <Card
      ref={tilt.ref}
      onMouseMove={tilt.onMouseMove}
      onMouseLeave={tilt.onMouseLeave}
      className="tilt-3d gap-0 p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="grid size-10 place-items-center rounded-lg bg-primary text-primary-foreground shadow-glow">
          <WorkflowIcon className="size-5" />
        </span>
        <WorkflowStatusPill status={workflow.status} />
      </div>

      <p className="mt-4 text-sm font-semibold">{workflow.name}</p>
      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
        {workflow.description ?? 'No description'}
      </p>

      {triggers.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1">
          {triggers.slice(0, 3).map((trigger) => (
            <Badge key={trigger.id} variant="outline" className="h-5 px-1.5 text-[10px]">
              {trigger.type.replace(/_/g, ' ')}
            </Badge>
          ))}
        </div>
      ) : null}

      {workflow.agent ? (
        <div className="mt-3 flex min-w-0 items-center gap-1.5 border-t border-border pt-3">
          <Bot className="size-4 shrink-0 text-brand-text" />
          <span className="agent-name min-w-0 truncate text-[0.9375rem]" title={workflow.agent.name}>
            {workflow.agent.name}
          </span>
        </div>
      ) : null}

      <div
        className={cn(
          'flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-foreground-subtle',
          workflow.agent ? 'mt-2' : 'mt-4 border-t border-border pt-3',
        )}
      >
        <span>{nodeCount} node{nodeCount === 1 ? '' : 's'}</span>
        <span>{workflow.execution_count} run{workflow.execution_count === 1 ? '' : 's'}</span>
        <span className="ml-auto whitespace-nowrap">
          {workflow.last_execution_at
            ? `ran ${relativeTime(workflow.last_execution_at)} ago`
            : `since ${shortDate(workflow.created_at)}`}
        </span>
      </div>

      <Button variant="glass" size="sm" className="mt-4" asChild>
        <Link to={`/app/workflows/${workflow.id}`}>
          <WorkflowIcon className="size-3.5" />
          Open builder
        </Link>
      </Button>
    </Card>
  )
}

export function Workflows() {
  const navigate = useNavigate()
  // ?agent=<id> is how an agent's own "Workflow" button lands here — the
  // list arrives pre-filtered to that agent rather than making someone find
  // it among everything else.
  const [searchParams, setSearchParams] = useSearchParams()
  const agentFilter = searchParams.get('agent')
  const [query, setQuery] = useState('')

  const { data: agents } = useApi<Agent[]>('/agents')
  const { data, error, loading, reload } = useApi<Workflow[]>(
    agentFilter ? `/workflows?agent_id=${agentFilter}` : '/workflows',
  )

  const selectedAgent = (agents ?? []).find((agent) => agent.id === agentFilter) ?? null
  const trimmed = query.trim().toLowerCase()
  const visible = trimmed
    ? (data ?? []).filter((workflow) => workflow.name.toLowerCase().includes(trimmed))
    : (data ?? [])

  // Guarded on `!data` rather than bare `loading`: CreateWorkflowDialog and
  // the filter both trigger a reload, and an unguarded early return would
  // unmount the dialog mid-submit.
  if (loading && !data) return <LoadingState label="Loading workflows…" />
  if (error && !data) return <ErrorState error={error} onRetry={reload} />

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-foreground-subtle" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search workflows…"
            className="pl-9"
          />
        </div>

        <Select
          value={agentFilter ?? NO_AGENT}
          onValueChange={(value) =>
            setSearchParams(value === NO_AGENT ? {} : { agent: value }, { replace: true })
          }
        >
          <SelectTrigger className="w-60">
            <Bot className="size-3.5 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_AGENT}>All workflows</SelectItem>
            {(agents ?? []).map((agent) => (
              <SelectItem key={agent.id} value={agent.id}>
                {agent.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <CreateWorkflowDialog
          agents={agents ?? []}
          defaultAgentId={agentFilter}
          onCreated={(workflow) => {
            reload()
            navigate(`/app/workflows/${workflow.id}`)
          }}
        />
      </div>

      {selectedAgent ? (
        <Card className="flex-row items-center gap-3 p-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand-text">
            <Bot className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="agent-name truncate text-base" title={selectedAgent.name}>
              {selectedAgent.name}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              Showing only this agent's workflows.
            </p>
          </div>
          <Button variant="glass" size="sm" className="shrink-0" asChild>
            <Link to={`/app/agents/${selectedAgent.id}`}>Configure agent</Link>
          </Button>
        </Card>
      ) : null}

      {visible.length === 0 ? (
        <Card>
          <EmptyState
            title={trimmed ? 'No matches' : 'No workflows yet'}
            description={
              trimmed
                ? `Nothing matches "${query.trim()}".`
                : 'Build one to automate what happens when a message, request or handover comes in.'
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((workflow) => (
            <WorkflowCard key={workflow.id} workflow={workflow} />
          ))}
        </div>
      )}
    </div>
  )
}
