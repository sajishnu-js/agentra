/**
 * The eight accent themes, as WebGL scene colors.
 *
 * Everything DOM-rendered gets its colors from CSS custom properties in
 * index.css (see the `html[data-accent="..."]` blocks) — a class/attribute
 * swap re-themes it for free. Three.js material colors can't reference CSS
 * variables, so the scene files (scene/*.tsx) import this instead. Keeping
 * it here rather than duplicating hex values in each scene file means there
 * is exactly one place to add another theme later.
 *
 * Ten named roles per accent, not just "primary/secondary" — the scenes
 * already used ten-ish distinct shades (bright/dark pairs per hue, plus
 * light tints for sparkles) to get real depth. Each accent reuses that same
 * structure, hue-shifted, so every scene keeps the exact balance it was
 * tuned with instead of going flat when re-colored.
 *
 * Nebula was removed for one turn (rolled back to a fixed four) and then
 * explicitly restored — its palette below is reconstructed from this exact
 * file's own prior values (indigo/sky-blue/fuchsia), not a fresh guess.
 * Ember and Opal are new: each a deliberate three-hue combination rather
 * than a single hue with light/dark variants, matching Nebula's own
 * "three real colours, not one blend" brief.
 */

export type Accent =
  | 'brown'
  | 'silver'
  | 'blue'
  | 'green'
  | 'nebula'
  | 'ember'
  | 'opal'
  | 'black'

export const ACCENTS: Accent[] = [
  'brown',
  'silver',
  'blue',
  'green',
  'nebula',
  'ember',
  'opal',
  'black',
]

export type ScenePalette = {
  primary: string
  primaryDark: string
  secondary: string
  secondaryDark: string
  tertiary: string
  quaternary: string
  quinary: string
  tintLight: string
  tintLighter: string
  tintPale: string
}

export const scenePalettes: Record<Accent, ScenePalette> = {
  brown: {
    primary: '#cc7a3d',
    primaryDark: '#a8672e',
    secondary: '#d4af37',
    secondaryDark: '#c2703d',
    tertiary: '#b5654a',
    quaternary: '#6b4423',
    quinary: '#8b5e34',
    tintLight: '#e8a86c',
    tintLighter: '#e8c98a',
    tintPale: '#f0dcae',
  },
  silver: {
    primary: '#a8b4c2',
    primaryDark: '#7c8a99',
    secondary: '#c4b39a',
    secondaryDark: '#9a8a6f',
    tertiary: '#8aada8',
    quaternary: '#4a5568',
    quinary: '#6b7684',
    tintLight: '#cbd5e0',
    tintLighter: '#dde4ea',
    tintPale: '#eef1f4',
  },
  blue: {
    primary: '#5b8cf5',
    primaryDark: '#2f6fed',
    secondary: '#22d3ee',
    secondaryDark: '#0e7490',
    tertiary: '#a78bfa',
    quaternary: '#1e3a8a',
    quinary: '#3b6fe0',
    tintLight: '#93b4fa',
    tintLighter: '#bfd4fb',
    tintPale: '#e0ecfe',
  },
  green: {
    primary: '#34c274',
    primaryDark: '#22a35a',
    secondary: '#2dd4bf',
    secondaryDark: '#0d9488',
    tertiary: '#9caf5c',
    quaternary: '#14532d',
    quinary: '#29b366',
    tintLight: '#6ee7a0',
    tintLighter: '#a7f3c6',
    tintPale: '#d4f7e0',
  },
  // The one deliberately two-hued theme (three counting the tertiary
  // fuchsia): indigo and sky-blue as the two point-lights, plus a fuchsia
  // tertiary so the classic nebula-photo palette — blue, violet, pink
  // clouds — reads as three real colours in the scene rather than one
  // purple-blue smear.
  nebula: {
    primary: '#6366f1',
    primaryDark: '#4338ca',
    secondary: '#38bdf8',
    secondaryDark: '#0284c7',
    tertiary: '#e879f9',
    quaternary: '#1e1b4b',
    quinary: '#818cf8',
    tintLight: '#a5b4fc',
    tintLighter: '#bae6fd',
    tintPale: '#e0e7ff',
  },
  // Sunset/molten: orange and hot pink as the two point-lights, gold as the
  // tertiary — a warm counterpart to Nebula's cool three-hue approach.
  ember: {
    primary: '#f97316',
    primaryDark: '#c2410c',
    secondary: '#ec4899',
    secondaryDark: '#be185d',
    tertiary: '#fbbf24',
    quaternary: '#7c2d12',
    quinary: '#ea580c',
    tintLight: '#fdba74',
    tintLighter: '#fed7aa',
    tintPale: '#ffedd5',
  },
  // Iridescent gem: teal and violet as the two point-lights, rose as the
  // tertiary — cool like Nebula but teal-forward rather than indigo-forward,
  // so the two read as clearly different themes side by side.
  opal: {
    primary: '#2dd4bf',
    primaryDark: '#0d9488',
    secondary: '#a78bfa',
    secondaryDark: '#7c3aed',
    tertiary: '#f472b6',
    quaternary: '#134e4a',
    quinary: '#5eead4',
    tintLight: '#99f6e4',
    tintLighter: '#ccfbf1',
    tintPale: '#f0fdfa',
  },
  // Glossy Black: the only fully achromatic palette. Every value is a true
  // neutral — no hue at all — which is what separates it from Silver, whose
  // "grey" is actually a blue-grey mixed with warm sand and sage. Side by
  // side, Silver reads as brushed alloy and this reads as polished obsidian.
  //
  // `primaryDark` is pushed much darker than the pattern elsewhere on
  // purpose: the light-mode hero renders the spiral in `primaryDark`, and a
  // mid-grey chrome on a near-white page has no silhouette left. Dark mode
  // uses `tintLight`, so it still gets a bright platinum coil against black.
  black: {
    primary: '#e4e4e7',
    primaryDark: '#52525b',
    secondary: '#a1a1aa',
    secondaryDark: '#3f3f46',
    tertiary: '#d4d4d8',
    quaternary: '#18181b',
    quinary: '#71717a',
    tintLight: '#f4f4f5',
    tintLighter: '#fafafa',
    tintPale: '#ffffff',
  },
}

export const accentLabel: Record<Accent, string> = {
  brown: 'Glossy Brown',
  silver: 'Glossy Silver',
  blue: 'Glossy Blue',
  green: 'Glossy Green',
  nebula: 'Glossy Nebula',
  ember: 'Glossy Ember',
  opal: 'Glossy Opal',
  black: 'Glossy Black',
}

/** Two stops for the glossy-orb swatch preview in ThemeSelector. */
export const accentSwatch: Record<Accent, { from: string; to: string }> = {
  brown: { from: '#e0a868', to: '#7a4a1f' },
  silver: { from: '#dde4ea', to: '#5a6472' },
  blue: { from: '#93b4fa', to: '#1d4ed8' },
  green: { from: '#8ff0b8', to: '#0d7a4a' },
  // Sweeps light blue to deep violet in one gradient — the orb itself shows
  // the "blue and purple combined" pitch, not just a single in-between hue.
  nebula: { from: '#7dd3fc', to: '#4c1d95' },
  // Gold to magenta — the warm equivalent sweep.
  ember: { from: '#fcd34d', to: '#be185d' },
  // Light teal to violet.
  opal: { from: '#5eead4', to: '#7c3aed' },
  // Platinum to near-black — the orb itself is the pitch: a polished black
  // marble catching one highlight.
  black: { from: '#f4f4f5', to: '#111113' },
}
