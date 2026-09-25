import { randomUUID } from 'node:crypto'
import type {
  AutoApplyConfig,
  AutoApplyCounts,
  AutoApplyQueueItem,
  AutoApplyQueueStatus,
  AutoApplyRun,
  AutoApplyRunStatus,
  AutoApplyStartInput,
} from '../apply/types'
import { listLiveJobSnapshots } from '../jobs/live-store'
import { firstValidV2Job, loadV2Job, resolveV2ApplicationUrl, type V2JobOptions } from './application'
import { V2Error } from './errors'
import { rememberV2RunInputs } from './inputs'
import { logV2 } from './log'
import { requireV2Profile, v2Access } from './profile'
import { createV2Run } from './queue'
import { loadV2Resume } from './resume'
import { V2_TERMINAL_STATUSES, type V2JobRef, type V2QueueItem, type V2RunSource, type V2RunStatus } from './types'

export const V2_START_ONE_CONFIG: AutoApplyConfig = {
  maxJobs: 1,
  minimumMatchRate: 0,
  autoTailorResume: false,
  jobType: 'all',
  remotePreference: 'any',
  employmentType: 'any',
  keywords: [],
  jobTitles: [],
  excludedCompanies: [],
  q: '',
  country: 'US',
  state: '',
  location: '',
  concurrency: 1,
}

async function queueV2Job(input: {
  userId: string
  job: V2JobRef
  source: V2RunSource
  campaignConfig: AutoApplyConfig
  jobsFound: number
  resumeId?: string | null
  accessToken?: string | null
}): Promise<V2QueueItem> {
  const access = v2Access(input.accessToken)
  const profile = await requireV2Profile(input.userId, access)
  const resume = await loadV2Resume(input.userId, input.resumeId, access)
  const now = new Date().toISOString()
  const run = createV2Run({
    runId: randomUUID(),
    source: input.source,
    campaignConfig: input.campaignConfig,
    jobsFound: input.jobsFound,
    jobId: input.job.id,
    title: input.job.title,
    company: input.job.company,
    location: input.job.location,
    applicationUrl: input.job.applicationUrl,
    initialUrl: null,
    finalUrl: null,
    redirectChain: [],
    resumeVersionId: resume.versionId,
    resumeVersionName: resume.versionName,
    userId: input.userId,
    status: 'queued',
    failureReason: null,
    pageState: null,
    provider: null,
    fieldsDetected: [],
    fieldsFilled: [],
    resumeUploaded: false,
    submitClicked: false,
    confirmationNumber: null,
    confirmationText: null,
    confirmationEvidence: [],
    submittedAt: null,
    jdSnapshot: input.job.description,
    applicationRecordId: null,
    persistedJobId: null,
    submittedResumeVersionId: null,
    submittedResumeText: null,
    createdAt: now,
    updatedAt: now,
  })
  rememberV2RunInputs(run.runId, { profile, resume })
  logV2('RUN_QUEUED', { runId: run.runId, jobId: run.jobId, source: run.source })
  return run
}

export async function startV2AutoApply(
  input: { userId: string; jobId: string; accessToken?: string | null } & V2JobOptions,
): Promise<{ runId: string; status: 'queued' }> {
  if (!input.userId?.trim()) throw new V2Error('PROFILE_AUTH_REQUIRED', 'Authentication required.', 401)
  if (!input.jobId?.trim()) throw new V2Error('JOB_NOT_FOUND', 'jobId is required.', 400)
  const job = loadV2Job(input.userId, input.jobId, input)
  const source: V2RunSource = input.allowSyntheticEmployer ? 'synthetic-test' : 'start-one'
  if (source === 'start-one') {
    logV2('REAL_JOB_SELECTED', { jobId: job.id, company: job.company, applicationUrl: job.applicationUrl })
  }
  const run = await queueV2Job({
    userId: input.userId,
    job,
    source,
    campaignConfig: V2_START_ONE_CONFIG,
    jobsFound: 1,
    accessToken: input.accessToken,
  })
  return { runId: run.runId, status: 'queued' }
}

export async function startV2AutoApplyCampaign(input: AutoApplyStartInput, accessToken?: string | null) {
  if (!input.userId?.trim()) throw new V2Error('PROFILE_AUTH_REQUIRED', 'Authentication required.', 401)
  const liveJobs = listLiveJobSnapshots()
    .filter((job) => job.provider !== 'synthetic' && job.source !== 'synthetic')
    .sort((left, right) => (right.fetchedAt ?? '').localeCompare(left.fetchedAt ?? ''))
  const job = firstValidV2Job(
    input.userId,
    liveJobs.map((entry) => ({
      id: entry.id,
      title: entry.title,
      company: entry.company,
      location: entry.location,
      description: entry.description,
      applicationUrl: resolveV2ApplicationUrl(entry) ?? '',
    })),
  )
  if (!job) {
    throw new V2Error(
      'JOB_NOT_FOUND',
      'No loaded live job has a title, company, description, and valid application URL. Search Live Jobs, then start Auto Apply again.',
      404,
    )
  }
  logV2('REAL_JOB_SELECTED', { jobId: job.id, company: job.company, applicationUrl: job.applicationUrl })
  const run = await queueV2Job({
    userId: input.userId,
    job,
    source: 'auto-apply',
    campaignConfig: input.config,
    jobsFound: liveJobs.length,
    resumeId: input.resumeId,
    accessToken,
  })
  return { campaignId: run.runId, status: 'running' as const, ...toAutoApplyRunResult(run) }
}

const IN_PROGRESS_STATUSES: ReadonlySet<V2RunStatus> = new Set([
  'opening',
  'application_detected',
  'filling',
  'uploading_resume',
  'navigating',
  'ready_to_submit',
  'submitting',
])

const INTERVENTION_STATUSES: ReadonlySet<V2RunStatus> = new Set([
  'needs_user_input',
  'captcha_required',
  'login_required',
  'mfa_required',
  'submission_uncertain',
])

const QUEUE_STATUS: Record<V2RunStatus, AutoApplyQueueStatus> = {
  queued: 'queued',
  opening: 'opening',
  application_detected: 'opening',
  filling: 'filling',
  uploading_resume: 'filling',
  navigating: 'filling',
  ready_to_submit: 'ready_for_submission',
  submitting: 'submitting',
  submitted: 'submitted',
  needs_user_input: 'needs_user_input',
  captcha_required: 'captcha_required',
  login_required: 'login_required',
  mfa_required: 'mfa_required',
  failed: 'failed',
  submission_uncertain: 'submission_uncertain',
  cancelled: 'cancelled',
}

function runStatus(status: V2RunStatus): AutoApplyRunStatus {
  if (status === 'submitted') return 'completed'
  if (status === 'failed') return 'failed'
  if (status === 'cancelled') return 'cancelled'
  if (INTERVENTION_STATUSES.has(status)) return 'needs_attention'
  return 'running'
}

export function toAutoApplyRunResult(run: V2QueueItem): { run: AutoApplyRun; items: AutoApplyQueueItem[] } {
  const submitted = run.status === 'submitted'
  const counts: AutoApplyCounts = {
    found: Math.max(run.jobsFound, 1),
    eligible: 1,
    autoApplyCapable: 1,
    tailored: 0,
    ready: run.status === 'ready_to_submit' ? 1 : 0,
    needsInput: run.status === 'needs_user_input' ? 1 : 0,
    submitted: submitted ? 1 : 0,
    skipped: 0,
    failed: run.status === 'failed' ? 1 : 0,
    queued: run.status === 'queued' ? 1 : 0,
    processing: IN_PROGRESS_STATUSES.has(run.status) ? 1 : 0,
    processed: V2_TERMINAL_STATUSES.has(run.status) && run.status !== 'cancelled' ? 1 : 0,
    blocked: ['captcha_required', 'login_required', 'mfa_required'].includes(run.status) ? 1 : 0,
    captcha: run.status === 'captcha_required' ? 1 : 0,
  }
  const item: AutoApplyQueueItem = {
    id: run.runId,
    runId: run.runId,
    jobId: run.persistedJobId ?? run.jobId,
    identityKey: `live:${run.jobId}`,
    applicationId: run.applicationRecordId,
    resumeVersionId: submitted ? run.submittedResumeVersionId : run.resumeVersionId,
    resumeVersionName: submitted && run.submittedResumeVersionId ? `Submitted — ${run.title}` : run.resumeVersionName,
    sourceResumeId: run.resumeVersionId,
    title: run.title,
    company: run.company,
    applicationUrl: run.finalUrl ?? run.applicationUrl,
    initialMatchScore: null,
    finalMatchScore: null,
    c2cStatus: 'unknown',
    c2cEvidence: [],
    applicationStatus: QUEUE_STATUS[run.status],
    failureReason: run.failureReason,
    questions: [],
    tailoredResumeText: submitted ? run.submittedResumeText : null,
    jobDescriptionSnapshot: run.jdSnapshot,
    location: run.location,
    confirmationNumber: run.confirmationNumber,
    confirmationText: run.confirmationText,
    submittedAt: run.submittedAt,
    masterResumeUnchanged: true,
    sessionId: run.runId,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    applicationProvider: run.provider,
    initialUrl: run.initialUrl ?? run.applicationUrl,
    redirectUrls: run.redirectChain,
    finalApplicationUrl: run.finalUrl,
  }
  return {
    run: {
      id: run.runId,
      userId: run.userId,
      status: runStatus(run.status),
      config: run.campaignConfig ?? V2_START_ONE_CONFIG,
      counts,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    },
    items: [item],
  }
}
