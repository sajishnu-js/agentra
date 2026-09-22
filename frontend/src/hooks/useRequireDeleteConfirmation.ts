import { useApi } from '@/hooks/useApi'
import type { WorkspaceSettings } from '@/lib/types'

/**
 * Whether a destructive action should ask "are you sure?" first — the
 * Security settings "Require confirmation for deletes" toggle, actually
 * read rather than persisted and ignored. Defaults to true (the safe side)
 * while the setting is still loading, so a slow response never
 * accidentally skips confirmation.
 */
export function useRequireDeleteConfirmation(): boolean {
  const { data } = useApi<WorkspaceSettings>('/settings/workspace')
  return data?.require_confirmation_for_deletes ?? true
}
