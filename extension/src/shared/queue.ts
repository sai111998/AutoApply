export interface AutomationQueueItem {
  runId: string
  itemId: string
  applicationId: string | null
  jobId: string
  applicationUrl: string
  company: string
  jobTitle: string
  resumeVersionId: string | null
  matchScore: number | null
  tailoredMatchScore: number | null
  provider: string
  status: string
}

export interface AgentProfileValues {
  firstName: string
  lastName: string
  email: string
  phone: string
  address: string
  city: string
  state: string
  zip: string
  country: string
  linkedin: string
  github: string
  workAuthorization: string
  sponsorship: string
  yearsExperience: string
}

export interface AuthorizedResume {
  versionId: string | null
  name: string
  fileName: string
  mimeType: string
  contentBase64: string
}

export const AUTOMATION_EVENT_TYPES = [
  'opening',
  'application_detected',
  'provider_detected',
  'filling',
  'needs_user_input',
  'captcha_required',
  'login_required',
  'mfa_required',
  'ready_for_review',
  'submitting',
  'submitted',
  'failed',
  'cancelled',
  'needs_confirmation',
] as const

export type AutomationEventType = (typeof AUTOMATION_EVENT_TYPES)[number]

export interface AutomationEvent {
  type: AutomationEventType
  runId?: string
  itemId?: string
  applicationId?: string | null
  currentUrl?: string | null
  provider?: string
  reason?: string | null
  questions?: Array<{ id: string; prompt: string; answer: string | null }>
  confirmationText?: string | null
  confirmationNumber?: string | null
}

export function splitFullName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  return { firstName: parts[0] ?? '', lastName: parts.slice(1).join(' ') }
}

export function parseLocation(location: string): { city: string; state: string } {
  const match = location.trim().match(/^([^,]+),\s*([A-Za-z]{2})$/)
  if (!match) return { city: '', state: '' }
  return { city: match[1].trim(), state: match[2].toUpperCase() }
}
