import { Moon, Palette, Sun } from 'lucide-react'

import { useAuth } from '@/auth/AuthProvider'
import { AccentOrb } from '@/components/ThemeSelector'
import { Card } from '@/components/ui/card'
import { api } from '@/lib/api'
import { SectionHeader } from '@/pages/settings/shared'
import { ACCENTS, accentLabel } from '@/theme/accentPalettes'
import { useTheme } from '@/theme/ThemeProvider'

/**
 * Unlike every other section, there's no Save button here: theme changes
 * already apply instantly everywhere else in the app (the accent picker in
 * the Topbar works the same way), so this mirrors that — click, it's live,
 * and it's persisted to your profile in the background so it follows you to
 * another device next time you sign in.
 */
export function AppearanceSection() {
  const { theme, setTheme, accent, setAccent } = useTheme()
  const { refreshUser } = useAuth()

  function persist(next: { theme_preference?: string; accent_preference?: string }) {
    api.patch('/users/me', next).then(refreshUser).catch(() => {
      // Best-effort sync — the theme itself already applied locally via
      // ThemeProvider regardless of whether this round trip succeeds.
    })
  }

  return (
    <Card className="gap-0 overflow-hidden p-0">
      <SectionHeader
        icon={Palette}
        title="Appearance"
        description="Light or dark mode, and your accent colour — synced to your profile."
      />

      <div className="flex flex-col gap-6 p-5">
        <div>
          <p className="text-xs font-medium text-muted-foreground">Mode</p>
          <div className="mt-2.5 flex gap-3">
            {(['light', 'dark'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => {
                  setTheme(mode)
                  persist({ theme_preference: mode })
                }}
                aria-pressed={theme === mode}
                className={`glass flex flex-1 items-center justify-center gap-2 rounded-xl border py-3 text-sm font-medium transition-colors ${
                  theme === mode
                    ? 'border-brand/50 text-brand-text shadow-glow'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {mode === 'light' ? <Sun className="size-4" /> : <Moon className="size-4" />}
                {mode === 'light' ? 'Light' : 'Dark'}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs font-medium text-muted-foreground">Accent</p>
          <div className="mt-3 flex flex-wrap gap-5">
            {ACCENTS.map((option) => (
              <div key={option} className="flex flex-col items-center gap-2">
                <AccentOrb
                  accent={option}
                  size="lg"
                  selected={accent === option}
                  onSelect={() => {
                    setAccent(option)
                    persist({ accent_preference: option })
                  }}
                />
                <span className="text-[11px] text-muted-foreground">
                  {accentLabel[option].replace('Glossy ', '')}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  )
}
