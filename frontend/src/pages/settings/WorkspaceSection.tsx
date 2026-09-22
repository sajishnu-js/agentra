import { Building2, DoorOpen } from 'lucide-react'
import { useEffect, useState } from 'react'

import { useAuth } from '@/auth/AuthProvider'
import { ErrorState, LoadingState } from '@/components/StateBlock'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useApi } from '@/hooks/useApi'
import { api, ApiError } from '@/lib/api'
import type { LoginRequirement, WorkspaceSettings } from '@/lib/types'
import { SaveBar, SectionHeader, SettingsField } from '@/pages/settings/shared'

type Draft = Pick<WorkspaceSettings, 'workspace_name' | 'support_email' | 'default_language' | 'timezone'>

function toDraft(settings: WorkspaceSettings): Draft {
  return {
    workspace_name: settings.workspace_name,
    support_email: settings.support_email,
    default_language: settings.default_language,
    timezone: settings.timezone,
  }
}

/**
 * Its own card, own fetch, own endpoint (`/settings/login-requirement`, not
 * `/settings/workspace`) — deliberately not folded into the main form above.
 * Only a Super Admin can even see this value (backend excludes it from the
 * general WorkspaceSettingsRead entirely), so this only renders once
 * hasPermission('manage_login_requirement') is true, which in practice
 * means "you are a Super Admin" — it is never grantable to a plain admin.
 */
function LoginRequirementCard() {
  const { data, error, loading, reload } = useApi<LoginRequirement>('/settings/login-requirement')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  async function toggle(next: boolean) {
    setSaving(true)
    setSaveError(null)
    try {
      await api.patch('/settings/login-requirement', { require_login: next })
      await reload()
    } catch (caught) {
      setSaveError(caught instanceof ApiError ? caught.message : 'Could not update this setting')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="gap-0 overflow-hidden p-0">
      <SectionHeader
        icon={DoorOpen}
        title="Login requirement"
        description="Super Admin only — controls whether 'Enter Workspace' on the opening page needs a sign-in."
      />
      {loading ? (
        <LoadingState label="Loading…" />
      ) : error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : data ? (
        <div className="flex items-center justify-between gap-4 p-5">
          <div>
            <p className="text-sm font-medium">Require sign-in to enter the workspace</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {data.require_login
                ? 'On — everyone must sign in with a workspace email before reaching the dashboard.'
                : "Off — \"Enter Workspace\" goes straight in, no sign-in screen. The login page still exists at /signin for anyone who wants to identify themselves."}
            </p>
            {saveError ? (
              <p role="alert" className="mt-1 text-xs text-destructive">
                {saveError}
              </p>
            ) : null}
          </div>
          <Switch checked={data.require_login} disabled={saving} onCheckedChange={(checked) => void toggle(checked)} />
        </div>
      ) : null}
    </Card>
  )
}

export function WorkspaceSection() {
  const { hasPermission } = useAuth()
  const { data, error, loading, reload } = useApi<WorkspaceSettings>('/settings/workspace')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => setDraft(data ? toDraft(data) : null), [data])

  // Guarded on `!data`, not bare `loading`/`error`: saving this form calls
  // this hook's own reload(), which flips `loading` true for one tick. An
  // unguarded early return here would unmount this whole section — including
  // the sibling LoginRequirementCard below, which has its own fetch and its
  // own saving/error state — forcing it to refetch and reset every time this
  // form is saved. Once real data exists, keep rendering it through a
  // background refresh instead of tearing the tree down.
  if (loading && !data) return <LoadingState label="Loading workspace settings…" />
  if (error && !data) return <ErrorState error={error} onRetry={reload} />
  if (!data || !draft) return null

  const initial = toDraft(data)
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial)

  async function handleSave() {
    if (!draft) return
    setSaving(true)
    setSaveError(null)
    try {
      await api.patch('/settings/workspace', {
        ...draft,
        support_email: draft.support_email?.trim() || null,
      })
      await reload()
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (caught) {
      setSaveError(caught instanceof ApiError ? caught.message : 'Could not save workspace settings')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="gap-0 overflow-hidden p-0">
        <SectionHeader
          icon={Building2}
          title="Workspace"
          description="Identity and locale for the whole workspace."
        />

        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <SettingsField label="Workspace name" htmlFor="ws-name">
            <Input
              id="ws-name"
              value={draft.workspace_name}
              onChange={(event) => setDraft({ ...draft, workspace_name: event.target.value })}
            />
          </SettingsField>
          <SettingsField label="Support email" htmlFor="ws-support-email">
            <Input
              id="ws-support-email"
              type="email"
              value={draft.support_email ?? ''}
              onChange={(event) => setDraft({ ...draft, support_email: event.target.value })}
              placeholder="support@yourcompany.com"
            />
          </SettingsField>
          <SettingsField label="Default language" htmlFor="ws-language" hint="ISO code, e.g. en or ar">
            <Input
              id="ws-language"
              value={draft.default_language}
              onChange={(event) => setDraft({ ...draft, default_language: event.target.value })}
            />
          </SettingsField>
          <SettingsField label="Timezone" htmlFor="ws-timezone" hint="IANA name, e.g. Asia/Dubai">
            <Input
              id="ws-timezone"
              value={draft.timezone}
              onChange={(event) => setDraft({ ...draft, timezone: event.target.value })}
            />
          </SettingsField>
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

      {hasPermission('manage_login_requirement') ? <LoginRequirementCard /> : null}
    </div>
  )
}
