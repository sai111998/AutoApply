import type { C2cEvidence, C2cStatus, JobTypeFilter } from '../jobs/c2c'
import type { LiveJob } from '../jobs/list'
import type { RemoteFilter } from '../jobs/types'

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
  | 'blocked'
  | 'ready_for_submission'
  | 'submitted'
  | 'failed'
  | 'skipped'
  | 'cancelled'

export type AutoApplyRunStatus = 'running' | 'paused' | 'completed' | 'cancelled'

export interface AutoApplyConfig {
  maxJobs: number
  minimumMatchRate: number
  autoTailorResume: boolean
  jobType: JobTypeFilter
  remotePreference: RemoteFilter
  keywords: string[]
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
  source: 'profile' | 'user'
}

export interface AutoApplyQueueItem {
  id: string
  runId: string
  jobId: string
  identityKey: string
  applicationId: string | null
  resumeVersionId: string | null
  resumeVersionName: string
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
  masterResumeUnchanged: boolean
  sessionId: string | null
  createdAt: string
  updatedAt: string
}

export interface AutoApplyCounts {
  found: number
  eligible: number
  tailored: number
  ready: number
  needsInput: number
  submitted: number
  skipped: number
  failed: number
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

export interface BrowserPrepareResult {
  status: AutoApplyQueueStatus
  questions: AutoApplyQuestion[]
  failureReason: string | null
  sessionId: string | null
}

export interface BrowserSubmitResult {
  status: 'submitted' | 'needs_user_input' | 'captcha_required' | 'mfa_required' | 'blocked' | 'failed'
  failureReason: string | null
}

export interface ApplyBrowser {
  prepare(input: BrowserPrepareInput): Promise<BrowserPrepareResult>
  submit(sessionId: string): Promise<BrowserSubmitResult>
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
  | 'c2cStatus'
  | 'c2cEvidence'
  | 'match'
  | 'matchScore'
  | 'postedAt'
  | 'fetchedAt'
>
