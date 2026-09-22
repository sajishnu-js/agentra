import {
  addEdge,
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  CheckCircle2,
  Copy,
  History,
  Loader2,
  Play,
  Plus,
  Power,
  RotateCcw,
  Save,
  Settings2,
  ShieldCheck,
  Redo2,
  Undo2,
  Webhook,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { ErrorState, LoadingState } from '@/components/StateBlock'
import {
  ExecutionStatusPill,
  StepStatusPill,
  WorkflowStatusPill,
} from '@/components/StatusPill'
import { NodePropertiesPanel } from '@/components/workflow/NodePropertiesPanel'
import { WorkflowAgentSheet } from '@/components/workflow/WorkflowAgentSheet'
import { WorkflowCanvasNode } from '@/components/workflow/WorkflowCanvasNode'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { useApi } from '@/hooks/useApi'
import { useRequireDeleteConfirmation } from '@/hooks/useRequireDeleteConfirmation'
import { api, ApiError } from '@/lib/api'
import { longDateTime, relativeTime } from '@/lib/format'
import { nodeKindStyles, workflowNodeFallbackIcon, workflowNodeIcons } from '@/lib/workflowNodes'
import type {
  Agent,
  ConversationListItem,
  User,
  ValidationResult,
  Workflow,
  WorkflowCatalog,
  WorkflowExecution,
  WorkflowNodeConfig,
  WorkflowNodeData,
  WorkflowNodeKind,
  WorkflowVersion,
} from '@/lib/types'
import { cn } from '@/lib/utils'

const nodeTypes = { agentraNode: WorkflowCanvasNode }
const NO_AGENT = '__none__'

/** Everything an undo has to put back. `kinds` is included because deleting
 * a node also drops its entry from the kind lookup — restoring the node
 * without it would leave the canvas unable to say what type it was. */
type Snapshot = {
  nodes: Node[]
  edges: Edge[]
  config: Record<string, WorkflowNodeConfig>
  kinds: Record<string, { kind: WorkflowNodeKind; type: string }>
}

/** How many edits back you can go. Well past what anyone reaches for, and
 * still trivial memory for graphs this size. */
const HISTORY_LIMIT = 50

/** The one-line gist shown on the node itself, so the canvas is readable
 * without opening every property panel. */
function summarize(node: WorkflowNodeData): string {
  const config = node.config ?? {}
  if (node.kind === 'condition') {
    const groups = Array.isArray(config.groups) ? config.groups : []
    const count = groups.reduce(
      (total: number, group: { rules?: unknown[] }) => total + (group.rules?.length ?? 0),
      Array.isArray(config.rules) ? config.rules.length : 0,
    )
    return count ? `${count} check${count === 1 ? '' : 's'}` : 'No checks yet'
  }
  if (node.kind === 'delay') return config.minutes ? `${config.minutes} minute(s)` : 'No duration'
  if (node.kind === 'approval') return String(config.title || 'Approval request')
  const preview = config.text ?? config.tag ?? config.title ?? config.url ?? config.status ?? config.value
  return preview ? String(preview).slice(0, 60) : ''
}

// A node is w-60 (240px) and roughly 90px tall. Anything closer than this
// overlaps enough to bury the neighbour's connection handles, which makes
// the graph impossible to wire up by dragging.
const NODE_WIDTH = 330
const NODE_HEIGHT = 130

/** One node-width right of the rightmost node, vertically aligned with it. */
function nextSpot(existing: Node[]): { x: number; y: number } {
  if (existing.length === 0) return { x: 80, y: 160 }
  const rightmost = existing.reduce((furthest, node) =>
    node.position.x > furthest.position.x ? node : furthest,
  )
  return { x: rightmost.position.x + NODE_WIDTH, y: rightmost.position.y }
}

/** The first spot at or below `base` that doesn't collide with an existing
 * node — so adding several nodes in a row cascades instead of stacking them
 * all on top of each other. */
function freeSpot(base: { x: number; y: number }, existing: Node[]): { x: number; y: number } {
  const candidate = { ...base }
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const collides = existing.some(
      (node) =>
        Math.abs(node.position.x - candidate.x) < NODE_WIDTH &&
        Math.abs(node.position.y - candidate.y) < NODE_HEIGHT,
    )
    if (!collides) return candidate
    candidate.x += NODE_WIDTH
    // Wrap to a new row rather than marching off to the right forever.
    if (candidate.x > base.x + NODE_WIDTH * 2) {
      candidate.x = base.x
      candidate.y += NODE_HEIGHT
    }
  }
  return candidate
}

function labelFor(node: WorkflowNodeData, catalog: WorkflowCatalog | null): string {
  if (!catalog) return node.type || node.kind
  const entry =
    node.kind === 'trigger'
      ? catalog.triggers.find((t) => t.key === node.type)
      : node.kind === 'action'
        ? catalog.actions.find((a) => a.key === node.type)
        : catalog.flow_nodes.find((f) => f.key === node.kind)
  return entry?.label ?? node.type ?? node.kind
}

function toCanvasNodes(
  graph: WorkflowNodeData[],
  catalog: WorkflowCatalog | null,
  invalidIds: Set<string>,
): Node[] {
  return graph.map((node) => ({
    id: node.id,
    type: 'agentraNode',
    position: node.position,
    data: {
      kind: node.kind,
      type: node.type,
      label: labelFor(node, catalog),
      summary: summarize(node),
      invalid: invalidIds.has(node.id),
    },
  }))
}

function PaletteButton({
  nodeKey,
  kind,
  label,
  description,
  onAdd,
}: {
  nodeKey: string
  kind: WorkflowNodeKind
  label: string
  description: string
  onAdd: (kind: WorkflowNodeKind, type: string) => void
}) {
  const Icon = workflowNodeIcons[nodeKey] ?? workflowNodeFallbackIcon
  const style = nodeKindStyles[kind]
  return (
    <button
      type="button"
      onClick={() => onAdd(kind, kind === 'trigger' || kind === 'action' ? nodeKey : '')}
      title={description}
      className="flex w-full items-start gap-2 rounded-lg border border-border p-2 text-left transition-colors hover:border-brand/40 hover:bg-accent/50"
    >
      <span className={cn('grid size-6 shrink-0 place-items-center rounded-md', style.chip)}>
        <Icon className="size-3" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11px] font-medium">{label}</span>
      </span>
    </button>
  )
}

function ExecutionList({ workflowId }: { workflowId: string }) {
  // Polled: a run parked on a delay is resumed by the backend scheduler, so
  // its status changes with nothing happening in this tab.
  const { data, loading } = useApi<WorkflowExecution[]>(
    `/workflows/${workflowId}/executions?limit=25`,
    { pollMs: 10000 },
  )
  const [expanded, setExpanded] = useState<string | null>(null)
  const [retrying, setRetrying] = useState<string | null>(null)

  async function handleRetry(executionId: string) {
    setRetrying(executionId)
    try {
      await api.post(`/workflows/${workflowId}/executions/${executionId}/retry`, {})
    } catch {
      // Surfaced by the row's own status on the next poll.
    } finally {
      setRetrying(null)
    }
  }

  if (loading && !data) return <p className="p-4 text-xs text-muted-foreground">Loading runs…</p>
  if (!data?.length)
    return (
      <p className="p-4 text-xs text-muted-foreground">
        No runs yet. Use Test to try this workflow against a real conversation.
      </p>
    )

  return (
    <ul className="flex flex-col gap-2 p-3">
      {data.map((execution) => (
        <li key={execution.id} className="glass-inset rounded-lg p-2.5">
          <button
            type="button"
            onClick={() => setExpanded(expanded === execution.id ? null : execution.id)}
            className="flex w-full items-center gap-2 text-left"
          >
            <ExecutionStatusPill status={execution.status} />
            <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
              {execution.trigger_type.replace(/_/g, ' ')}
            </span>
            <span className="shrink-0 text-[10px] text-foreground-subtle">
              {relativeTime(execution.created_at)}
            </span>
          </button>

          {execution.error ? (
            <p className="mt-1.5 text-[11px] text-destructive">{execution.error}</p>
          ) : null}

          {expanded === execution.id ? (
            <div className="mt-2 flex flex-col gap-1.5">
              {execution.steps.map((step) => (
                <div key={step.id} className="flex items-start gap-2 rounded-md bg-black/10 p-1.5">
                  <StepStatusPill status={step.status} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11px] font-medium">
                      {step.node_type.replace(/_/g, ' ')}
                    </p>
                    {step.detail ? (
                      <p className="text-[10px] text-muted-foreground">{step.detail}</p>
                    ) : null}
                  </div>
                </div>
              ))}
              <p className="text-[10px] text-foreground-subtle">
                Started {longDateTime(execution.created_at)}
                {execution.retry_count > 0 ? ` · ${execution.retry_count} retry(s)` : ''}
              </p>
              {execution.status === 'failed' ? (
                <Button
                  size="sm"
                  variant="glass"
                  className="h-7 text-[11px]"
                  disabled={retrying === execution.id}
                  onClick={() => handleRetry(execution.id)}
                >
                  {retrying === execution.id ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <RotateCcw className="size-3" />
                  )}
                  Retry from the failed step
                </Button>
              ) : null}
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

function VersionList({
  workflowId,
  onRestored,
}: {
  workflowId: string
  onRestored: () => void
}) {
  const { data, loading, reload } = useApi<WorkflowVersion[]>(`/workflows/${workflowId}/versions`)
  const [restoring, setRestoring] = useState<string | null>(null)

  async function handleRestore(versionId: string) {
    setRestoring(versionId)
    try {
      await api.post(`/workflows/${workflowId}/versions/${versionId}/restore`, {})
      await reload()
      onRestored()
    } catch {
      // The list reloads either way; a failed restore leaves the graph as-is.
    } finally {
      setRestoring(null)
    }
  }

  if (loading && !data) return <p className="p-4 text-xs text-muted-foreground">Loading history…</p>
  if (!data?.length)
    return (
      <p className="p-4 text-xs text-muted-foreground">
        No saved versions yet — a snapshot is taken every time you save.
      </p>
    )

  return (
    <ul className="flex flex-col gap-2 p-3">
      {data.map((version) => (
        <li key={version.id} className="glass-inset flex items-center gap-2 rounded-lg p-2.5">
          <Badge variant="secondary" className="h-5 shrink-0 px-1.5 text-[10px]">
            v{version.version_number}
          </Badge>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11px]">
              {version.graph?.nodes?.length ?? 0} node
              {(version.graph?.nodes?.length ?? 0) === 1 ? '' : 's'}
            </p>
            <p className="text-[10px] text-foreground-subtle">
              {relativeTime(version.created_at)} ago
            </p>
          </div>
          <Button
            size="sm"
            variant="glass"
            className="h-7 shrink-0 text-[11px]"
            disabled={restoring === version.id}
            onClick={() => handleRestore(version.id)}
          >
            {restoring === version.id ? <Loader2 className="size-3 animate-spin" /> : null}
            Restore
          </Button>
        </li>
      ))}
    </ul>
  )
}

function Builder({ workflow, onReload }: { workflow: Workflow; onReload: () => void }) {
  const navigate = useNavigate()
  const requireConfirmation = useRequireDeleteConfirmation()
  const { data: catalog } = useApi<WorkflowCatalog>('/workflows/catalog')
  const { data: users } = useApi<User[]>('/users')
  const { data: agents, reload: reloadAgents } = useApi<Agent[]>('/agents')
  const { data: conversations } = useApi<ConversationListItem[]>('/conversations')

  const [name, setName] = useState(workflow.name)
  const [agentId, setAgentId] = useState(workflow.agent_id ?? NO_AGENT)
  const [config, setConfig] = useState<Record<string, WorkflowNodeConfig>>(() =>
    Object.fromEntries((workflow.graph?.nodes ?? []).map((node) => [node.id, node.config ?? {}])),
  )
  const [kinds] = useState<Record<string, { kind: WorkflowNodeKind; type: string }>>(() =>
    Object.fromEntries(
      (workflow.graph?.nodes ?? []).map((node) => [node.id, { kind: node.kind, type: node.type }]),
    ),
  )
  const kindsRef = useRef(kinds)

  const [validation, setValidation] = useState<ValidationResult | null>(null)
  const invalidIds = useMemo(
    () =>
      new Set(
        (validation?.issues ?? [])
          .filter((issue) => issue.level === 'error' && issue.node_id)
          .map((issue) => issue.node_id as string),
      ),
    [validation],
  )

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(
    (workflow.graph?.edges ?? []).map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.branch ?? undefined,
      animated: true,
      label: edge.branch ?? undefined,
    })),
  )

  const { fitView } = useReactFlow()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  // Undo/redo over whole-canvas snapshots. A graph here is a few dozen small
  // objects, so keeping full copies is far simpler — and less bug-prone —
  // than a command log with an inverse for every kind of edit.
  const [history, setHistory] = useState<Snapshot[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  // Set while an undo/redo is being applied, so the effects that would
  // normally record a snapshot don't record the restore as a new edit.
  const restoring = useRef(false)
  const [saving, setSaving] = useState<'save' | 'status' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [testConversationId, setTestConversationId] = useState<string>('')
  const [lastRun, setLastRun] = useState<WorkflowExecution | null>(null)
  const [sidePanel, setSidePanel] = useState<'palette' | 'runs' | 'versions'>('palette')
  const [agentSheetOpen, setAgentSheetOpen] = useState(false)

  // Indirection so the node data below can carry a delete callback without
  // this effect depending on `deleteNode` itself — that function is rebuilt
  // every render, which would make the effect re-run forever.
  const deleteNodeRef = useRef<(id: string) => void>(() => {})

  // Rebuilt whenever config or validation changes so a node's on-canvas
  // summary tracks what the property panel is editing, without xyflow
  // owning that data itself.
  useEffect(() => {
    setNodes((current) =>
      current.map((node) => {
        const meta = kindsRef.current[node.id]
        if (!meta) return node
        const model: WorkflowNodeData = {
          id: node.id,
          kind: meta.kind,
          type: meta.type,
          position: node.position,
          config: config[node.id] ?? {},
        }
        return {
          ...node,
          data: {
            kind: meta.kind,
            type: meta.type,
            label: labelFor(model, catalog ?? null),
            summary: summarize(model),
            invalid: invalidIds.has(node.id),
            onDelete: (id: string) => deleteNodeRef.current(id),
          },
        }
      }),
    )
  }, [config, catalog, invalidIds, setNodes])

  // Seeded once from the loaded workflow. Not an initialiser on useNodesState
  // because the labels depend on `catalog`, which arrives on its own request.
  const seeded = useRef(false)
  useEffect(() => {
    if (seeded.current) return
    seeded.current = true
    const initial = toCanvasNodes(workflow.graph?.nodes ?? [], catalog ?? null, new Set())
    setNodes(initial)
    // The baseline undo target: the graph as it was loaded, so the first
    // undo returns to "how I found it" rather than having nothing to go to.
    setHistory([
      {
        nodes: initial,
        edges: (workflow.graph?.edges ?? []).map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          sourceHandle: edge.branch ?? undefined,
          animated: true,
          label: edge.branch ?? undefined,
        })),
        config: { ...config },
        kinds: { ...kindsRef.current },
      },
    ])
    setHistoryIndex(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, workflow.graph, setNodes])

  /** Records the state *after* an edit. Anything ahead of the cursor is
   * dropped, which is what makes redo mean "the branch I just undid" rather
   * than a stale one from before. */
  const pushHistory = useCallback(
    (
      nextNodes: Node[],
      nextEdges: Edge[],
      nextConfig: Record<string, WorkflowNodeConfig>,
    ) => {
      if (restoring.current) return
      setHistory((current) => {
        const truncated = current.slice(0, historyIndex + 1)
        truncated.push({
          nodes: nextNodes,
          edges: nextEdges,
          config: nextConfig,
          kinds: { ...kindsRef.current },
        })
        const trimmed = truncated.slice(-HISTORY_LIMIT)
        setHistoryIndex(trimmed.length - 1)
        return trimmed
      })
    },
    [historyIndex],
  )

  const applySnapshot = useCallback(
    (snapshot: Snapshot) => {
      restoring.current = true
      kindsRef.current = { ...snapshot.kinds }
      setNodes(snapshot.nodes)
      setEdges(snapshot.edges)
      setConfig(snapshot.config)
      // A node that no longer exists must not stay selected — the property
      // panel would render against a config entry that isn't there.
      setSelectedId((current) =>
        current && snapshot.nodes.some((node) => node.id === current) ? current : null,
      )
      setDirty(true)
      // Cleared after the state updates have flushed, so the effects they
      // trigger still see restoring=true and skip recording.
      requestAnimationFrame(() => {
        restoring.current = false
      })
    },
    [setNodes, setEdges],
  )

  const canUndo = historyIndex > 0
  const canRedo = historyIndex >= 0 && historyIndex < history.length - 1

  const handleUndo = useCallback(() => {
    if (!canUndo) return
    const target = historyIndex - 1
    setHistoryIndex(target)
    applySnapshot(history[target])
  }, [canUndo, history, historyIndex, applySnapshot])

  const handleRedo = useCallback(() => {
    if (!canRedo) return
    const target = historyIndex + 1
    setHistoryIndex(target)
    applySnapshot(history[target])
  }, [canRedo, history, historyIndex, applySnapshot])

  // The shortcuts people already expect from every other canvas tool.
  // Ignored while focus is in a text field, where they mean the browser's
  // own text undo instead.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, [contenteditable="true"]')) return
      event.preventDefault()
      if (event.shiftKey) handleRedo()
      else handleUndo()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleUndo, handleRedo])

  const collectGraph = useCallback(() => {
    return {
      nodes: nodes.map((node) => {
        const meta = kindsRef.current[node.id] ?? { kind: 'action' as WorkflowNodeKind, type: '' }
        return {
          id: node.id,
          kind: meta.kind,
          type: meta.type,
          position: { x: Math.round(node.position.x), y: Math.round(node.position.y) },
          config: config[node.id] ?? {},
        }
      }),
      edges: edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        branch: (edge.sourceHandle as 'true' | 'false' | undefined) ?? null,
      })),
    }
  }, [nodes, edges, config])

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((current) => {
        const next = addEdge(
          {
            ...connection,
            id: `e-${connection.source}-${connection.target}-${connection.sourceHandle ?? 'x'}`,
            animated: true,
            label: connection.sourceHandle ?? undefined,
          },
          current,
        )
        pushHistory(nodes, next, config)
        return next
      })
      setDirty(true)
    },
    [setEdges, pushHistory, nodes, config],
  )

  function addNode(kind: WorkflowNodeKind, type: string) {
    const id = `${kind}-${Date.now().toString(36)}`
    kindsRef.current[id] = { kind, type }
    const defaults: WorkflowNodeConfig = {}
    const entry =
      kind === 'trigger'
        ? catalog?.triggers.find((t) => t.key === type)
        : kind === 'action'
          ? catalog?.actions.find((a) => a.key === type)
          : undefined
    for (const field of entry?.fields ?? []) {
      if (field.default !== undefined) defaults[field.key] = field.default
    }
    const nextConfig = { ...config, [id]: defaults }
    setConfig(nextConfig)

    const nextNodes: Node[] = [
      ...nodes,
      {
        id,
        type: 'agentraNode',
        // To the right of whatever is furthest right, which is the direction
        // a flow reads — so building one step at a time produces a legible
        // chain rather than a pile. fitView below then brings it into frame.
        position: freeSpot(nextSpot(nodes), nodes),
        data: {
          kind,
          type,
          label: labelFor({ id, kind, type, position: { x: 0, y: 0 }, config: defaults }, catalog ?? null),
          summary: '',
          invalid: false,
        },
      },
    ]
    setNodes(nextNodes)
    pushHistory(nextNodes, edges, nextConfig)
    setSelectedId(id)
    setDirty(true)
    // Next frame, once the node is actually laid out — otherwise fitView
    // measures a graph that doesn't include it yet and the new node stays
    // just off the edge, which is exactly the thing this prevents.
    requestAnimationFrame(() => fitView({ maxZoom: 1, padding: 0.25, duration: 250 }))
  }

  /**
   * Confirmation is scoped to what is actually at stake: a node wired into
   * the flow takes edges (and so a branch of the automation) with it, which
   * is worth a prompt. An unconnected one someone just dropped and changed
   * their mind about is not — and undo covers both regardless.
   */
  function deleteNode(id: string) {
    const meta = kindsRef.current[id]
    const attached = edges.filter((edge) => edge.source === id || edge.target === id)
    if (requireConfirmation && attached.length > 0) {
      const label = meta ? labelFor(
        { id, kind: meta.kind, type: meta.type, position: { x: 0, y: 0 }, config: config[id] ?? {} },
        catalog ?? null,
      ) : 'this node'
      const ok = window.confirm(
        `Delete "${label}"? ${attached.length} connection${attached.length === 1 ? '' : 's'} ` +
          `will be removed with it. You can undo this.`,
      )
      if (!ok) return
    }

    const nextNodes = nodes.filter((node) => node.id !== id)
    const nextEdges = edges.filter((edge) => edge.source !== id && edge.target !== id)
    const nextConfig = { ...config }
    delete nextConfig[id]

    setNodes(nextNodes)
    setEdges(nextEdges)
    setConfig(nextConfig)
    // Snapshotted *before* dropping the kind entry, so the undo that restores
    // this node also restores what type it was — see Snapshot's own comment.
    pushHistory(nextNodes, nextEdges, nextConfig)
    delete kindsRef.current[id]
    setSelectedId(null)
    setDirty(true)
  }

  deleteNodeRef.current = deleteNode

  async function handleSave() {
    setSaving('save')
    setError(null)
    try {
      await api.patch(`/workflows/${workflow.id}`, {
        name: name.trim(),
        agent_id: agentId === NO_AGENT ? null : agentId,
        graph: collectGraph(),
      })
      setDirty(false)
      onReload()
      await handleValidate(false)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not save this workflow')
    } finally {
      setSaving(null)
    }
  }

  /** `save` is false only when called from handleSave itself, which has just
   * persisted the graph and must not recurse back into it. */
  async function handleValidate(save = true) {
    try {
      // The endpoint validates the saved graph, so validating a dirty canvas
      // would report on a version nobody is looking at — Validate has to mean
      // "check what I see", same as Test.
      if (save && dirty) {
        await handleSave()
        return
      }
      setValidation(await api.post<ValidationResult>(`/workflows/${workflow.id}/validate`, {}))
    } catch {
      // Validation is advisory; a failed check shouldn't block editing.
    }
  }

  async function handleToggleStatus() {
    const next = workflow.status === 'active' ? 'paused' : 'active'
    setSaving('status')
    setError(null)
    try {
      await api.patch(`/workflows/${workflow.id}`, { status: next })
      onReload()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not change status')
    } finally {
      setSaving(null)
    }
  }

  async function handleTest() {
    setTesting(true)
    setError(null)
    try {
      // Saved first, deliberately: testing the canvas but running the saved
      // graph would be a trap. This makes Test always mean "run what I see".
      if (dirty) await handleSave()
      const run = await api.post<WorkflowExecution>(`/workflows/${workflow.id}/test`, {
        conversation_id: testConversationId || null,
      })
      setLastRun(run)
      setSidePanel('runs')
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not run this workflow')
    } finally {
      setTesting(false)
    }
  }

  async function handleDuplicate() {
    try {
      const clone = await api.post<Workflow>(`/workflows/${workflow.id}/duplicate`, {})
      navigate(`/app/workflows/${clone.id}`)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not duplicate this workflow')
    }
  }

  async function handleDelete() {
    if (requireConfirmation && !window.confirm(`Delete "${workflow.name}"? This cannot be undone.`))
      return
    try {
      await api.delete(`/workflows/${workflow.id}`)
      navigate('/app/workflows')
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not delete this workflow')
    }
  }

  const selectedNode: WorkflowNodeData | null = selectedId
    ? {
        id: selectedId,
        kind: kindsRef.current[selectedId]?.kind ?? 'action',
        type: kindsRef.current[selectedId]?.type ?? '',
        position: { x: 0, y: 0 },
        config: config[selectedId] ?? {},
      }
    : null

  const errorCount = (validation?.issues ?? []).filter((i) => i.level === 'error').length
  const warningCount = (validation?.issues ?? []).filter((i) => i.level === 'warning').length
  // Resolved from the live agent list, not the workflow's stale copy, so an
  // agent renamed on the Agents page shows its new name here immediately.
  const linkedAgent = (agents ?? []).find((candidate) => candidate.id === agentId) ?? null

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* ---- toolbar ---- */}
      <Card className="flex-row flex-wrap items-center gap-3 p-3">
        <Button variant="glass" size="sm" asChild>
          <Link to="/app/workflows">
            <ArrowLeft className="size-3.5" />
            Workflows
          </Link>
        </Button>

        <Input
          value={name}
          onChange={(event) => {
            setName(event.target.value)
            setDirty(true)
          }}
          className="h-8 w-56 font-medium"
        />
        <WorkflowStatusPill status={workflow.status} />
        {dirty ? (
          <Badge variant="outline" className="h-5 px-1.5 text-[10px] text-warning">
            Unsaved
          </Badge>
        ) : null}

        <div className="flex items-center gap-1">
          <Button
            variant="glass"
            size="icon-sm"
            title="Undo (⌘Z)"
            aria-label="Undo"
            disabled={!canUndo}
            onClick={handleUndo}
          >
            <Undo2 className="size-3.5" />
          </Button>
          <Button
            variant="glass"
            size="icon-sm"
            title="Redo (⇧⌘Z)"
            aria-label="Redo"
            disabled={!canRedo}
            onClick={handleRedo}
          >
            <Redo2 className="size-3.5" />
          </Button>
        </div>

        <Select
          value={agentId}
          onValueChange={(value) => {
            setAgentId(value)
            setDirty(true)
          }}
        >
          {/* Wider and taller than a standard trigger, and capped with
              max-w so a long agent name truncates instead of pushing the
              rest of the toolbar off the row. */}
          <SelectTrigger
            className={cn(
              // Grows into whatever the toolbar has spare and caps before it
              // would crowd the action buttons; the value truncates inside.
              'agent-select-trigger w-full min-w-0 max-w-[min(26rem,45vw)] flex-1 basis-64 text-sm',
              linkedAgent && 'agent-name',
            )}
          >
            <Bot className="size-4 text-brand-text" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-w-[min(26rem,90vw)]">
            <SelectItem value={NO_AGENT}>No agent</SelectItem>
            {(agents ?? []).map((agent) => (
              <SelectItem key={agent.id} value={agent.id}>
                {agent.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Editing the linked agent without leaving the Workflow section.
            Opens the same record the Agents page edits — see
            WorkflowAgentSheet — so there is no way to end up with two. */}
        {linkedAgent ? (
          <Button
            variant="glass"
            size="icon-sm"
            title={`Configure ${linkedAgent.name}`}
            aria-label={`Configure ${linkedAgent.name}`}
            onClick={() => setAgentSheetOpen(true)}
          >
            <Settings2 className="size-3.5" />
          </Button>
        ) : null}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Select value={testConversationId} onValueChange={setTestConversationId}>
            <SelectTrigger className="h-8 w-52 text-xs">
              <SelectValue placeholder="Test against…" />
            </SelectTrigger>
            <SelectContent>
              {(conversations ?? []).map((conversation) => (
                <SelectItem key={conversation.id} value={conversation.id}>
                  {conversation.contact.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button variant="glass" size="sm" onClick={() => void handleValidate()}>
            <ShieldCheck className="size-3.5" />
            Validate
          </Button>
          <Button variant="glass" size="sm" onClick={handleTest} disabled={testing}>
            {testing ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
            Test
          </Button>
          <Button
            variant="glass"
            size="sm"
            onClick={handleToggleStatus}
            disabled={saving !== null}
          >
            <Power className="size-3.5" />
            {workflow.status === 'active' ? 'Disable' : 'Enable'}
          </Button>
          <Button variant="glass" size="icon-sm" title="Duplicate" onClick={handleDuplicate}>
            <Copy className="size-3.5" />
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving !== null || !name.trim()}>
            {saving === 'save' ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            Save
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

      {validation ? (
        <Card
          className={cn(
            'flex-row flex-wrap items-center gap-2 p-2.5 text-xs',
            errorCount ? 'border-destructive/40' : 'border-success/40',
          )}
        >
          {errorCount ? (
            <AlertTriangle className="size-4 shrink-0 text-destructive" />
          ) : (
            <CheckCircle2 className="size-4 shrink-0 text-success" />
          )}
          <span className="font-medium">
            {errorCount
              ? `${errorCount} problem${errorCount === 1 ? '' : 's'} to fix`
              : 'This workflow is ready to enable'}
            {warningCount ? ` · ${warningCount} warning${warningCount === 1 ? '' : 's'}` : ''}
          </span>
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            {(validation.issues ?? []).map((issue) => issue.message).join(' · ')}
          </span>
        </Card>
      ) : null}

      {lastRun ? (
        <Card className="flex-row flex-wrap items-center gap-2 p-2.5 text-xs">
          <ExecutionStatusPill status={lastRun.status} />
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            Last test: {lastRun.steps.map((step) => step.detail).filter(Boolean).join(' → ') || 'no steps ran'}
          </span>
        </Card>
      ) : null}

      {/* ---- canvas + panels ---- */}
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[15rem_1fr_20rem]">
        {/* palette / runs / versions */}
        <Card className="hidden min-h-0 flex-col overflow-hidden p-0 lg:flex">
          <div className="flex gap-1 p-2">
            {(
              [
                { key: 'palette', label: 'Add', icon: Plus },
                { key: 'runs', label: 'Runs', icon: History },
                { key: 'versions', label: 'History', icon: RotateCcw },
              ] as const
            ).map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setSidePanel(tab.key)}
                className={cn(
                  'flex flex-1 items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-medium transition-colors',
                  sidePanel === tab.key
                    ? 'bg-brand-soft text-brand-text'
                    : 'text-muted-foreground hover:bg-accent',
                )}
              >
                <tab.icon className="size-3" />
                {tab.label}
              </button>
            ))}
          </div>
          <Separator />

          <div className="min-h-0 flex-1 overflow-y-auto">
            {sidePanel === 'palette' ? (
              <div className="flex flex-col gap-3 p-3">
                <div className="flex flex-col gap-1.5">
                  <Label className="text-[10px] tracking-wide uppercase">Triggers</Label>
                  {(catalog?.triggers ?? []).map((entry) => (
                    <PaletteButton
                      key={entry.key}
                      nodeKey={entry.key}
                      kind="trigger"
                      label={entry.label}
                      description={entry.description}
                      onAdd={addNode}
                    />
                  ))}
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label className="text-[10px] tracking-wide uppercase">Logic</Label>
                  {(catalog?.flow_nodes ?? []).map((entry) => (
                    <PaletteButton
                      key={entry.key}
                      nodeKey={entry.key}
                      kind={entry.key as WorkflowNodeKind}
                      label={entry.label}
                      description={entry.description}
                      onAdd={addNode}
                    />
                  ))}
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label className="text-[10px] tracking-wide uppercase">Actions</Label>
                  {(catalog?.actions ?? []).map((entry) => (
                    <PaletteButton
                      key={entry.key}
                      nodeKey={entry.key}
                      kind="action"
                      label={entry.label}
                      description={entry.description}
                      onAdd={addNode}
                    />
                  ))}
                </div>
              </div>
            ) : sidePanel === 'runs' ? (
              <ExecutionList workflowId={workflow.id} />
            ) : (
              <VersionList workflowId={workflow.id} onRestored={onReload} />
            )}
          </div>
        </Card>

        {/* canvas */}
        <Card className="min-h-0 overflow-hidden p-0">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={(changes) => {
              onNodesChange(changes)
              if (changes.some((change) => change.type === 'position' || change.type === 'remove')) {
                setDirty(true)
              }
            }}
            onEdgesChange={(changes) => {
              onEdgesChange(changes)
              setDirty(true)
            }}
            onConnect={onConnect}
            // Recorded on drag *stop*, not on every position change — one
            // undo step per move, rather than one per animation frame.
            onNodeDragStop={() => pushHistory(nodes, edges, config)}
            onNodeClick={(_, node) => setSelectedId(node.id)}
            onPaneClick={() => setSelectedId(null)}
            fitView
            // maxZoom 1, or a new workflow's single trigger node gets
            // magnified to fill the pane — at which point the next node
            // added lands a full screen-width away and can't be dragged to.
            fitViewOptions={{ maxZoom: 1, padding: 0.25 }}
            proOptions={{ hideAttribution: true }}
            className="bg-transparent"
          >
            <Background gap={18} size={1} className="opacity-40" />
            <Controls showInteractive={false} className="!bottom-3 !left-3" />
            <MiniMap pannable zoomable className="!bottom-3 !right-3 !h-24 !w-36 !bg-black/20" />
          </ReactFlow>
        </Card>

        {/* properties */}
        <Card className="hidden min-h-0 overflow-hidden p-0 lg:flex">
          {selectedNode && catalog ? (
            <NodePropertiesPanel
              node={selectedNode}
              catalog={catalog}
              users={users ?? []}
              agents={agents ?? []}
              onChange={(next) => {
                const nextConfig = { ...config, [selectedNode.id]: next }
                setConfig(nextConfig)
                pushHistory(nodes, edges, nextConfig)
                setDirty(true)
              }}
              onDelete={() => deleteNode(selectedNode.id)}
              onClose={() => setSelectedId(null)}
            />
          ) : (
            <div className="flex flex-col gap-3 p-4">
              <p className="text-sm font-semibold">Nothing selected</p>
              <p className="text-xs text-muted-foreground">
                Pick a node on the canvas to configure it, or add one from the palette on the left.
                Drag from a node's right edge to its next step to connect them.
              </p>
              {workflow.webhook_token ? (
                <>
                  <Separator />
                  <div className="flex flex-col gap-1.5">
                    <p className="flex items-center gap-1.5 text-xs font-semibold">
                      <Webhook className="size-3.5" />
                      Webhook trigger URL
                    </p>
                    <code className="rounded-md bg-black/20 p-2 text-[10px] break-all">
                      POST /webhooks/workflow/{workflow.webhook_token}
                    </code>
                    <p className="text-[10px] text-foreground-subtle">
                      Only fires while this workflow is enabled and has a webhook trigger node.
                    </p>
                  </div>
                </>
              ) : null}
            </div>
          )}
        </Card>
      </div>

      {/* Keyed by agent id: switching the workflow's agent gives a fresh
          draft rather than carrying the previous agent's edits across. */}
      {linkedAgent ? (
        <WorkflowAgentSheet
          key={linkedAgent.id}
          agent={linkedAgent}
          open={agentSheetOpen}
          onOpenChange={setAgentSheetOpen}
          // Both: the agent list backs this toolbar's name and picker, and
          // the workflow's own embedded agent summary is what the Workflows
          // list card renders. Refreshing one and not the other leaves a
          // stale name visible in the other place.
          onSaved={() => {
            reloadAgents()
            onReload()
          }}
        />
      ) : null}
    </div>
  )
}

export function WorkflowBuilder() {
  const { workflowId } = useParams<{ workflowId: string }>()
  const { data, error, loading, reload } = useApi<Workflow>(
    workflowId ? `/workflows/${workflowId}` : null,
  )

  // Guarded on `!data`: Save/Enable/Restore all call this reload, and an
  // unguarded early return would tear down the canvas — losing node
  // positions and the current selection — on every one of them.
  if (loading && !data) return <LoadingState label="Loading workflow…" />
  if (error && !data) return <ErrorState error={error} onRetry={reload} />
  if (!data) return null

  return (
    <ReactFlowProvider>
      {/* Keyed by id so navigating between two workflows remounts rather
          than carrying the previous one's unsaved canvas state across. */}
      <Builder key={data.id} workflow={data} onReload={reload} />
    </ReactFlowProvider>
  )
}
