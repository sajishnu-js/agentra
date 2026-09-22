import { Moon, Sun } from 'lucide-react'

import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTheme } from '@/theme/ThemeProvider'

/**
 * The light/dark switch. Owns no colour of its own — the icons and track read
 * from tokens, so the control restyles itself along with everything else.
 */
export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()
  const isDark = theme === 'dark'

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="glass flex items-center gap-2.5 rounded-full py-1.5 pr-2 pl-3">
          <Sun
            aria-hidden
            className={
              isDark
                ? 'size-4 text-foreground-subtle transition-colors'
                : 'size-4 text-brand-text transition-colors'
            }
          />
          <Switch
            checked={isDark}
            onCheckedChange={toggleTheme}
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          />
          <Moon
            aria-hidden
            className={
              isDark
                ? 'size-4 text-brand-text transition-colors'
                : 'size-4 text-foreground-subtle transition-colors'
            }
          />
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      </TooltipContent>
    </Tooltip>
  )
}
