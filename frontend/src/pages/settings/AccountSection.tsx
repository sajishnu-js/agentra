import { KeyRound } from 'lucide-react'
import { useMemo, useState } from 'react'

import { useAuth } from '@/auth/AuthProvider'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { longDateTime } from '@/lib/format'
import { SaveBar, SectionHeader, SettingsField } from '@/pages/settings/shared'
import { api, ApiError } from '@/lib/api'

/** The credential + account-lifecycle half of self-service editing — see
 * ProfileSection for the personal-identity half. There's no password to
 * change (see backend/app/domains/auth/models.py) — the account's email is
 * itself what a sign-in checks, so changing it here is the whole "change
 * how I sign in" story. */
export function AccountSection() {
  const { user, refreshUser, signOut } = useAuth()
  const initial = useMemo(() => user?.email ?? '', [user])
  const [email, setEmail] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  if (!user) return null

  const dirty = email.trim().toLowerCase() !== initial.toLowerCase()

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      await api.patch('/users/me', { email: email.trim() })
      await refreshUser()
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not update your email')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="gap-0 overflow-hidden p-0">
        <SectionHeader
          icon={KeyRound}
          title="Account"
          description="Your sign-in email and workspace membership."
        />

        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <SettingsField
            label="Sign-in email"
            htmlFor="account-email"
            hint="What you use to sign in — no password, just this address."
          >
            <Input
              id="account-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </SettingsField>
          <SettingsField label="Member since">
            <Input value={longDateTime(user.created_at)} disabled />
          </SettingsField>
        </div>

        <SaveBar
          dirty={dirty}
          saving={saving}
          error={error}
          saved={saved}
          onSave={handleSave}
          onReset={() => setEmail(initial)}
        />
      </Card>

      <Card className="flex flex-row items-center justify-between gap-4 p-5">
        <div>
          <p className="text-sm font-medium">Sign out</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            End your session on this device. See Sessions to manage every device at once.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => void signOut()}>
          Sign out
        </Button>
      </Card>
    </div>
  )
}
