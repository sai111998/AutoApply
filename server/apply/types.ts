import type { C2cEvidence, C2cStatus, JobTypeFilter } from '../jobs/c2c'
import type { LiveJob } from '../jobs/list'
import type { EmploymentFilter, RemoteFilter } from '../jobs/types'
import type { ApplicationCapability } from './capability'
import type { ApplicationPreflightResult } from './preflight'

export type AutoApplyQueueStatus =
  | 'queued'
  | 'preparing'
  | 'tailoring'
  | 'ready'
  | 'opening'
  | 'filling'
  | 'needs_user_input'
  | 'captcha_required'
  | 'mfa_required'
  | 'login_required'
  | 'blocked'
  | 'automation_blocked'
  | 'extension_not_connected'
  | 'ready_for_submission'
  | 'submitting'
  | 'needs_user_confirmation'
  | 'needs_confirmation'
  | 'submitted'
  | 'failed'
  | 'skipped'
  | 'cancelled'

export type AutoApplyRunStatus =
  | 'stopped'
  | 'running'
  | 'paused'
  | 'needs_attention'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface AutoApplyConfig {
  maxJobs: number
  minimumMatchRate: number
  autoTailorResume: boolean
  jobType: JobTypeFilter
  remotePreference: RemoteFilter
  employmentType: EmploymentFilter
  keywords: string[]
  jobTitles: string[]
  excludedCompanies: string[]
  q: string
  country: string
  state: string
  location: string
  concurrency: number
}

export interface AutoApplyProfile {
  fullName: string
  email: string
  location: string
  yearsOfExperience: number | null
  workAuthorization: string | null
  sponsorshipRequired: boolean
  preferredWorkArrangement: string | null
  targetSalaryMin: number | null
  targetSalaryMax: number | null
}

export interface AutoApplyQuestion {
  id: string
  prompt: string
  answer: string | null
  source: 'profile' | 'user' | 'library'
}

export interface AutoApplyQueueItem {
  id: string
  runId: string
  jobId: string
  identityKey: string
  applicationId: string | null
  resumeVersionId: string | null
  resumeVersionName: string
  sourceResumeId?: string | null
  title: string
  company: string
  applicationUrl: string | null
  initialMatchScore: number | null
  finalMatchScore: number | null
  c2cStatus: C2cStatus
  c2cEvidence: C2cEvidence[]
  applicationStatus: AutoApplyQueueStatus
  failureReason: string | null
  questions: AutoApplyQuestion[]
  tailoredResumeText: string | null
  jobDescriptionSnapshot: string | null
  location: string | null
  confirmationNumber: string | null
  confirmationText: string | null
  submittedAt: string | null
  masterResumeUnchanged: boolean
  sessionId: string | null
  createdAt: string
  updatedAt: string
  applicationCapability?: ApplicationCapability
  discoverySource?: string | null
  applicationSource?: string | null
  applicationProvider?: string | null
  initialUrl?: string | null
  redirectUrls?: string[]
  finalApplicationUrl?: string | null
  preflight?: ApplicationPreflightResult | null
  captchaDetectionConfidence?: string | null
  captchaEvidence?: string[]
}

export interface AutoApplyCounts {
  found: number
  eligible: number
  autoApplyCapable: number
  tailored: number
  ready: number
  needsInput: number
  submitted: number
  skipped: number
  failed: number
  queued: number
  processing: number
  processed: number
  blocked: number
  captcha: number
}

export interface AutoApplyRun {
  id: string
  userId: string
  status: AutoApplyRunStatus
  config: AutoApplyConfig
  counts: AutoApplyCounts
  createdAt: string
  updatedAt: string
}

export interface ExistingApplicationRecord {
  jobId?: string | null
  identityKey?: string | null
  applicationUrl?: string | null
  status?: string | null
}

export interface AutoApplyStartInput {
  userId: string
  resumeId: string | null
  resumeVersionId: string | null
  resumeText: string
  masterResumeText: string
  profile: AutoApplyProfile
  config: AutoApplyConfig
  existingApplications?: ExistingApplicationRecord[]
  existingQueueIdentities?: string[]
}

export interface BrowserPrepareInput {
  url: string
  profile: AutoApplyProfile
  resumeText: string | null
  html?: string
}

export interface AutoApplyMutationResult {
  success: true
  run: AutoApplyRun
  items: AutoApplyQueueItem[]
  item: AutoApplyQueueItem
}

export interface BrowserPrepareResult {
  status: AutoApplyQueueStatus
  questions: AutoApplyQuestion[]
  failureReason: string | null
  sessionId: string | null
}

export interface BrowserSubmitResult {
  status:
    | 'submitted'
    | 'needs_user_input'
    | 'needs_user_confirmation'
    | 'needs_confirmation'
    | 'captcha_required'
    | 'mfa_required'
    | 'login_required'
    | 'blocked'
    | 'automation_blocked'
    | 'failed'
  failureReason: string | null
  success?: boolean
  confirmationDetected?: boolean
  confirmationNumber?: string
  confirmationText?: string
  resultingUrl?: string
  pageTitle?: string
  finalActionCompleted?: boolean
  reason?: string
}

export interface ApplyBrowser {
  prepare(input: BrowserPrepareInput): Promise<BrowserPrepareResult>
  submit(sessionId: string, context?: import('./confirm').BrowserSubmitContext): Promise<BrowserSubmitResult>
  close?(sessionId: string): Promise<void>
}

export type ListedAutoApplyJob = Pick<
  LiveJob,
  | 'id'
  | 'title'
  | 'company'
  | 'description'
  | 'url'
  | 'jobUrl'
  | 'identityKey'
  | 'provider'
  | 'providerJobId'
  | 'employmentType'
  | 'location'
  | 'c2cStatus'
  | 'c2cEvidence'
  | 'match'
  | 'matchScore'
  | 'postedAt'
  | 'fetchedAt'
> &
  Partial<Pick<LiveJob, 'rawMetadata' | 'applicationCapability' | 'applicationProvider' | 'discoveryProvider' | 'applicationUrl'>>
