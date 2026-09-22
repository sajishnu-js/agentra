import { History } from 'lucide-react'
import { useState } from 'react'

import { EmptyState, ErrorState, LoadingState } from '@/components/StateBlock'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useApi } from '@/hooks/useApi'
import { longDateTime } from '@/lib/format'
import type { AuditLogPage } from '@/lib/types'
import { SectionHeader } from '@/pages/settings/shared'

const PAGE_SIZE = 25

export function AuditLogSection() {
  const [q, setQ] = useState('')
  const [entityType, setEntityType] = useState('')
  const [offset, setOffset] = useState(0)

  const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) })
  if (q.trim()) params.set('q', q.trim())
  if (entityType.trim()) params.set('entity_type', entityType.trim())

  const { data, error, loading, reload } = useApi<AuditLogPage>(`/audit-logs?${params.toString()}`)

  function resetAndSearch() {
    setOffset(0)
    reload()
  }

  return (
    <Card className="gap-0 overflow-hidden p-0">
      <SectionHeader
        icon={History}
        title="Audit log"
        description="Every recorded action across users, agents, knowledge bases and settings."
      />

      <div className="flex flex-wrap items-center gap-2 border-b border-border p-4">
        <Input
          value={q}
          onChange={(event) => setQ(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && resetAndSearch()}
          placeholder="Search summaries…"
          className="max-w-xs"
        />
        <Input
          value={entityType}
          onChange={(event) => setEntityType(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && resetAndSearch()}
          placeholder="Entity type (e.g. agent, user)…"
          className="max-w-xs"
        />
        <Button type="button" variant="glass" size="sm" onClick={resetAndSearch}>
          Search
        </Button>
      </div>

      {loading ? (
        <LoadingState label="Loading audit log…" />
      ) : error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : !data?.items.length ? (
        <EmptyState title="No matching activity" description="Try clearing the filters above." />
      ) : (
        <>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Who</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Summary</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                      {longDateTime(entry.created_at)}
                    </TableCell>
                    <TableCell className="text-xs font-medium">{entry.actor_name ?? 'System'}</TableCell>
                    <TableCell className="text-xs">
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium">
                        {entry.action}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{entry.entity_type}</TableCell>
                    <TableCell className="text-xs">{entry.summary}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-border p-4 text-xs text-muted-foreground">
            <span>
              Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, data.total)} of {data.total}
            </span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="glass"
                size="sm"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                Previous
              </Button>
              <Button
                type="button"
                variant="glass"
                size="sm"
                disabled={offset + PAGE_SIZE >= data.total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </Card>
  )
}
