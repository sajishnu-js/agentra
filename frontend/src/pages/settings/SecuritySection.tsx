import { Shield } from 'lucide-react'
import { useEffect, useState } from 'react'

import { ErrorState, LoadingState } from '@/components/StateBlock'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useApi } from '@/hooks/useApi'
import { api, ApiError } from '@/lib/api'
import type { WorkspaceSettings } from '@/lib/types'
import { SaveBar, SectionHeader, SettingsField } from '@/pages/settings/shared'

type Draft = Pick<
  WorkspaceSettings,
  | 'session_idle_timeout_minutes'
  | 'audit_log_retention_days'
  | 'require_confirmation_for_deletes'
  | 'ip_allowlist'
>

function toDraft(settings: WorkspaceSettings): Draft {
  return {
    session_idle_timeout_minutes: settings.session_idle_timeout_minutes,
    audit_log_retention_days: settings.audit_log_retention_days,
    require_confirmation_for_deletes: settings.require_confirmation_for_deletes,
    ip_allowlist: settings.ip_allowlist,
  }
}

function PurgeLogs({ retentionDays }: { retentionDays: number }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  async function handlePurge() {
    setBusy(true)
    setResult(null)
    try {
      await api.delete(`/audit-logs?older_than_days=${retentionDays}`)
      setResult(`Purged entries older than ${retentionDays} days.`)
    } catch (caught) {
      setResult(caught instanceof ApiError ? caught.message : 'Could not purge audit logs')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center justify-between gap-4 p-5">
      <div>
        <p className="text-sm font-medium">Purge old audit log entries</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Deletes audit log rows older than the retention period above ({retentionDays} days). Runs
          once, on demand — there's no automatic scheduled purge.
        </p>
        {result ? <p className="mt-1 text-xs text-foreground-subtle">{result}</p> : null}
      </div>
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void handlePurge()}>
        {busy ? 'Purging…' : 'Purge now'}
      </Button>
    </div>
  )
}

export function SecuritySection() {
  const { data, error, loading, reload } = useApi<WorkspaceSettings>('/settings/workspace')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => setDraft(data ? toDraft(data) : null), [data])

  // Guarded on `!data`, not bare `loading`/`error`: saving this form calls
  // this hook's own reload(), which flips `loading` true for one tick. An
  // unguarded early return here would unmount this whole section — including
  // the sibling PurgeLogs card below, which has its own busy/result state —
  // discarding its "Purged entries…" confirmation the moment this form is
  // saved. Once real data exists, keep rendering it through a background
  // refresh instead of tearing the tree down.
  if (loading && !data) return <LoadingState label="Loading security settings…" />
  if (error && !data) return <ErrorState error={error} onRetry={reload} />
  if (!data || !draft) return null

  const initial = toDraft(data)
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial)

  async function handleSave() {
    if (!draft) return
    setSaving(true)
    setSaveError(null)
    try {
      await api.patch('/settings/security', {
        ...draft,
        ip_allowlist: draft.ip_allowlist?.trim() || null,
      })
      await reload()
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (caught) {
      setSaveError(caught instanceof ApiError ? caught.message : 'Could not save security settings')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="gap-0 overflow-hidden p-0">
        <SectionHeader
          icon={Shield}
          title="Security"
          description="Session lifetime, network restrictions and destructive-action safeguards."
        />

        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <SettingsField
            label="Session idle timeout (minutes)"
            htmlFor="sec-timeout"
            hint="A signed-in session expires after this long with no activity."
          >
            <Input
              id="sec-timeout"
              type="number"
              min={5}
              value={draft.session_idle_timeout_minutes}
              onChange={(event) =>
                setDraft({ ...draft, session_idle_timeout_minutes: Number(event.target.value) })
              }
            />
          </SettingsField>
          <SettingsField
            label="Audit log retention (days)"
            htmlFor="sec-retention"
            hint="How far back the purge button below reaches."
          >
            <Input
              id="sec-retention"
              type="number"
              min={1}
              value={draft.audit_log_retention_days}
              onChange={(event) => setDraft({ ...draft, audit_log_retention_days: Number(event.target.value) })}
            />
          </SettingsField>

          <div className="sm:col-span-2">
            <SettingsField
              label="IP allowlist"
              htmlFor="sec-ips"
              hint="Comma-separated addresses. Empty means no restriction. Loopback (this machine) is always allowed regardless, so a typo here can't lock out the server itself."
            >
              <Textarea
                id="sec-ips"
                rows={2}
                value={draft.ip_allowlist ?? ''}
                onChange={(event) => setDraft({ ...draft, ip_allowlist: event.target.value })}
                placeholder="e.g. 203.0.113.4, 203.0.113.5"
              />
            </SettingsField>
          </div>

          <div className="flex items-center justify-between gap-4 rounded-xl border border-border p-4 sm:col-span-2">
            <div>
              <p className="text-sm font-medium">Require confirmation for destructive actions</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Deletes (users, agents, knowledge bases) ask for confirmation before proceeding.
              </p>
            </div>
            <Switch
              checked={draft.require_confirmation_for_deletes}
              onCheckedChange={(checked) => setDraft({ ...draft, require_confirmation_for_deletes: checked })}
            />
          </div>
        </div>

        <SaveBar
          dirty={dirty}
          saving={saving}
          error={saveError}
          saved={saved}
          onSave={handleSave}
          onReset={() => setDraft(initial)}
        />
      </Card>

      <Card className="gap-0 overflow-hidden p-0">
        <PurgeLogs retentionDays={data.audit_log_retention_days} />
      </Card>
    </div>
  )
}
