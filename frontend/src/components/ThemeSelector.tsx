import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  Check,
  Circle,
  Coffee,
  Droplet,
  Droplets,
  Flame,
  Gem,
  Leaf,
  Orbit,
  Palette,
  type LucideIcon,
} from 'lucide-react'

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTilt } from '@/hooks/useTilt'
import { ACCENTS, accentLabel, accentSwatch, type Accent } from '@/theme/accentPalettes'
import { useTheme } from '@/theme/ThemeProvider'
import { cn } from '@/lib/utils'

/** One glyph per accent — shown on the orb itself, not just a bare colour
 *  dot, so "icons and colours" both read at a glance. Picked for the
 *  material each theme evokes rather than anything literal. */
const accentIcon: Record<Accent, LucideIcon> = {
  brown: Coffee,
  silver: Gem,
  blue: Droplet,
  green: Leaf,
  nebula: Orbit,
  ember: Flame,
  opal: Droplets,
  black: Circle,
}

/**
 * A glossy sphere in one accent's colours — a radial gradient body plus a
 * specular highlight near the top-left to read as a lit glass/chrome marble,
 * combined with the app's existing pointer-tilt mechanism (useTilt/.tilt-3d,
 * the same one StatTile and the landing button use) for real 3D rotation and
 * a cursor-tracking glow. No WebGL: a second canvas per swatch would multiply
 * GPU contexts for four tiny always-visible dots, which is not worth it when
 * CSS gets the same "glossy and interactive" read for free.
 *
 * Idle state shows the accent's icon; hover/selected crossfades to a
 * checkmark plus a lift + brighter glow, so the hover moment itself feels
 * deliberate rather than just a colour swap.
 */
export function AccentOrb({
  accent,
  selected,
  size = 'md',
  onSelect,
}: {
  accent: Accent
  selected: boolean
  size?: 'md' | 'lg'
  onSelect: () => void
}) {
  const tilt = useTilt<HTMLButtonElement>(18)
  const swatch = accentSwatch[accent]
  const Icon = accentIcon[accent]
  const dimension = size === 'lg' ? 'size-12 sm:size-14' : 'size-8'
  const iconSize = size === 'lg' ? 'size-5' : 'size-3.5'

  return (
    <button
      ref={tilt.ref}
      onMouseMove={tilt.onMouseMove}
      onMouseLeave={tilt.onMouseLeave}
      onClick={onSelect}
      type="button"
      aria-pressed={selected}
      aria-label={accentLabel[accent]}
      className={cn(
        'tilt-3d group relative shrink-0 rounded-full transition-[box-shadow,transform] duration-300 ease-out',
        'hover:scale-110 active:scale-95',
        dimension,
        selected && 'ring-2 ring-offset-2 ring-offset-background',
      )}
      style={
        {
          background: `radial-gradient(circle at 32% 26%, ${swatch.from} 0%, ${swatch.to} 78%)`,
          boxShadow: [
            `0 4px 16px -3px ${swatch.to}80`,
            'inset 0 -8px 12px -6px rgb(0 0 0 / 0.45)',
            'inset 0 5px 7px -3px rgb(255 255 255 / 0.55)',
          ].join(', '),
          ...(selected ? { '--tw-ring-color': swatch.to } : {}),
        } as React.CSSProperties
      }
    >
      {/* Specular highlight — the "glossy" cue a flat fill can't give. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-full"
        style={{
          background:
            'radial-gradient(circle at 30% 22%, rgb(255 255 255 / 0.9), transparent 45%)',
        }}
      />
      {/* Brightens further on hover — layered over the highlight above so it
          reads as the sphere catching more light, not a flat overlay. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-full bg-white opacity-0 transition-opacity duration-300 group-hover:opacity-15"
      />
      {/* Icon and checkmark crossfade — never both, never neither. */}
      <Icon
        aria-hidden
        className={cn(
          'absolute inset-0 m-auto text-white/85 drop-shadow-[0_1px_2px_rgb(0_0_0/0.5)] transition-opacity duration-200',
          iconSize,
          selected ? 'opacity-0' : 'opacity-100 group-hover:opacity-0',
        )}
      />
      <Check
        aria-hidden
        className={cn(
          'absolute inset-0 m-auto text-white drop-shadow-[0_1px_2px_rgb(0_0_0/0.5)] transition-all duration-200',
          iconSize,
          selected ? 'scale-100 opacity-100' : 'scale-75 opacity-0 group-hover:scale-100 group-hover:opacity-100',
        )}
      />
    </button>
  )
}

/**
 * Compact, top-right presentation for every dashboard screen — a single
 * small orb showing the active accent; clicking it opens the same four
 * choices in a dropdown. Kept separate from ThemeToggle (light/dark stays
 * its own control, per the brief) rather than merged into one mega-control.
 *
 * `size="lg"` is the opening page's own request: a more prominent trigger
 * there than the one every internal page's Topbar uses, without forking the
 * component or its dropdown contents — everything scales off one prop.
 */
export function ThemeSelectorCompact({ size = 'default' }: { size?: 'default' | 'lg' }) {
  const { accent, setAccent } = useTheme()
  const swatch = accentSwatch[accent]
  const large = size === 'lg'
  // Same pointer-driven 3D tilt as AccentOrb, on top of the ring below —
  // this trigger is small, so it leans on the same "chunky marble" feel
  // rather than inventing a new interaction just for its own sake.
  const tilt = useTilt<HTMLButtonElement>(16)

  return (
    <DropdownMenu.Root>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenu.Trigger asChild>
            <button
              ref={tilt.ref}
              onMouseMove={tilt.onMouseMove}
              onMouseLeave={tilt.onMouseLeave}
              type="button"
              aria-label={`Theme: ${accentLabel[accent]}`}
              className={cn(
                'tilt-3d glass group relative flex shrink-0 items-center justify-center rounded-full transition-[transform,background-color,border-color,box-shadow] duration-200 hover:border-brand/40 hover:shadow-glow',
                large ? 'size-14' : 'size-9',
              )}
            >
              {/* A small orbit, always turning — the cue that there is more
                  than one colour living behind this one button. Two nested
                  layers: the outer sets a fixed tilt so it reads as an
                  ellipse (a ring seen edge-on) rather than a flat circle;
                  the inner spins within that already-tilted plane, so the
                  dots trace the tilted ring instead of a flat one. */}
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-70 transition-opacity duration-200 group-hover:opacity-100"
              >
                <span
                  className="relative rounded-full border border-brand/40"
                  style={
                    large
                      ? { width: 46, height: 19, transform: 'rotate(-18deg)' }
                      : { width: 30, height: 12, transform: 'rotate(-18deg)' }
                  }
                >
                  <span className="orbit-spin absolute inset-0">
                    <span
                      aria-hidden
                      className={cn(
                        'absolute top-1/2 left-0 -translate-y-1/2 rounded-full',
                        large ? 'size-[4px]' : 'size-[3px]',
                      )}
                      style={{ background: 'var(--brand-text)', boxShadow: '0 0 4px var(--brand)' }}
                    />
                    <span
                      aria-hidden
                      className={cn(
                        'absolute top-1/2 right-0 -translate-y-1/2 rounded-full',
                        large ? 'size-[4px]' : 'size-[3px]',
                      )}
                      style={{ background: 'var(--brand-2)', boxShadow: '0 0 4px var(--brand-2)' }}
                    />
                  </span>
                </span>
              </span>

              <span
                aria-hidden
                className={cn(
                  'relative z-10 rounded-full transition-transform duration-200 group-hover:scale-110',
                  large ? 'size-7' : 'size-4.5',
                )}
                style={{
                  background: `radial-gradient(circle at 32% 26%, ${swatch.from} 0%, ${swatch.to} 78%)`,
                  boxShadow: [
                    'inset 0 -3px 4px -2px rgb(0 0 0 / 0.45)',
                    large ? `0 4px 18px -4px ${swatch.to}90` : '',
                  ]
                    .filter(Boolean)
                    .join(', '),
                }}
              />
            </button>
          </DropdownMenu.Trigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">Theme: {accentLabel[accent]}</TooltipContent>
      </Tooltip>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={10}
          className={cn(
            'glass-strong z-50 flex flex-col gap-3 rounded-2xl p-4',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-90',
            'data-[state=open]:slide-in-from-top-2',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-90',
            'duration-200',
          )}
        >
          <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.08em] text-foreground-subtle uppercase">
            <Palette className="size-3.5" />
            Theme
          </span>
          {/* Wraps: at size="lg" eight orbs on one row are ~560px, wider than
              a phone. Capped and centred so the grid reflows to two rows
              instead of running off the edge of the dropdown. */}
          <div className="flex max-w-[min(78vw,30rem)] flex-wrap items-center justify-center gap-3">
            {ACCENTS.map((option, i) => (
              <DropdownMenu.Item key={option} asChild className="outline-none">
                <div
                  className="flex animate-in flex-col items-center gap-1.5 fade-in-0 zoom-in-75 duration-300 fill-mode-backwards"
                  style={{ animationDelay: `${i * 50}ms` }}
                >
                  <AccentOrb
                    accent={option}
                    size={large ? 'lg' : 'md'}
                    selected={accent === option}
                    onSelect={() => setAccent(option)}
                  />
                  <span className="text-[10px] text-muted-foreground">{accentLabel[option].replace('Glossy ', '')}</span>
                </div>
              </DropdownMenu.Item>
            ))}
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
