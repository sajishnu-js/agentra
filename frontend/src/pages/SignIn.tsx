import { Bot } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'

import { useAuth } from '@/auth/AuthProvider'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ApiError } from '@/lib/api'

/**
 * The workspace's front door. No password behind this — see
 * backend/app/domains/auth/models.py — a known workspace email is enough to
 * open a session, which is the honest tradeoff for a self-hosted internal
 * tool run by one team on trusted infrastructure. New staff are added by an
 * admin first (Settings → Users); there is no self-registration here.
 *
 * Reached two ways: as the gate `RequireAuth` renders in place of the app
 * when Login Requirement is on and there's no session (App.tsx swaps it out
 * for AppShell automatically once signIn() resolves, no navigation needed),
 * or directly at /signin — the "still available, just not forced" entry
 * point when Login Requirement is off (an implicit identity is already in
 * the workspace and wants to sign in as themselves instead). The explicit
 * navigate() below only matters for that second path.
 */
export function SignIn() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await signIn(email.trim())
      navigate('/app')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in — try again')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-4">
      <div
        aria-hidden
        className="ambient-glow absolute -top-24 -left-24 size-72 bg-brand opacity-20"
      />
      <div
        aria-hidden
        className="ambient-glow absolute -right-24 bottom-0 size-80 bg-brand-2 opacity-[0.15]"
      />

      <Card className="tilt-3d glass-strong relative w-full max-w-sm p-8">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <span className="grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-brand/30 to-primary/30 shadow-glow">
            <Bot className="size-7 text-brand-text" />
          </span>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Sign in to Agentra</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Use your workspace email to continue
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Work email</Label>
            <Input
              id="email"
              type="email"
              autoFocus
              required
              placeholder="you@company.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="glass"
            />
          </div>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <Button type="submit" disabled={loading || !email} className="mt-1">
            {loading ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>

        <p className="mt-6 text-center text-xs text-foreground-subtle">
          New to this workspace? Ask an admin to add you under Settings → Users.
        </p>
      </Card>
    </div>
  )
}
