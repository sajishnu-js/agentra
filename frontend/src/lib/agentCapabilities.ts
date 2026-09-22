import {
  Calendar,
  CreditCard,
  Image,
  Mic,
  ScanLine,
  Ticket,
  type LucideIcon,
} from 'lucide-react'

/**
 * The fixed set of capability tags an agent's `tools_enabled` can hold.
 *
 * Deliberately documentation, not live tool-calling: this app has no
 * function-execution framework (app/llm/gemini.py explicitly disables
 * automatic_function_calling), so selecting a tag here shapes what the
 * composed system prompt tells the model to expect handling — e.g. "you
 * will be shown transcribed voice notes" — rather than granting the model
 * any new ability to actually invoke something. Building real tool
 * execution is a separate, much larger project than agent configuration.
 */
export type AgentCapability = keyof typeof agentCapabilityMeta

export const agentCapabilityMeta = {
  image_analysis: {
    label: 'Image / vision analysis',
    description: 'Photos of damage, warning lights, documents, or IDs.',
    icon: Image as LucideIcon,
  },
  voice_transcription: {
    label: 'Voice note transcription',
    description: 'Customer voice messages, transcribed before this agent sees them.',
    icon: Mic as LucideIcon,
  },
  document_ocr: {
    label: 'Document OCR extraction',
    description: 'Passport, Emirates ID, or other document field extraction.',
    icon: ScanLine as LucideIcon,
  },
  appointment_scheduling: {
    label: 'Appointment / viewing scheduling',
    description: 'Booking a slot, checking availability, confirming a time.',
    icon: Calendar as LucideIcon,
  },
  payment_links: {
    label: 'Payment / deposit links',
    description: 'Issuing a deposit or payment link as part of a booking.',
    icon: CreditCard as LucideIcon,
  },
  request_escalation: {
    label: 'Request escalation',
    description: 'Raising a ticket in the Requests Hub for staff follow-up.',
    icon: Ticket as LucideIcon,
  },
} satisfies Record<string, { label: string; description: string; icon: LucideIcon }>

export const agentCapabilityOptions = Object.keys(agentCapabilityMeta) as AgentCapability[]
