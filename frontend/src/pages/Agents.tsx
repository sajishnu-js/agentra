import {
  Copy,
  Loader2,
  Plus,
  Settings2,
  Sparkles,
  Thermometer,
  Workflow as WorkflowIcon,
} from 'lucide-react'
import type { FormEvent } from 'react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { AgentStatusPill } from '@/components/StatusPill'
import { EmptyState, ErrorState, LoadingState } from '@/components/StateBlock'
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
import { agentIconMap } from '@/lib/agentIcons'
import { api, ApiError } from '@/lib/api'
import { shortDate } from '@/lib/format'
import type { Agent, KnowledgeBaseSummary } from '@/lib/types'

function KnowledgeBaseSelect({
  value,
  onChange,
  id,
  options,
}: {
  value: string
  onChange: (value: string) => void
  id: string
  options: KnowledgeBaseSummary[]
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder="Choose a knowledge base…" />
      </SelectTrigger>
      <SelectContent>
        {options.map((kb) => (
          <SelectItem key={kb.id} value={kb.id}>
            {kb.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/**
 * Create a new agent with just a name, description and knowledge base — the
 * full configuration (prompt, guardrails, tools, behaviour, memory,
 * fallback, tokens...) lives on the dedicated /app/agents/:id page now, so
 * this dialog stays a quick "name it" step rather than duplicating that
 * whole surface. Navigates straight to the new agent's config page on
 * success, since that's where the real setup happens next.
 *
 * A knowledge base is required, not optional: every agent has exactly one
 * dedicated one (see the unique constraint backing agents.knowledge_base_id).
 * The picker only offers ones nothing else has already claimed, so the
 * 400 that same constraint would otherwise produce never has a chance to
 * surface here.
 */
function CreateAgentDialog({ onCreated }: { onCreated: () => void }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [knowledgeBaseId, setKnowledgeBaseId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fetched fresh each time this renders — only ever mounted while open, so
  // there is no idle polling to avoid.
  const { data: knowledgeBases } = useApi<KnowledgeBaseSummary[]>(
    open ? '/knowledge-base/collections' : null,
  )
  const availableKnowledgeBases = (knowledgeBases ?? []).filter((kb) => kb.agents.length === 0)

  function reset() {
    setName('')
    setDescription('')
    setKnowledgeBaseId('')
    setError(null)
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim() || !knowledgeBaseId || saving) return
    setSaving(true)
    setError(null)
    try {
      const created = await api.post<Agent>('/agents', {
        name: name.trim(),
        description: description.trim() || undefined,
        knowledge_base_id: knowledgeBaseId,
      })
      onCreated()
      setOpen(false)
      reset()
      navigate(`/app/agents/${created.id}`)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not create agent')
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
        New Agent
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New agent</DialogTitle>
            <DialogDescription>
              Name it here — the full configuration opens right after.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="agent-create-name">Name</Label>
              <Input
                id="agent-create-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Front Desk Assistant"
                autoFocus
                required
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="agent-create-description">Description</Label>
              <Textarea
                id="agent-create-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What this agent is for"
                rows={2}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="agent-create-kb">Knowledge base</Label>
              <KnowledgeBaseSelect
                id="agent-create-kb"
                value={knowledgeBaseId}
                onChange={setKnowledgeBaseId}
                options={availableKnowledgeBases}
              />
              {knowledgeBases && availableKnowledgeBases.length === 0 ? (
                <p className="text-xs text-foreground-subtle">
                  Every knowledge base is already dedicated to another agent — create a
                  new one from the Knowledge Base screen first.
                </p>
              ) : null}
            </div>

            {error ? (
              <p className="text-xs text-destructive" role="alert">
                {error}
              </p>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="glass"
                size="sm"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={saving || !name.trim() || !knowledgeBaseId}>
                {saving ? 'Creating…' : 'Create & configure'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

function AgentCard({ agent }: { agent: Agent }) {
  const tilt = useTilt<HTMLDivElement>(8)
  const navigate = useNavigate()
  const Icon = agentIconMap[agent.icon] ?? agentIconMap.Bot
  const [duplicating, setDuplicating] = useState(false)
  const [duplicateError, setDuplicateError] = useState<string | null>(null)

  // Clones land in draft (see duplicate_agent's docstring) and need a
  // knowledge base assigned before they can go live — sent straight to its
  // config page, same as a brand-new agent from CreateAgentDialog, so that
  // next required step is never a hunt back through the list.
  async function handleDuplicate() {
    if (duplicating) return
    setDuplicating(true)
    setDuplicateError(null)
    try {
      const clone = await api.post<Agent>(`/agents/${agent.id}/duplicate`, {})
      navigate(`/app/agents/${clone.id}`)
    } catch (caught) {
      setDuplicateError(caught instanceof ApiError ? caught.message : 'Could not duplicate this agent')
      setDuplicating(false)
    }
  }

  return (
    <Card
      ref={tilt.ref}
      onMouseMove={tilt.onMouseMove}
      onMouseLeave={tilt.onMouseLeave}
      className="tilt-3d gap-0 p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="grid size-10 place-items-center rounded-lg bg-primary text-primary-foreground shadow-glow">
          <Icon className="size-5" />
        </span>
        <AgentStatusPill status={agent.status} />
      </div>

      <p className="mt-4 text-sm font-semibold">{agent.name}</p>
      <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">
        {agent.description}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-3 text-[11px] text-foreground-subtle">
        <span className="flex items-center gap-1">
          <Sparkles className="size-3" />
          {agent.model}
        </span>
        <span className="flex items-center gap-1">
          <Thermometer className="size-3" />
          {agent.temperature}
        </span>
        <span className="ml-auto">since {shortDate(agent.created_at)}</span>
      </div>

      {duplicateError ? (
        <p className="mt-2 text-[11px] text-destructive" role="alert">
          {duplicateError}
        </p>
      ) : null}

      {/* flex-wrap plus min-w-0 on the two link buttons: at narrower card
          widths the three actions no longer overflow the card, they drop the
          duplicate button onto a second line. */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button variant="glass" size="sm" className="min-w-0 flex-1" asChild>
          <Link to={`/app/agents/${agent.id}`}>
            <Settings2 className="size-3.5 shrink-0" />
            <span className="truncate">Configure</span>
          </Link>
        </Button>
        {/* ?agent= pre-filters the Workflow section to this agent, so
            "Workflow" from here lands on its automations rather than the
            full workspace list. */}
        <Button variant="glass" size="sm" className="min-w-0 flex-1" asChild>
          <Link to={`/app/workflows?agent=${agent.id}`}>
            <WorkflowIcon className="size-3.5 shrink-0" />
            <span className="truncate">Workflow</span>
          </Link>
        </Button>
        <Button
          variant="glass"
          size="icon-sm"
          className="shrink-0"
          title="Duplicate this agent"
          aria-label="Duplicate this agent"
          disabled={duplicating}
          onClick={handleDuplicate}
        >
          {duplicating ? <Loader2 className="size-3.5 animate-spin" /> : <Copy className="size-3.5" />}
        </Button>
      </div>
    </Card>
  )
}

export function Agents() {
  const { data, error, loading, reload } = useApi<Agent[]>('/agents')

  if (loading) return <LoadingState label="Loading agents…" />
  if (error) return <ErrorState error={error} onRetry={reload} />

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <CreateAgentDialog onCreated={reload} />
      </div>

      {!data?.length ? (
        <Card>
          <EmptyState
            title="No agents yet"
            description="Create an agent to start answering automatically."
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.map((agent) => (
            <AgentCard key={agent.id} agent={agent} />
          ))}
        </div>
      )}
    </div>
  )
}
