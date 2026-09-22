import { Check } from 'lucide-react'
import { useMemo } from 'react'

import { AgentStatusPill } from '@/components/StatusPill'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useApi } from '@/hooks/useApi'
import { agentCapabilityMeta, agentCapabilityOptions } from '@/lib/agentCapabilities'
import { cn } from '@/lib/utils'
import type { Agent, AgentStatus, KnowledgeBaseSummary } from '@/lib/types'

/**
 * The one definition of "an agent's editable configuration", shared by the
 * dedicated Agent Configuration page and the Workflow section's own agent
 * editor. Both write to the same `PATCH /agents/{id}`, so an agent edited
 * from either place is the same row — which is exactly what keeps the two
 * sections synchronised instead of drifting into two half-agents.
 */

/** Fixed set, per the brief — no free-text model input. An agent's current
 * value is appended if it isn't already one of these, so an unusual existing
 * value is shown rather than silently replaced the moment this page loads. */
export const MODEL_OPTIONS = [
  'gemini-3.6-flash',
  'gemini-3.6-pro',
  'gemini-2.5-flash',
  'gemini-2.5-pro',
]

export type AgentDraft = {
  name: string
  description: string
  status: AgentStatus
  model: string
  system_prompt: string
  temperature: number
  knowledge_base_id: string
  icon: string
  guardrails: string
  tools_enabled: string[]
  response_behaviour: string
  fallback_message: string
  context_history_limit: number
  max_output_tokens: number
}

export function toAgentDraft(agent: Agent): AgentDraft {
  return {
    name: agent.name,
    description: agent.description ?? '',
    status: agent.status,
    model: agent.model,
    system_prompt: agent.system_prompt,
    temperature: agent.temperature,
    // Every agent has exactly one dedicated knowledge base (unique
    // constraint on agents.knowledge_base_id) — the `?? ''` only satisfies
    // the type for an Agent row that predates that invariant.
    knowledge_base_id: agent.knowledge_base_id ?? '',
    icon: agent.icon,
    guardrails: agent.guardrails,
    tools_enabled: agent.tools_enabled,
    response_behaviour: agent.response_behaviour,
    fallback_message: agent.fallback_message ?? '',
    context_history_limit: agent.context_history_limit,
    max_output_tokens: agent.max_output_tokens,
  }
}

export function agentDraftToPayload(draft: AgentDraft) {
  return {
    name: draft.name.trim(),
    description: draft.description.trim() || null,
    model: draft.model,
    system_prompt: draft.system_prompt,
    temperature: draft.temperature,
    knowledge_base_id: draft.knowledge_base_id,
    icon: draft.icon,
    guardrails: draft.guardrails,
    tools_enabled: draft.tools_enabled,
    response_behaviour: draft.response_behaviour,
    fallback_message: draft.fallback_message.trim() || null,
    context_history_limit: draft.context_history_limit,
    max_output_tokens: draft.max_output_tokens,
  }
}

export function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {description ? (
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children}
    </div>
  )
}

/**
 * Every agent has exactly one dedicated knowledge base (unique constraint on
 * agents.knowledge_base_id) — so there is no "None" option, and the list
 * excludes any KB another agent already owns, showing only this agent's
 * current one plus whatever is still unclaimed. Reassigning to a KB someone
 * else owns is a 400 the backend would reject anyway; filtering it out here
 * means that rejection never has a reason to surface.
 */
export function KnowledgeBaseSelect({
  value,
  onChange,
  id,
}: {
  value: string
  onChange: (v: string) => void
  id?: string
}) {
  const { data } = useApi<KnowledgeBaseSummary[]>('/knowledge-base/collections')
  const options = (data ?? []).filter((kb) => kb.id === value || kb.agents.length === 0)
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder="Choose a knowledge base…" />
      </SelectTrigger>
      <SelectContent>
        {options.map((kb) => (
          <SelectItem key={kb.id} value={kb.id}>
            {kb.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function AgentConfigFields({
  draft,
  set,
}: {
  draft: AgentDraft
  set: <K extends keyof AgentDraft>(key: K, value: AgentDraft[K]) => void
}) {
  const modelOptions = useMemo(
    () => (MODEL_OPTIONS.includes(draft.model) ? MODEL_OPTIONS : [draft.model, ...MODEL_OPTIONS]),
    [draft.model],
  )

  return (
    <div className="flex flex-col gap-7">
      <Section title="Agent name and description">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cfg-name">Name</Label>
            <Input
              id="cfg-name"
              value={draft.name}
              onChange={(e) => set('name', e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cfg-description">Description</Label>
            <Textarea
              id="cfg-description"
              rows={2}
              value={draft.description}
              onChange={(e) => set('description', e.target.value)}
            />
          </div>
        </div>
      </Section>

      <Section
        title="Model"
        description="Gemini models only — this app talks to no other LLM backend."
      >
        <Select value={draft.model} onValueChange={(v) => set('model', v)}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {modelOptions.map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Section>

      <Section
        title="System prompt / instructions"
        description="This agent's persona and responsibilities. Layered on top of this app's fixed grounding and safety rules — it can't turn those off."
      >
        <Textarea
          rows={6}
          className="text-xs leading-relaxed"
          value={draft.system_prompt}
          onChange={(e) => set('system_prompt', e.target.value)}
        />
      </Section>

      <Section
        title="Guardrails & safety rules"
        description="Specific rules this agent must never break, kept separate from persona so they don't get lost in tone-setting prose."
      >
        <Textarea
          rows={4}
          className="text-xs leading-relaxed"
          placeholder="e.g. Never confirm a booking without checking availability first."
          value={draft.guardrails}
          onChange={(e) => set('guardrails', e.target.value)}
        />
      </Section>

      <Section title="Knowledge base">
        <KnowledgeBaseSelect
          value={draft.knowledge_base_id}
          onChange={(v) => set('knowledge_base_id', v)}
        />
      </Section>

      <Section
        title="Tools / capabilities"
        description="What this agent is expected to handle — shapes the prompt, not a live tool-execution grant (this app has no function-calling framework yet)."
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {agentCapabilityOptions.map((key) => {
            const meta = agentCapabilityMeta[key]
            const CapIcon = meta.icon
            const checked = draft.tools_enabled.includes(key)
            return (
              <button
                key={key}
                type="button"
                onClick={() =>
                  set(
                    'tools_enabled',
                    checked
                      ? draft.tools_enabled.filter((t) => t !== key)
                      : [...draft.tools_enabled, key],
                  )
                }
                className={cn(
                  'flex items-start gap-2.5 rounded-lg border p-3 text-left transition-colors',
                  checked ? 'border-brand/40 bg-brand-soft' : 'border-border hover:bg-accent/50',
                )}
              >
                <span
                  className={cn(
                    'grid size-7 shrink-0 place-items-center rounded-md',
                    checked ? 'bg-brand text-primary-foreground' : 'bg-muted text-muted-foreground',
                  )}
                >
                  {checked ? <Check className="size-3.5" /> : <CapIcon className="size-3.5" />}
                </span>
                <span className="min-w-0">
                  <span className="block text-xs font-medium">{meta.label}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {meta.description}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      </Section>

      <Section
        title="Response behaviour"
        description="Tone, length, and formatting guidance — kept separate from the persona above."
      >
        <Textarea
          rows={3}
          className="text-xs leading-relaxed"
          placeholder="e.g. Concise, 2-3 sentences unless asked for detail. Warm but professional."
          value={draft.response_behaviour}
          onChange={(e) => set('response_behaviour', e.target.value)}
        />
      </Section>

      <div className="grid grid-cols-2 gap-4">
        <Section title="Temperature" description="Lower is more literal and consistent.">
          <Input
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={draft.temperature}
            onChange={(e) => set('temperature', Number(e.target.value))}
          />
        </Section>
        <Section title="Context / memory" description="Prior messages included when replying. 0 = none.">
          <Input
            type="number"
            min={0}
            max={20}
            step={1}
            value={draft.context_history_limit}
            onChange={(e) => set('context_history_limit', Number(e.target.value))}
          />
        </Section>
      </div>

      <Section
        title="Fallback / error handling"
        description="Sent instead of this app's default bilingual holding reply when this agent hands over to a person. Leave blank to keep the default."
      >
        <Textarea
          rows={2}
          placeholder="Default: “Thanks for reaching out — a team member will follow up with you shortly.” (and the Arabic equivalent)"
          value={draft.fallback_message}
          onChange={(e) => set('fallback_message', e.target.value)}
        />
      </Section>

      <Section title="Token / output settings" description="Ceiling on how long a single reply can run.">
        <Input
          type="number"
          min={256}
          max={8192}
          step={256}
          value={draft.max_output_tokens}
          onChange={(e) => set('max_output_tokens', Number(e.target.value))}
        />
      </Section>

      <Section
        title="Enable / disable"
        description="A paused agent keeps its configuration but won't be offered as an inbox's default agent."
      >
        <div className="flex items-center gap-2">
          <AgentStatusPill status={draft.status} />
          <Badge variant="outline">
            {draft.status === 'active' ? 'Answering live conversations' : 'Not currently routed'}
          </Badge>
        </div>
      </Section>
    </div>
  )
}
