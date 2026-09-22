import { Check, Loader2, RotateCcw, X } from 'lucide-react'
import { useState } from 'react'

import { AssignmentPicker } from '@/components/AssignmentPicker'
import { EmptyState, ErrorState, LoadingState } from '@/components/StateBlock'
import {
  CategoryPill,
  PriorityPill,
  RequestStatusPill,
} from '@/components/StatusPill'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useApi } from '@/hooks/useApi'
import { api, ApiError } from '@/lib/api'
import { channelLabel, initials, longDateTime, relativeTime } from '@/lib/format'
import type { AgentRequest, RequestStatus, UserWorkload } from '@/lib/types'

const FILTERS: { label: string; value: RequestStatus | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'Pending', value: 'pending' },
  { label: 'Completed', value: 'completed' },
  { label: 'Cancelled', value: 'cancelled' },
]

/** 'all' and 'unassigned' are sentinels; anything else is a user id. */
const ALL_OWNERS = 'all'
const UNASSIGNED = 'unassigned'

function OwnerFilter({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  // Reuses the same endpoint AssignmentPicker itself calls — one list of
  // staff, shared between "who can I assign to" and "whose queue am I
  // viewing".
  const { data: staff } = useApi<UserWorkload[]>('/users/assignable')

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-8 w-40 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_OWNERS}>All owners</SelectItem>
        <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
        {(staff ?? []).map((person) => (
          <SelectItem key={person.id} value={person.id}>
            {person.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/**
 * Status controls for one row.
 *
 * Buttons rather than a dropdown: there are two moves from any state, and a
 * dense queue is faster to work through when the action is one click. The row
 * is disabled while its own request is in flight, so a double click cannot
 * send two conflicting updates.
 */
function StatusActions({
  request,
  onChanged,
  onError,
}: {
  request: AgentRequest
  onChanged: () => void
  onError: (message: string) => void
}) {
  const [saving, setSaving] = useState(false)

  async function setStatus(status: RequestStatus) {
    setSaving(true)
    try {
      await api.patch<AgentRequest>(`/requests/${request.id}`, { status })
      onChanged()
    } catch (caught) {
      onError(
        caught instanceof ApiError ? caught.message : 'Could not update this request',
      )
    } finally {
      setSaving(false)
    }
  }

  if (saving) {
    return (
      <span className="flex justify-end px-2 text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
      </span>
    )
  }

  if (request.status === 'pending') {
    return (
      <span className="flex justify-end gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setStatus('completed')}
              aria-label="Mark completed"
              className="hover:text-success"
            >
              <Check className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">Mark completed</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setStatus('cancelled')}
              aria-label="Cancel request"
              className="hover:text-destructive"
            >
              <X className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">Cancel</TooltipContent>
        </Tooltip>
      </span>
    )
  }

  return (
    <span className="flex justify-end">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setStatus('pending')}
            aria-label="Reopen request"
          >
            <RotateCcw className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left">Reopen</TooltipContent>
      </Tooltip>
    </span>
  )
}

export function RequestsHub() {
  const [filter, setFilter] = useState<RequestStatus | 'all'>('pending')
  const [owner, setOwner] = useState(ALL_OWNERS)
  const [actionError, setActionError] = useState<string | null>(null)

  const params = new URLSearchParams()
  if (filter !== 'all') params.set('status', filter)
  if (owner === UNASSIGNED) params.set('unassigned', 'true')
  else if (owner !== ALL_OWNERS) params.set('assigned_to', owner)
  const query = params.toString()
  const path = query ? `/requests?${query}` : '/requests'

  // Polled, because the extraction step creates these from outside the browser.
  const { data, error, loading, reload } = useApi<AgentRequest[]>(path, {
    pollMs: 15000,
  })

  return (
    <div className="relative flex flex-col gap-4 overflow-hidden">
      {/* Decorative only — same corner-blob trick as the sidebar, so the
          busiest working screen in the app is not the flattest one. */}
      <div
        aria-hidden
        className="ambient-glow absolute -top-16 -right-20 -z-10 size-56 bg-brand opacity-[0.12]"
      />
      <div
        aria-hidden
        className="ambient-glow absolute top-1/2 -left-24 -z-10 size-64 bg-brand-2 opacity-[0.08]"
      />

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((option) => (
          <Button
            key={option.value}
            variant={filter === option.value ? 'default' : 'glass'}
            size="sm"
            onClick={() => {
              setFilter(option.value)
              setActionError(null)
            }}
            aria-pressed={filter === option.value}
          >
            {option.label}
          </Button>
        ))}
        <OwnerFilter
          value={owner}
          onChange={(value) => {
            setOwner(value)
            setActionError(null)
          }}
        />
        <span className="ml-auto text-xs text-foreground-subtle">
          {data ? `${data.length} request${data.length === 1 ? '' : 's'}` : ''}
        </span>
      </div>

      {actionError ? (
        <p className="text-xs text-destructive" role="alert">
          {actionError}
        </p>
      ) : null}

      <Card className="min-h-0 overflow-hidden p-0">
        {/* Guarded on `!data`, not bare `loading`/`error`: each row's
            AssignmentPicker/StatusActions calls this list's reload() right
            after its own mutation succeeds. Gating the table on bare
            `!loading` would unmount every row — including another row's open
            assignment sheet or in-flight status change — the instant any one
            row's action succeeds. Once real data exists, keep rendering it
            through a background refresh instead of tearing the tree down. */}
        {loading && !data ? <LoadingState label="Loading requests…" /> : null}
        {error && !data ? <ErrorState error={error} onRetry={reload} /> : null}
        {!loading && !error && data?.length === 0 ? (
          <EmptyState
            title="Nothing here"
            description="No requests match this filter."
          />
        ) : null}

        {data && data.length > 0 ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Request</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead className="text-right">Age</TableHead>
                  <TableHead className="w-20 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((request) => (
                  <TableRow
                    key={request.id}
                    // Left-edge accent bar, same idea as the sidebar's
                    // active-nav indicator — fades in on hover so a dense
                    // queue still feels alive under the pointer, layered on
                    // top of TableRow's existing hover:bg-accent/60 tint.
                    className="relative before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:rounded-r-full before:bg-brand before:opacity-0 before:transition-opacity before:duration-200 before:content-[''] hover:before:opacity-70"
                  >
                    <TableCell className="max-w-xs">
                      <p className="truncate font-medium">{request.title}</p>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Avatar className="size-6">
                          <AvatarFallback className="text-[10px]">
                            {initials(request.contact.name)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium">
                            {request.contact.name}
                          </p>
                          <p className="text-[11px] text-foreground-subtle">
                            {channelLabel(request.contact.channel)}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <CategoryPill category={request.category} />
                    </TableCell>
                    <TableCell>
                      <PriorityPill priority={request.priority} />
                    </TableCell>
                    <TableCell>
                      <RequestStatusPill status={request.status} />
                    </TableCell>
                    <TableCell>
                      <AssignmentPicker
                        endpoint={`/requests/${request.id}`}
                        current={request.assigned_agent}
                        onAssigned={() => {
                          setActionError(null)
                          reload()
                        }}
                        noun="request"
                        workloadField="open_requests"
                      />
                    </TableCell>
                    <TableCell
                      className="text-right text-xs whitespace-nowrap text-muted-foreground"
                      title={longDateTime(request.created_at)}
                    >
                      {relativeTime(request.created_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <StatusActions
                        request={request}
                        onChanged={() => {
                          setActionError(null)
                          reload()
                        }}
                        onError={setActionError}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
      </Card>
    </div>
  )
}
