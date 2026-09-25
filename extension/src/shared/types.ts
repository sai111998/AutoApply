export const EXTENSION_PROVIDER_IDS = [
  'workday',
  'greenhouse',
  'lever',
  'ashby',
  'icims',
  'generic',
  'unknown',
] as const

export type ExtensionProviderId = (typeof EXTENSION_PROVIDER_IDS)[number]

export const EXTENSION_SESSION_STATES = [
  'idle',
  'detecting',
  'application_detected',
  'provider_detected',
  'ready',
  'needs_user_input',
  'captcha_required',
  'mfa_required',
  'login_required',
  'failed',
  'completed',
] as const

export type ExtensionSessionState = (typeof EXTENSION_SESSION_STATES)[number]

export const DETECTED_FIELD_IDS = [
  'firstName',
  'lastName',
  'email',
  'phone',
  'address',
  'city',
  'state',
  'zip',
  'country',
  'resume',
  'coverLetter',
  'linkedin',
  'github',
  'workAuthorization',
  'sponsorship',
  'yearsExperience',
] as const

export type DetectedFieldId = (typeof DETECTED_FIELD_IDS)[number]

export interface DetectedField {
  id: DetectedFieldId
  label: string
}

export interface DetectedButton {
  kind: 'apply' | 'next' | 'continue' | 'submit'
  label: string
}

export interface ChallengeDetection {
  captcha: boolean
  mfa: boolean
  login: boolean
}

export interface ApplicationDetection {
  isApplicationPage: boolean
  isJobDetailsPage: boolean
  confidence: number
  signals: string[]
  provider: ExtensionProviderId
  fields: DetectedField[]
  buttons: DetectedButton[]
  challenges: ChallengeDetection
  applyActions: string[]
}

export interface ExtensionSession {
  applicationSessionId: string
  jobId: string | null
  applicationId: string | null
  resumeVersionId: string | null
  userId: string
  provider: ExtensionProviderId
  currentUrl: string | null
  state: ExtensionSessionState
  failureReason: string | null
  detection: ApplicationDetection | null
  createdAt: string
  updatedAt: string
}

export interface ExtensionApplicationContext {
  userId: string
  job: {
    id: string
    title: string
    company: string
    applicationUrl: string | null
  } | null
  application: {
    id: string
    status: string
  } | null
  resume: {
    versionId: string | null
    name: string
  } | null
  profile: {
    fullName: string
    email: string
    location: string
  } | null
  questions: Array<{ id: string; prompt: string; answer: string | null }>
  session: ExtensionSession | null
}

export interface PageSnapshot {
  url: string
  title: string
  html: string
}
