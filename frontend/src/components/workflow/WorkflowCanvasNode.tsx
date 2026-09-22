import { Handle, Position, type NodeProps } from '@xyflow/react'
import { X } from 'lucide-react'

import {
  nodeKindStyles,
  workflowNodeFallbackIcon,
  workflowNodeIcons,
} from '@/lib/workflowNodes'
import type { WorkflowNodeKind } from '@/lib/types'
import { cn } from '@/lib/utils'

export type CanvasNodeData = {
  kind: WorkflowNodeKind
  type: string
  label: string
  summary: string
  invalid: boolean
  /** Set by the builder — deleting from the canvas has to go through it so
   * the node's config and its edges are removed alongside the node itself. */
  onDelete?: (id: string) => void
}

/**
 * One node on the canvas. Handles are what xyflow connects: every node has a
 * target on the left, and either one source (right) or — for a condition —
 * two, labelled true and false, which is what `branch` on an edge records.
 */
export function WorkflowCanvasNode({ id, data, selected }: NodeProps) {
  const node = data as unknown as CanvasNodeData
  const style = nodeKindStyles[node.kind]
  const Icon = workflowNodeIcons[node.type || node.kind] ?? workflowNodeFallbackIcon
  // Both fork on a true/false branch — a condition on its own checks, an
  // approval on whether the request it raised was completed or cancelled
  // (see engine.resume_approval) — so both need two labelled source handles.
  const isBranching = node.kind === 'condition' || node.kind === 'approval'
  const isTrigger = node.kind === 'trigger'

  return (
    <div
      className={cn(
        'glass group w-60 rounded-xl border-2 p-3 transition-shadow',
        style.ring,
        selected && 'shadow-[0_0_0_3px_var(--brand-glow)]',
        node.invalid && 'border-destructive/70',
      )}
    >
      {/* nodrag/nopan, or xyflow claims the pointerdown as a canvas drag and
          the click never lands. Revealed on hover (and kept visible while the
          node is selected) so the canvas stays clean to read. */}
      <button
        type="button"
        title="Delete this node"
        aria-label={`Delete ${node.label}`}
        onClick={(event) => {
          event.stopPropagation()
          node.onDelete?.(id)
        }}
        className={cn(
          'nodrag nopan absolute -top-2 -right-2 z-10 grid size-5 place-items-center rounded-full',
          'border border-border bg-background text-muted-foreground shadow-sm transition-all',
          'hover:border-destructive/50 hover:bg-destructive hover:text-white',
          selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
        )}
      >
        <X className="size-3" />
      </button>

      {!isTrigger ? (
        <Handle type="target" position={Position.Left} className="!size-2.5 !border-2 !border-background !bg-brand" />
      ) : null}

      <div className="flex items-start gap-2.5">
        <span className={cn('grid size-8 shrink-0 place-items-center rounded-lg', style.chip)}>
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold tracking-wide text-foreground-subtle uppercase">
            {style.label}
          </p>
          <p className="truncate text-sm font-medium">{node.label}</p>
          {node.summary ? (
            <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{node.summary}</p>
          ) : null}
        </div>
      </div>

      {isBranching ? (
        <>
          {/* Positioned by percentage so the two labels sit clear of each
              other regardless of how tall the node's summary makes it. */}
          <Handle
            id="true"
            type="source"
            position={Position.Right}
            style={{ top: '35%' }}
            className="!size-2.5 !border-2 !border-background !bg-success"
          />
          <Handle
            id="false"
            type="source"
            position={Position.Right}
            style={{ top: '75%' }}
            className="!size-2.5 !border-2 !border-background !bg-destructive"
          />
          <div className="pointer-events-none absolute top-0 -right-11 flex h-full flex-col justify-center gap-3 text-[9px] font-medium">
            <span className="text-success">true</span>
            <span className="text-destructive">false</span>
          </div>
        </>
      ) : (
        <Handle type="source" position={Position.Right} className="!size-2.5 !border-2 !border-background !bg-brand" />
      )}
    </div>
  )
}
