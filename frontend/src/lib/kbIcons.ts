import {
  BarChart3,
  BookOpen,
  Building2,
  ClipboardCheck,
  FileText,
  GraduationCap,
  MapPin,
  MessageCircle,
  Package,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Truck,
  Wallet,
  Wrench,
  type LucideIcon,
} from 'lucide-react'

/**
 * The fixed set of icons a knowledge base can be tagged with. `icon` on the
 * wire is just one of these keys — a lookup map here keeps the icon picker
 * and the tile renderer in sync with a single source of truth, same pattern
 * as `channelIcon` in Inboxes.tsx.
 *
 * Truck/ClipboardCheck/Package/ShieldCheck/BarChart3 added for the
 * procurement knowledge bases (suppliers, requisitions, purchase orders,
 * compliance/contracts, spend analytics) — the original set was built for a
 * clinic + HR demo, then a UAE-services demo, and had nothing procurement-
 * shaped for either.
 */
export const kbIconMap: Record<string, LucideIcon> = {
  BookOpen,
  Stethoscope,
  Wallet,
  MessageCircle,
  Building2,
  GraduationCap,
  Sparkles,
  FileText,
  Wrench,
  MapPin,
  Truck,
  ClipboardCheck,
  Package,
  ShieldCheck,
  BarChart3,
}

export const kbIconOptions = Object.keys(kbIconMap) as (keyof typeof kbIconMap)[]

/** Fallback for an icon key that doesn't match the fixed set above (e.g. the
 * set changes later and older knowledge bases keep their old key). Look this
 * up with `kbIconMap[icon] ?? kbIconMap[kbIconFallback]` — a plain object
 * index, not a function call, so it doesn't read as constructing a component
 * during render. */
export const kbIconFallback: keyof typeof kbIconMap = 'BookOpen'
