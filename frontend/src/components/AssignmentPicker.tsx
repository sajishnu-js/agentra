import { Check, UserRound } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { useApi } from '@/hooks/useApi'
import { api, ApiError } from '@/lib/api'
import { initials } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { UserSummary, UserWorkload } from '@/lib/types'

/**
 * Assign a conversation or a request to a colleague.
 *
 * Shows each person's current load next to their name, so "who is free" is
 * answerable without leaving the screen — which is the whole point of showing
 * it here rather than on a staff page nobody would open mid-task. Generalized
 * over `endpoint`/`workloadField` rather than duplicated per entity: both
 * call sites assign the same kind of thing (a human) and read from the same
 * `/users/assignable` list, just against a different PATCH target and a
 * different load count on the same response.
 */
export function AssignmentPicker({
  endpoint,
  current,
  onAssigned,
  noun = 'conversation',
  workloadField = 'open_conversations',
}: {
  endpoint: string
  current: UserSummary | null
  onAssigned: () => void
  noun?: string
  workloadField?: 'open_conversations' | 'open_requests'
}) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Only fetched while the drawer is open — no point polling staff loads for a
  // panel nobody is looking at.
  const { data: staff } = useApi<UserWorkload[]>(open ? '/users/assignable' : null)

  async function assign(userId: string | null) {
    setSaving(userId ?? 'none')
    setError(null)
    try {
      await api.patch(endpoint, {
        assigned_agent_id: userId,
      })
      onAssigned()
      setOpen(false)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not assign')
    } finally {
      setSaving(null)
    }
  }

  return (
    <>
      <Button variant="glass" size="sm" onClick={() => setOpen(true)}>
        <UserRound className="size-3.5" />
        {current ? current.name.split(' ')[0] : 'Assign'}
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Assign this {noun}</SheetTitle>
            <SheetDescription>
              Counts are open {noun}s each person is currently holding.
            </SheetDescription>
          </SheetHeader>
          <Separator />

          {error ? (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          ) : null}

          <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
            {(staff ?? []).map((person) => {
              const isCurrent = current?.id === person.id
              return (
                <button
                  key={person.id}
                  type="button"
                  disabled={saving !== null}
                  onClick={() => assign(person.id)}
                  className={cn(
                    'flex items-center gap-3 rounded-md p-2.5 text-left transition-colors',
                    isCurrent ? 'bg-brand-soft' : 'hover:bg-accent/60',
                    saving !== null && 'opacity-50',
                  )}
                >
                  <Avatar className="size-8">
                    <AvatarImage src={person.avatar_url ?? undefined} alt="" />
                    <AvatarFallback>{initials(person.name)}</AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {person.name}
                    </span>
                    <span className="text-[11px] text-muted-foreground capitalize">
                      {person.role}
                    </span>
                  </span>
                  <Badge variant={person[workloadField] === 0 ? 'success' : 'secondary'}>
                    {person[workloadField]}
                  </Badge>
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
                Unassign
              </Button>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  )
}
