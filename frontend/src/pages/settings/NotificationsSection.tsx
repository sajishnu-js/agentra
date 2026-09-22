import { Bell } from 'lucide-react'
import { useEffect, useState } from 'react'

import { ErrorState, LoadingState } from '@/components/StateBlock'
import { Card } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { useApi } from '@/hooks/useApi'
import { api, ApiError } from '@/lib/api'
import type { WorkspaceSettings } from '@/lib/types'
import { SaveBar, SectionHeader } from '@/pages/settings/shared'

type Draft = Pick<
  WorkspaceSettings,
  'notify_new_request' | 'notify_handover' | 'notify_agent_error' | 'notify_daily_summary'
>

function toDraft(settings: WorkspaceSettings): Draft {
  return {
    notify_new_request: settings.notify_new_request,
    notify_handover: settings.notify_handover,
    notify_agent_error: settings.notify_agent_error,
    notify_daily_summary: settings.notify_daily_summary,
  }
}

const ROWS: { key: keyof Draft; label: string; hint: string }[] = [
  {
    key: 'notify_new_request',
    label: 'New request alerts',
    hint: 'Live in the Topbar bell today — it only pulses when this is on and something is pending.',
  },
  {
    key: 'notify_handover',
    label: 'Handover alerts',
    hint: 'When a conversation hands off to a human because the AI is unsure.',
  },
  {
    key: 'notify_agent_error',
    label: 'Agent errors',
    hint: 'When an AI agent fails to generate a reply.',
  },
  {
    key: 'notify_daily_summary',
    label: 'Daily summary',
    hint: 'A once-a-day digest of workspace activity.',
  },
]

/**
 * Persisted preferences. notify_new_request is already wired to something
 * real (see Topbar.tsx); the others are ready for a notification-delivery
 * feature to read once one exists — this screen is honest about that rather
 * than implying every toggle already sends something today.
 */
export function NotificationsSection() {
  const { data, error, loading, reload } = useApi<WorkspaceSettings>('/settings/workspace')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => setDraft(data ? toDraft(data) : null), [data])

  // Guarded on `!data`, not bare `loading`/`error`: saving this form calls
  // this hook's own reload(), which flips `loading` true for one tick. An
  // unguarded early return here would unmount the whole form — discarding
  // its in-flight `saving`/`saved` state and flashing a spinner over it —
  // on literally every save. Once real data exists, keep rendering it
  // through a background refresh instead of tearing the tree down.
  if (loading && !data) return <LoadingState label="Loading notification settings…" />
  if (error && !data) return <ErrorState error={error} onRetry={reload} />
  if (!data || !draft) return null

  const initial = toDraft(data)
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial)

  async function handleSave() {
    if (!draft) return
    setSaving(true)
    setSaveError(null)
    try {
      await api.patch('/settings/workspace', draft)
      await reload()
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (caught) {
      setSaveError(caught instanceof ApiError ? caught.message : 'Could not save notification settings')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="gap-0 overflow-hidden p-0">
      <SectionHeader
        icon={Bell}
        title="Notifications"
        description="What the workspace should surface, and to whom."
      />

      <div className="flex flex-col divide-y divide-border">
        {ROWS.map((row) => (
          <div key={row.key} className="flex items-center justify-between gap-4 p-5">
            <div>
              <p className="text-sm font-medium">{row.label}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{row.hint}</p>
            </div>
            <Switch
              checked={draft[row.key]}
              onCheckedChange={(checked) => setDraft({ ...draft, [row.key]: checked })}
            />
          </div>
        ))}
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
  )
}
