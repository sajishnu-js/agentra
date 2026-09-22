import { Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'

import { ErrorState, LoadingState } from '@/components/StateBlock'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useApi } from '@/hooks/useApi'
import { api, ApiError } from '@/lib/api'
import type { WorkspaceSettings } from '@/lib/types'
import { SaveBar, SectionHeader, SettingsField } from '@/pages/settings/shared'

// Same fixed set as the per-agent picker (AgentConfig.tsx) — Gemini only,
// per the standing instruction that this app talks to one LLM backend.
const MODEL_OPTIONS = ['gemini-3.6-flash', 'gemini-3.6-pro', 'gemini-2.5-flash', 'gemini-2.5-pro']

type Draft = Pick<WorkspaceSettings, 'default_model' | 'default_temperature' | 'default_max_output_tokens'>

function toDraft(settings: WorkspaceSettings): Draft {
  return {
    default_model: settings.default_model,
    default_temperature: settings.default_temperature,
    default_max_output_tokens: settings.default_max_output_tokens,
  }
}

/** What a newly created agent starts from — not a live override of already
 * -configured agents, which each keep their own model/temperature/token
 * settings (AgentConfig.tsx) independently once created. */
export function AiModelSection() {
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
  if (loading && !data) return <LoadingState label="Loading AI defaults…" />
  if (error && !data) return <ErrorState error={error} onRetry={reload} />
  if (!data || !draft) return null

  const initial = toDraft(data)
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial)
  const modelOptions = MODEL_OPTIONS.includes(draft.default_model)
    ? MODEL_OPTIONS
    : [...MODEL_OPTIONS, draft.default_model]

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
      setSaveError(caught instanceof ApiError ? caught.message : 'Could not save AI defaults')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="gap-0 overflow-hidden p-0">
      <SectionHeader
        icon={Sparkles}
        title="AI & model"
        description="Defaults a newly created agent starts from."
      />

      <div className="grid gap-4 p-5 sm:grid-cols-3">
        <SettingsField label="Default model" htmlFor="ai-model">
          <Select value={draft.default_model} onValueChange={(value) => setDraft({ ...draft, default_model: value })}>
            <SelectTrigger id="ai-model" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {modelOptions.map((model) => (
                <SelectItem key={model} value={model}>
                  {model}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsField>
        <SettingsField label="Default temperature" htmlFor="ai-temperature" hint="Lower is more literal.">
          <Input
            id="ai-temperature"
            type="number"
            min={0}
            max={2}
            step={0.05}
            value={draft.default_temperature}
            onChange={(event) => setDraft({ ...draft, default_temperature: Number(event.target.value) })}
          />
        </SettingsField>
        <SettingsField label="Default max output tokens" htmlFor="ai-tokens">
          <Input
            id="ai-tokens"
            type="number"
            min={64}
            max={8192}
            step={64}
            value={draft.default_max_output_tokens}
            onChange={(event) => setDraft({ ...draft, default_max_output_tokens: Number(event.target.value) })}
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
  )
}
