import type { AutoApplyConfig } from '../apply/types'

export const V2_RUN_STATUSES = [
  'queued',
  'opening',
  'application_detected',
  'filling',
  'uploading_resume',
  'navigating',
  'ready_to_submit',
  'submitting',
  'submitted',
  'needs_user_input',
  'captcha_required',
  'login_required',
  'mfa_required',
  'failed',
  'submission_uncertain',
  'cancelled',
] as const

export type V2RunStatus = (typeof V2_RUN_STATUSES)[number]

export const V2_TERMINAL_STATUSES: ReadonlySet<V2RunStatus> = new Set([
  'submitted',
  'needs_user_input',
  'captcha_required',
  'login_required',
  'mfa_required',
  'failed',
  'submission_uncertain',
  'cancelled',
])

export type V2RunSource = 'auto-apply' | 'start-one' | 'synthetic-test'

export type V2PageState =
  | 'JOB_PAGE'
  | 'APPLICATION_PAGE'
  | 'LOGIN_PAGE'
  | 'CAPTCHA_PAGE'
  | 'MFA_PAGE'
  | 'ERROR_PAGE'
  | 'UNKNOWN'

export type V2Provider =
  | 'workday'
  | 'greenhouse'
  | 'lever'
  | 'ashby'
  | 'icims'
  | 'smartrecruiters'
  | 'workable'
  | 'generic'
  | 'unknown'

export interface V2JobRef {
  id: string
  title: string
  company: string
  location: string | null
  description: string | null
  applicationUrl: string
}

export interface V2QueueItem {
  runId: string
  source: V2RunSource
  campaignConfig: AutoApplyConfig | null
  jobsFound: number
  jobId: string
  title: string
  company: string
  location: string | null
  applicationUrl: string
  initialUrl: string | null
  finalUrl: string | null
  redirectChain: string[]
  resumeVersionId: string
  resumeVersionName: string
  userId: string
  status: V2RunStatus
  failureReason: string | null
  pageState: V2PageState | null
  provider: V2Provider | null
  fieldsDetected: string[]
  fieldsFilled: string[]
  resumeUploaded: boolean
  submitClicked: boolean
  confirmationNumber: string | null
  confirmationText: string | null
  confirmationEvidence: string[]
  submittedAt: string | null
  jdSnapshot: string | null
  applicationRecordId: string | null
  persistedJobId: string | null
  submittedResumeVersionId: string | null
  submittedResumeText: string | null
  createdAt: string
  updatedAt: string
}

export interface V2Resume {
  versionId: string
  versionName: string
  fileName: string
  mimeType: string
  buffer: Buffer
  text: string
}

export interface V2DetectedField {
  key: string
  label: string
  required: boolean
  kinds: string[]
}

export interface V2Confirmation {
  attempted: boolean
  confirmed: boolean
  confirmationNumber: string | null
  confirmationText: string | null
  finalUrl: string | null
  evidence: string[]
}

export interface V2Session {
  runId: string
  jobId: string
  userId: string
  resumeVersionId: string
  currentUrl: string | null
  provider: V2Provider | null
  state: V2RunStatus
  step: number
  updatedAt: string
}
