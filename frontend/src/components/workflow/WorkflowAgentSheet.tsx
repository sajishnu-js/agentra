import { Loader2, Power, Save, Settings2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import {
  AgentConfigFields,
  type AgentDraft,
  agentDraftToPayload,
  toAgentDraft,
} from '@/components/agent/AgentConfigFields'
import { AgentStatusPill } from '@/components/StatusPill'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { api, ApiError } from '@/lib/api'
import type { Agent, AgentStatus } from '@/lib/types'

/**
 * Editing an agent from inside the Workflow section.
 *
 * Deliberately the *same* agent row, the same `PATCH /agents/{id}`, and the
 * same field definitions the Agents page uses (AgentConfigFields) — so this
 * is a second way into one agent, never a second agent. Nothing here can
 * create one.
 */
export function WorkflowAgentSheet({
  agent,
  open,
  onOpenChange,
  onSaved,
}: {
  agent: Agent
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  // Keyed remount by the parent means this initialiser is the whole reset
  // story — switching the workflow's agent gives a fresh draft rather than
  // carrying the previous agent's edits across.
  const [draft, setDraft] = useState<AgentDraft>(() => toAgentDraft(agent))
  const [saving, setSaving] = useState<'save' | 'status' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  function set<K extends keyof AgentDraft>(key: K, value: AgentDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
    setSaved(false)
  }

  async function handleSave() {
    setSaving('save')
    setError(null)
    try {
      const updated = await api.patch<Agent>(`/agents/${agent.id}`, agentDraftToPayload(draft))
      setDraft(toAgentDraft(updated))
      setSaved(true)
      onSaved()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not save this agent')
    } finally {
      setSaving(null)
    }
  }

  // Immediate, not staged with the rest of the form — same reasoning as the
  // Agent Configuration page: this is a live operational switch.
  async function handleToggleStatus() {
    const next: AgentStatus = draft.status === 'active' ? 'paused' : 'active'
    setSaving('status')
    setError(null)
    try {
      const updated = await api.patch<Agent>(`/agents/${agent.id}`, { status: next })
      setDraft((current) => ({ ...current, status: updated.status }))
      onSaved()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not change status')
    } finally {
      setSaving(null)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl">
        <SheetHeader className="p-5">
          <SheetTitle className="flex min-w-0 items-center gap-2">
            <Settings2 className="size-4 shrink-0 text-brand-text" />
            <span className="agent-name min-w-0 text-lg break-words" title={agent.name}>
              {agent.name}
            </span>
          </SheetTitle>
          <SheetDescription>
            The same agent as on the Agents page — edits here update that one record, so the
            two sections never diverge.
          </SheetDescription>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <AgentStatusPill status={draft.status} />
            <Button variant="glass" size="sm" asChild>
              <Link to={`/app/agents/${agent.id}`}>Open full configuration</Link>
            </Button>
          </div>
        </SheetHeader>
        <Separator />

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <AgentConfigFields draft={draft} set={set} />
        </div>

        <Separator />
        <div className="flex flex-wrap items-center gap-2 p-4">
          {error ? (
            <p className="min-w-0 flex-1 text-xs text-destructive" role="alert">
              {error}
            </p>
          ) : saved ? (
            <p className="min-w-0 flex-1 text-xs text-success">Saved.</p>
          ) : (
            <span className="min-w-0 flex-1" />
          )}
          <Button
            variant="glass"
            size="sm"
            onClick={handleToggleStatus}
            disabled={saving !== null}
          >
            <Power className="size-3.5" />
            {draft.status === 'active' ? 'Disable' : 'Enable'}
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving !== null || !draft.name.trim()}>
            {saving === 'save' ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            Save agent
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
