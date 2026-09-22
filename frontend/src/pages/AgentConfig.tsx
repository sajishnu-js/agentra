import {
  ArrowLeft,
  Loader2,
  Play,
  Power,
  RotateCcw,
  Rocket,
  Save,
  Send,
  Sparkles,
  UserRound,
  Workflow as WorkflowIcon,
} from 'lucide-react'
import { type FormEvent, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import {
  AgentConfigFields,
  type AgentDraft as Draft,
  agentDraftToPayload as draftToPayload,
  toAgentDraft as toDraft,
} from '@/components/agent/AgentConfigFields'
import { EmptyState, ErrorState, LoadingState } from '@/components/StateBlock'
import { AgentStatusPill } from '@/components/StatusPill'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { useApi } from '@/hooks/useApi'
import { useRequireDeleteConfirmation } from '@/hooks/useRequireDeleteConfirmation'
import { agentIconMap } from '@/lib/agentIcons'
import { api, ApiError } from '@/lib/api'
import { cn } from '@/lib/utils'
import type {
  Agent,
  AgentStatus,
  AgentTestResponse,
  AgentTestTurn,
} from '@/lib/types'
// Renamed on import: v4's actual exports are Group/Panel/Separator, not the
// PanelGroup/PanelResizeHandle names older versions of this library used —
// aliased here so the JSX below reads clearly and `Separator` doesn't
// collide with the shadcn `Separator` already imported above.
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from 'react-resizable-panels'

/**
 * The live test chat. Takes the in-memory draft, not the saved agent — every
 * send hits POST /agents/test with whatever is currently in the form, which
 * is the entire point of testing before saving. Turn history lives only in
 * this component's state; nothing here is persisted.
 */
function TestEnvironment({
  draft,
  agentName,
  resetSignal,
  inputRef,
}: {
  draft: Draft
  agentName: string
  resetSignal: number
  inputRef: React.RefObject<HTMLInputElement | null>
}) {
  const [turns, setTurns] = useState<(AgentTestTurn & { meta?: AgentTestResponse })[]>([])
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastResetSignal, setLastResetSignal] = useState(resetSignal)

  // Reset is driven from the parent's action bar, not a prop the child
  // re-renders on its own — a plain effect-free comparison during render
  // keeps this in sync without an extra useEffect.
  if (resetSignal !== lastResetSignal) {
    setLastResetSignal(resetSignal)
    setTurns([])
    setError(null)
  }

  async function handleSend(event: FormEvent) {
    event.preventDefault()
    const text = message.trim()
    if (!text || sending) return
    setSending(true)
    setError(null)
    const nextTurns: AgentTestTurn[] = [...turns, { role: 'customer', text }]
    setTurns(nextTurns)
    setMessage('')
    try {
      const response = await api.post<AgentTestResponse>('/agents/test', {
        message: text,
        history: turns,
        config: {
          system_prompt: draft.system_prompt,
          guardrails: draft.guardrails,
          response_behaviour: draft.response_behaviour,
          temperature: draft.temperature,
          model: draft.model,
          knowledge_base_id: draft.knowledge_base_id,
          context_history_limit: draft.context_history_limit,
          max_output_tokens: draft.max_output_tokens,
        },
      })
      setTurns([...nextTurns, { role: 'business', text: response.reply, meta: response }])
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not reach the test endpoint')
    } finally {
      setSending(false)
    }
  }

  return (
    <Card className="flex h-full min-h-0 flex-col gap-0 p-0">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand-text">
          <Play className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">Test Environment</p>
          <p className="truncate text-[11px] text-foreground-subtle">
            Testing the draft below, not the saved version
          </p>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        {turns.length === 0 ? (
          <EmptyState
            title="Try it out"
            description={`Send a message as a customer would, and see how ${agentName || 'this agent'} responds with the settings on the left.`}
          />
        ) : (
          <div className="mt-auto flex flex-col gap-3">
            {turns.map((turn, index) => {
              const outgoing = turn.role === 'business'
              return (
                <div
                  key={index}
                  className={cn('flex flex-col gap-1', outgoing ? 'items-end' : 'items-start')}
                >
                  <div
                    className={cn(
                      'flex max-w-[85%] flex-col gap-1 px-3.5 py-2.5 text-sm',
                      outgoing
                        ? 'btn-glossy rounded-2xl rounded-br-md bg-primary text-primary-foreground shadow-[0_2px_10px_-2px_var(--brand-glow)]'
                        : 'rounded-2xl rounded-bl-md glass-inset text-foreground',
                    )}
                  >
                    <span className="flex items-center gap-1.5 text-[11px] opacity-80">
                      {outgoing ? (
                        <>
                          <Sparkles className="size-3" />
                          {agentName || 'Agent'}
                        </>
                      ) : (
                        <>
                          <UserRound className="size-3" />
                          Test customer
                        </>
                      )}
                    </span>
                    <span>{turn.text}</span>
                  </div>
                  {turn.meta ? (
                    <span className="flex items-center gap-1.5 px-1 text-[10px] text-foreground-subtle">
                      <span className="capitalize">{turn.meta.confidence} confidence</span>
                      {turn.meta.sources?.length ? (
                        <span>· {turn.meta.sources.length} source{turn.meta.sources.length === 1 ? '' : 's'}</span>
                      ) : (
                        <span>· no knowledge base match</span>
                      )}
                    </span>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {error ? (
        <p className="px-4 pb-1 text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <Separator />
      <form onSubmit={handleSend} className="flex items-center gap-2 p-3">
        <Input
          ref={inputRef}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Type a test message…"
          disabled={sending}
          autoComplete="off"
        />
        <Button type="submit" size="icon" disabled={sending || !message.trim()}>
          {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        </Button>
      </form>
    </Card>
  )
}

function AgentConfigEditor({ agent, onReload }: { agent: Agent; onReload: () => void }) {
  const navigate = useNavigate()
  const [draft, setDraft] = useState<Draft>(() => toDraft(agent))
  const [saving, setSaving] = useState<'save' | 'publish' | 'enable' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [resetSignal, setResetSignal] = useState(0)
  const testInputRef = useRef<HTMLInputElement>(null)
  const requireConfirmation = useRequireDeleteConfirmation()

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
  }


  async function persist(overrides: Partial<Draft> = {}, which: 'save' | 'publish' = 'save') {
    setSaving(which)
    setError(null)
    try {
      const merged = { ...draft, ...overrides }
      const updated = await api.patch<Agent>(`/agents/${agent.id}`, draftToPayload(merged))
      setDraft(toDraft(updated))
      onReload()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not save changes')
    } finally {
      setSaving(null)
    }
  }

  async function handleEnableDisable() {
    const nextStatus: AgentStatus = draft.status === 'active' ? 'paused' : 'active'
    setSaving('enable')
    setError(null)
    try {
      const updated = await api.patch<Agent>(`/agents/${agent.id}`, { status: nextStatus })
      setDraft((current) => ({ ...current, status: updated.status }))
      onReload()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not change status')
    } finally {
      setSaving(null)
    }
  }

  function handleReset() {
    setDraft(toDraft(agent))
    setError(null)
    setResetSignal((n) => n + 1)
  }

  async function handleDelete() {
    if (requireConfirmation && !window.confirm(`Delete "${agent.name}"? This cannot be undone.`))
      return
    try {
      await api.delete(`/agents/${agent.id}`)
      navigate('/app/agents')
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not delete this agent')
    }
  }

  const Icon = agentIconMap[draft.icon] ?? agentIconMap.Bot

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* ---- sticky action bar ---- */}
      <Card className="flex-row flex-wrap items-center gap-3 p-4">
        <Button variant="glass" size="sm" asChild>
          <Link to="/app/agents">
            <ArrowLeft className="size-3.5" />
            Agents
          </Link>
        </Button>
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground shadow-glow">
          <Icon className="size-4.5" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{agent.name}</p>
          <AgentStatusPill status={draft.status} />
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {/* Opens the Workflow section already scoped to this agent — the
              two sections read the same Agent rows, so nothing is duplicated
              by moving between them. */}
          <Button variant="glass" size="sm" asChild>
            <Link to={`/app/workflows?agent=${agent.id}`}>
              <WorkflowIcon className="size-3.5" />
              Workflow
            </Link>
          </Button>
          <Button variant="glass" size="sm" onClick={handleReset} disabled={saving !== null}>
            <RotateCcw className="size-3.5" />
            Reset
          </Button>
          <Button
            variant="glass"
            size="sm"
            onClick={() => testInputRef.current?.focus()}
          >
            <Play className="size-3.5" />
            Test
          </Button>
          <Button
            variant="glass"
            size="sm"
            onClick={handleEnableDisable}
            disabled={saving !== null}
          >
            <Power className="size-3.5" />
            {draft.status === 'active' ? 'Disable' : 'Enable'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => persist({}, 'save')}
            disabled={saving !== null || !draft.name.trim()}
          >
            {saving === 'save' ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            Save
          </Button>
          <Button
            size="sm"
            onClick={() => persist({ status: 'active' }, 'publish')}
            disabled={saving !== null || !draft.name.trim()}
          >
            {saving === 'publish' ? <Loader2 className="size-3.5 animate-spin" /> : <Rocket className="size-3.5" />}
            Publish
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={handleDelete}
          >
            Delete
          </Button>
        </div>
      </Card>

      {error ? (
        <p className="px-1 text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      {/* ---- resizable split: config form | test environment ---- */}
      <div className="min-h-0 flex-1">
        <PanelGroup orientation="horizontal" className="!flex gap-0">
          <Panel defaultSize={62} minSize={38}>
            <Card className="h-full overflow-y-auto p-6">
              <AgentConfigFields draft={draft} set={set} />
            </Card>
          </Panel>

          <PanelResizeHandle className="group mx-2 flex w-1 items-center justify-center rounded-full transition-colors hover:bg-brand/30">
            <span className="h-10 w-[3px] rounded-full bg-border transition-colors group-hover:bg-brand/60" />
          </PanelResizeHandle>

          <Panel defaultSize={38} minSize={26}>
            <TestEnvironment
              draft={draft}
              agentName={draft.name}
              resetSignal={resetSignal}
              inputRef={testInputRef}
            />
          </Panel>
        </PanelGroup>
      </div>
    </div>
  )
}

export function AgentConfig() {
  const { agentId } = useParams<{ agentId: string }>()
  const { data, error, loading, reload } = useApi<Agent>(agentId ? `/agents/${agentId}` : null)

  // Guarded on `!data`, not bare `loading`/`error`: AgentConfigEditor's own
  // Save/Publish/Enable-Disable actions call onReload() (this reload) right
  // after succeeding. An unguarded early return here would unmount the whole
  // editor — including the in-progress draft and the TestEnvironment's live
  // test-chat history — on literally every save. Once real data exists, keep
  // rendering it through a background refresh instead of tearing it down.
  if (loading && !data) return <LoadingState label="Loading agent…" />
  if (error && !data) return <ErrorState error={error} onRetry={reload} />
  if (!data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Agent not found</CardTitle>
          <CardDescription>It may have been deleted.</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  // Keyed by id: navigating from one agent's config page to another (e.g. via
  // browser back/forward) remounts this instead of carrying over the
  // previous agent's unsaved draft state.
  return <AgentConfigEditor key={data.id} agent={data} onReload={reload} />
}
