import {
  BookOpen,
  Bot,
  Building2,
  CircleUserRound,
  Contact,
  FileText,
  Headset,
  MapPin,
  Send,
  Sparkles,
  UserCheck,
  UserCog,
  UserRound,
  Wrench,
  type LucideIcon,
} from 'lucide-react'

/**
 * The fixed set of icons an agent can be tagged with. Same lookup-map
 * pattern as `kbIcons.ts` — `icon` on the wire is just one of these keys.
 *
 * The five person-style entries (UserRound, Contact, UserCog, UserCheck,
 * CircleUserRound) are the "professional agent avatar, not a photo" set —
 * lucide's icon set doesn't distinguish gender meaningfully, so variety
 * comes from silhouette/pose rather than an arbitrary male/female split
 * that a single-color icon font can't actually convey. Bot/Headset/Send and
 * the earlier domain glyphs (Building2, Sparkles, Wrench, MapPin, FileText)
 * stay available for anything that isn't a named human-style specialist.
 */
export const agentIconMap: Record<string, LucideIcon> = {
  Bot,
  Headset,
  Send,
  Building2,
  Sparkles,
  Wrench,
  MapPin,
  FileText,
  BookOpen,
  UserRound,
  Contact,
  UserCog,
  UserCheck,
  CircleUserRound,
}

export const agentIconOptions = Object.keys(agentIconMap) as (keyof typeof agentIconMap)[]

export const agentIconFallback: keyof typeof agentIconMap = 'Bot'
