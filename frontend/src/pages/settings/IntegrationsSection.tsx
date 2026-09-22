import { CheckCircle2, Plug, XCircle } from 'lucide-react'

import { ErrorState, LoadingState } from '@/components/StateBlock'
import { Card } from '@/components/ui/card'
import { useApi } from '@/hooks/useApi'
import type { IntegrationStatus } from '@/lib/types'
import { SectionHeader } from '@/pages/settings/shared'

function StatusRow({
  name,
  detail,
  configured,
  hint,
}: {
  name: string
  detail: string
  configured: boolean
  hint: string
}) {
  return (
    <div className="flex items-center justify-between gap-4 p-5">
      <div>
        <p className="text-sm font-medium">{name}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
        {!configured ? <p className="mt-1 text-[11px] text-foreground-subtle">{hint}</p> : null}
      </div>
      {configured ? (
        <span className="flex items-center gap-1.5 rounded-full bg-success/15 px-2.5 py-1 text-xs font-medium text-success">
          <CheckCircle2 className="size-3.5" />
          Configured
        </span>
      ) : (
        <span className="flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
          <XCircle className="size-3.5" />
          Not configured
        </span>
      )}
    </div>
  )
}

/**
 * Read-only introspection of env-configured integrations — never the secret
 * values, which live only in backend/.env per the standing instruction that
 * API keys are provided in the backend, not entered through this UI.
 */
export function IntegrationsSection() {
  const { data, error, loading, reload } = useApi<IntegrationStatus>('/settings/integrations')

  return (
    <Card className="gap-0 overflow-hidden p-0">
      <SectionHeader
        icon={Plug}
        title="Integrations"
        description="What's wired up on the backend — keys are set in backend/.env, never here."
      />

      {loading ? (
        <LoadingState label="Checking integrations…" />
      ) : error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : data ? (
        <div className="flex flex-col divide-y divide-border">
          <StatusRow
            name={`AI provider — ${data.llm_provider}`}
            detail={`Model: ${data.gemini_model}`}
            configured={data.gemini_configured}
            hint="Set GEMINI_API_KEY in backend/.env."
          />
          <StatusRow
            name="Telegram"
            detail="Inbound/outbound messaging channel"
            configured={data.telegram_configured}
            hint="Set TELEGRAM_BOT_TOKEN in backend/.env."
          />
        </div>
      ) : null}
    </Card>
  )
}
