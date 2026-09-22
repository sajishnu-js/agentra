import { Laptop, ShieldCheck } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState, ErrorState, LoadingState } from '@/components/StateBlock'
import { useApi } from '@/hooks/useApi'
import { api, ApiError } from '@/lib/api'
import { relativeAge } from '@/lib/format'
import type { Session } from '@/lib/types'
import { SectionHeader } from '@/pages/settings/shared'
import { useState } from 'react'

function describeDevice(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device'
  if (/iphone|ipad/i.test(userAgent)) return 'iOS device'
  if (/android/i.test(userAgent)) return 'Android device'
  if (/macintosh|mac os/i.test(userAgent)) return 'Mac'
  if (/windows/i.test(userAgent)) return 'Windows PC'
  if (/linux/i.test(userAgent)) return 'Linux'
  return 'Browser'
}

export function SessionsSection() {
  const { data, error, loading, reload } = useApi<Session[]>('/auth/sessions')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  async function revoke(id: string) {
    setBusyId(id)
    setActionError(null)
    try {
      await api.delete(`/auth/sessions/${id}`)
      await reload()
    } catch (caught) {
      setActionError(caught instanceof ApiError ? caught.message : 'Could not sign out that device')
    } finally {
      setBusyId(null)
    }
  }

  async function revokeOthers() {
    setBusyId('*')
    setActionError(null)
    try {
      await api.delete('/auth/sessions')
      await reload()
    } catch (caught) {
      setActionError(caught instanceof ApiError ? caught.message : 'Could not sign out other devices')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Card className="gap-0 overflow-hidden p-0">
      <SectionHeader
        icon={Laptop}
        title="Sessions"
        description="Every device currently signed in to your account."
      />

      {/* Guarded on `!data`, not bare `loading`/`error`: revoke()/revokeOthers()
          call this hook's own reload() right after their own mutation
          succeeds. An unguarded switch here would unmount the whole list —
          discarding another row's in-flight busy state or this section's
          actionError — the instant any one revoke succeeds. */}
      {loading && !data ? (
        <LoadingState label="Loading sessions…" />
      ) : error && !data ? (
        <ErrorState error={error} onRetry={reload} />
      ) : !data?.length ? (
        <EmptyState title="No active sessions" description="" />
      ) : (
        <div className="flex flex-col divide-y divide-border">
          {data.map((session) => (
            <div key={session.id} className="flex items-center gap-3 p-5">
              <span className="glass grid size-9 shrink-0 place-items-center rounded-xl text-muted-foreground">
                <Laptop className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm font-medium">
                  {describeDevice(session.user_agent)}
                  {session.is_current ? (
                    <span className="flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold text-success">
                      <ShieldCheck className="size-3" />
                      This device
                    </span>
                  ) : null}
                </p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {session.ip_address ?? 'Unknown address'} · active {relativeAge(session.last_seen_at)}
                </p>
              </div>
              {!session.is_current ? (
                <Button
                  type="button"
                  variant="glass"
                  size="sm"
                  disabled={busyId === session.id}
                  onClick={() => void revoke(session.id)}
                >
                  {busyId === session.id ? 'Signing out…' : 'Sign out'}
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {actionError ? (
        <p role="alert" className="px-5 pb-3 text-xs text-destructive">
          {actionError}
        </p>
      ) : null}

      {data && data.length > 1 ? (
        <div className="flex justify-end border-t border-border p-5">
          <Button type="button" variant="outline" size="sm" disabled={busyId === '*'} onClick={() => void revokeOthers()}>
            {busyId === '*' ? 'Signing out…' : 'Sign out all other devices'}
          </Button>
        </div>
      ) : null}
    </Card>
  )
}
