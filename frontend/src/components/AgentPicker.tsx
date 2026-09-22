import { Bot, Check } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Separator } from '@/components/ui/separator'
import { useApi } from '@/hooks/useApi'
import { api, ApiError } from '@/lib/api'
import { agentIconMap } from '@/lib/agentIcons'
import { cn } from '@/lib/utils'
import type { Agent } from '@/lib/types'

/**
 * Assign which AI agent answers a thread — an inbox's default, or one
 * conversation's own override. Generalized over `endpoint`/`field` rather
 * than duplicated per call site (mirrors AssignmentPicker's own reasoning,
 * which does the same thing for a human assignee): both PATCH the same kind
 * of thing against the same `/agents` list, just a different target and
 * field name.
 */
export function AgentPicker({
  endpoint,
  field,
  current,
  onAssigned,
  noun = 'thread',
  className,
}: {
  endpoint: string
  field: string
  current: { id: string; name: string } | null
  onAssigned: () => void
  noun?: string
  /** Override the trigger's default auto-width, shrink-resistant sizing —
   * e.g. `w-full` to fill a narrow sidebar instead of overflowing it. */
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { data: agents } = useApi<Agent[]>(open ? '/agents' : null)
  const selectable = (agents ?? []).filter((agent) => agent.status === 'active')

  async function assign(agentId: string | null) {
    setSaving(agentId ?? 'none')
    setError(null)
    try {
      await api.patch(endpoint, { [field]: agentId })
      onAssigned()
      setOpen(false)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not reassign')
    } finally {
      setSaving(null)
    }
  }

  return (
    <>
      <Button
        variant="glass"
        size="sm"
        onClick={() => setOpen(true)}
        title={current?.name}
        className={cn('min-w-0 shrink-0', className)}
      >
        <Bot className="size-3.5 shrink-0" />
        <span className="truncate">{current ? current.name : 'No agent'}</span>
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>AI agent for this {noun}</SheetTitle>
            <SheetDescription>
              Only active agents are offered — draft or paused agents can be edited on the
              Agents page first.
            </SheetDescription>
          </SheetHeader>
          <Separator />

          {error ? (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          ) : null}

          <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
            {selectable.length === 0 ? (
              <p className="p-2.5 text-xs text-muted-foreground">
                No active agents yet — create or activate one on the Agents page.
              </p>
            ) : null}
            {selectable.map((agent) => {
              const isCurrent = current?.id === agent.id
              const AgentIcon = agentIconMap[agent.icon] ?? agentIconMap.Bot
              return (
                <button
                  key={agent.id}
                  type="button"
                  disabled={saving !== null}
                  onClick={() => assign(agent.id)}
                  className={cn(
                    'flex items-center gap-3 rounded-md p-2.5 text-left transition-colors',
                    isCurrent ? 'bg-brand-soft' : 'hover:bg-accent/60',
                    saving !== null && 'opacity-50',
                  )}
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-soft text-brand-text">
                    <AgentIcon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{agent.name}</span>
                    {agent.description ? (
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {agent.description}
                      </span>
                    ) : null}
                  </span>
                  {isCurrent ? <Check className="size-4 text-brand-text" /> : null}
                </button>
              )
            })}
          </div>

          {current ? (
            <>
              <Separator />
              <Button
                variant="glass"
                size="sm"
                disabled={saving !== null}
                onClick={() => assign(null)}
              >
                Remove agent
              </Button>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  )
}
