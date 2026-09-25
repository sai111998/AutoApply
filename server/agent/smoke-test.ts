import { randomUUID } from 'node:crypto'
import { inspectApplicationUrl } from '../apply/validate'
import { applicationIdentity, hasDuplicateApplication, hasDuplicateQueueEntry, isJobExpired, isJobLive, jobApplicationUrl } from '../apply/eligibility'
import { defaultAutoApplyConfig } from '../apply/engine'
import { emptyCounts, recount, syncRunStatus } from '../apply/counts'
import { memoryStore, persistRun } from '../apply/store'
import { saveCandidateProfile, getCandidateProfile, candidateRequiredFieldsExist } from '../application/candidate-store'
import { hydrateCandidateStoreFromSupabase } from '../application/candidate-profile'
import { rememberAutoApplyProfile, rememberQueueResume } from '../extension/profile-store'
import { listConfirmedApplications } from '../apply/confirmed'
import { touchAgentHeartbeat } from '../automation/heartbeat'
import { listLiveJobs } from '../jobs/list'
import { getLiveJobSnapshot, liveJobToListedJob } from '../jobs/live-store'
import { HttpError } from '../types'
import type { AutoApplyProfile, AutoApplyQueueItem, AutoApplyQueueStatus, AutoApplyRun, AutoApplyStartInput, ExistingApplicationRecord, ListedAutoApplyJob } from '../apply/types'
import type { ServerConfig } from '../config'
import type { FetchLike } from '../jobs/http'
import { persistCampaignQueue, wakeApplicationWorker } from './queue'
import { createCampaignRecord, getCampaign, persistExecutionState, type ExecutionState } from './state'
import { AgentError } from './errors'
import { candidateFromStoredProfile } from './eligibility'

export const SMOKE_TEST_SOURCE = 'smoke-test'
export const SMOKE_TEST_MAX_JOBS = 1

export const SMOKE_TEST_LOGS = [
  'Started',
  'Selected job',
  'Selected existing job',
  'Queue created',
  'Job queued',
  'Application URL',
  'Worker started',
  'Worker picked up job',
  'Worker picked job',
  'Browser started',
  'Opening employer URL',
  'Employer page opened',
  'Final URL',
  'Page type',
  'Provider',
  'Application detected',
  'Apply action detected',
  'Application page detected',
  'Provider detected',
  'Fields detected',
  'Profile mapping',
  'Fields filled',
  'Resume uploaded',
  'Review reached',
  'Review page reached',
  'Submit found',
  'Final submit found',
  'FINAL_SUBMIT_FOUND',
  'Submit clicked',
  'Final submit clicked',
  'FINAL_SUBMIT_CLICKED',
  'Confirmation detected',
  'Application persisted',
] as const

export type SmokeTestLogEvent = (typeof SMOKE_TEST_LOGS)[number]

export type SmokeTestAvailability = 'available' | 'missing'

export type SmokeTestStage =
  | 'job_selected'
  | 'application_url'
  | 'browser'
  | 'employer_page'
  | 'application_page'
  | 'form'
  | 'fields'
  | 'resume'
  | 'multi_step'
  | 'final_submit'
  | 'confirmation'
  | 'application_persisted'
  | 'applications'

export type SmokeTestOutcomeStatus =
  | 'submitted'
  | 'submission_failed'
  | 'submission_uncertain'
  | 'captcha_required'
  | 'login_required'
  | 'mfa_required'
  | 'needs_user_input'
  | 'failed'

const SECRET_LOG = /password|cookie|token|authorization|api[_-]?key|secret|credential/i

let selectedCount = 0
let processedCount = 0

export function isAutoApplySmokeTestEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.AUTO_APPLY_SMOKE_TEST?.trim().toLowerCase()
  return raw === 'true' || raw === '1' || raw === 'on'
}

export function resetSmokeTestStateForTests() {
  selectedCount = 0
  processedCount = 0
}

export function canSelectAnotherSmokeTestJob(): boolean {
  return selectedCount < SMOKE_TEST_MAX_JOBS
}

export function markSmokeTestJobSelected(): boolean {
  if (!canSelectAnotherSmokeTestJob()) return false
  selectedCount += 1
  return true
}

export function canProcessAnotherSmokeTestJob(): boolean {
  return processedCount < SMOKE_TEST_MAX_JOBS
}

export function markSmokeTestJobProcessed(): boolean {
  if (!canProcessAnotherSmokeTestJob()) return false
  processedCount += 1
  return true
}

export function shouldRetrySmokeTest(): boolean {
  return false
}

export function isSmokeTestItem(item: Pick<AutoApplyQueueItem, 'discoverySource' | 'applicationSource'> | null | undefined): boolean {
  return item?.discoverySource === SMOKE_TEST_SOURCE || item?.applicationSource === SMOKE_TEST_SOURCE
}

export function shouldIsolateRealEmployerUrl(
  isolated: boolean,
  item?: Pick<AutoApplyQueueItem, 'discoverySource' | 'applicationSource'> | null,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (isAutoApplySmokeTestEnabled(env) && isSmokeTestItem(item)) return false
  return isolated
}

export function shouldSkipCapabilityGate(item?: Pick<AutoApplyQueueItem, 'discoverySource' | 'applicationSource'> | null, env: NodeJS.ProcessEnv = process.env): boolean {
  return isAutoApplySmokeTestEnabled(env) && isSmokeTestItem(item)
}

export function shouldUnattendedSubmitForSmoke(
  url: string,
  autoSubmit: boolean | undefined,
  allow: (target: string, env?: NodeJS.ProcessEnv) => boolean,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (isAutoApplySmokeTestEnabled(env)) return true
  return autoSubmit === true || allow(url, env)
}

export function smokeTestCampaignConfig(partial?: Partial<AutoApplyStartInput['config']>) {
  return {
    ...defaultAutoApplyConfig(partial),
    maxJobs: SMOKE_TEST_MAX_JOBS,
    autoTailorResume: false,
    jobType: 'all' as const,
    remotePreference: 'any' as const,
    keywords: [],
    jobTitles: [],
    concurrency: 1,
    includeSynthetic: false,
  }
}

export function logSmokeTest(event: string, details?: Record<string, unknown>) {
  const safe = details
    ? Object.fromEntries(
        Object.entries(details).filter(([key, value]) => {
          if (SECRET_LOG.test(key)) return false
          if (typeof value === 'string' && SECRET_LOG.test(value)) return false
          return true
        }),
      )
    : undefined
  if (safe && Object.keys(safe).length) {
    console.info(`[SmokeTest] ${event}`, safe)
    return
  }
  console.info(`[SmokeTest] ${event}`)
}

export function inspectCandidateProfileAvailability(input: {
  profile?: AutoApplyProfile | null
  resumeText?: string | null
  resumeVersionId?: string | null
}): {
  fields: Record<string, SmokeTestAvailability>
  requiredMissing: string[]
  ready: boolean
} {
  const profile = input.profile ?? null
  const built = profile
    ? candidateFromStoredProfile({
        userId: 'smoke-test',
        profile,
        resumeText: input.resumeText,
        resumeVersionId: input.resumeVersionId,
      })
    : null
  const required = candidateRequiredFieldsExist(profile)
  const extra = (profile ?? {}) as Record<string, unknown>
  const fields: Record<string, SmokeTestAvailability> = {
    firstName: required.firstName === 'yes' ? 'available' : 'missing',
    lastName: required.lastName === 'yes' ? 'available' : 'missing',
    email: required.email === 'yes' ? 'available' : 'missing',
    phone: required.phone === 'yes' || Boolean(built?.contact.phone) ? 'available' : 'missing',
    address: asAvailable(stringField(extra, 'address') || built?.location.address),
    city: asAvailable(stringField(extra, 'city') || built?.location.city),
    state: asAvailable(stringField(extra, 'state') || built?.location.state),
    zip: asAvailable(stringField(extra, 'zip') || built?.location.zip),
    linkedin: asAvailable(stringField(extra, 'linkedin') || built?.professional.linkedin),
    github: asAvailable(stringField(extra, 'github') || built?.professional.github),
    resume: asAvailable(input.resumeText),
    workAuthorization: asAvailable(profile?.workAuthorization),
    sponsorship: profile ? 'available' : 'missing',
    education: built?.education.length ? 'available' : 'missing',
    experience: built?.work.experience.length || built?.work.employers.length ? 'available' : 'missing',
  }
  const requiredMissing = (['firstName', 'lastName', 'email', 'resume'] as const).filter((key) => fields[key] === 'missing')
  return { fields, requiredMissing: [...requiredMissing], ready: requiredMissing.length === 0 }
}

function asAvailable(value: string | null | undefined): SmokeTestAvailability {
  return value?.trim() ? 'available' : 'missing'
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  return typeof value === 'string' ? value : ''
}

export function isFixtureCandidateProfile(profile?: Pick<AutoApplyProfile, 'fullName' | 'email'> | null): boolean {
  if (!profile) return false
  return /example\.com$/i.test(profile.email) || /jordan\s+hale/i.test(profile.fullName)
}

export function validateDirectSmokeUrl(raw: string | null | undefined): { ok: boolean; reason: string | null; url: string | null } {
  const value = raw?.trim() ?? ''
  if (!value || value === 'undefined' || value === 'null') {
    return { ok: false, reason: 'Application URL is missing.', url: null }
  }
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return { ok: false, reason: 'Application URL is invalid.', url: null }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: `Application URL protocol ${parsed.protocol} is not allowed.`, url: null }
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  const loopback =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host.endsWith('.localhost')
  const syntheticPath =
    parsed.pathname.startsWith('/test-employer') ||
    parsed.pathname.startsWith('/extension/test/') ||
    parsed.pathname.startsWith('/browser-worker/synthetic/')
  if (loopback && !syntheticPath) {
    return { ok: false, reason: 'Application URL must be a real employer URL.', url: null }
  }
  return { ok: true, reason: null, url: parsed.toString() }
}

export type SmokeFailureCode =
  | 'WORKER_QUEUE_FAILURE'
  | 'NAVIGATION_FAILURE'
  | 'APPLICATION_NAVIGATION_FAILURE'
  | 'APPLICATION_DETECTION_FAILURE'
  | 'RESUME_UPLOAD_FAILURE'
  | 'SUBMISSION_ACTION_FAILURE'
  | 'SUBMISSION_CONFIRMATION_FAILURE'

export function smokeFailureCodeForStage(stage: SmokeTestStage | string | null): SmokeFailureCode | null {
  switch (stage) {
    case 'job_selected':
    case 'application_url':
      return 'WORKER_QUEUE_FAILURE'
    case 'browser':
    case 'employer_page':
      return 'NAVIGATION_FAILURE'
    case 'application_page':
      return 'APPLICATION_NAVIGATION_FAILURE'
    case 'form':
    case 'fields':
      return 'APPLICATION_DETECTION_FAILURE'
    case 'resume':
      return 'RESUME_UPLOAD_FAILURE'
    case 'multi_step':
    case 'final_submit':
      return 'SUBMISSION_ACTION_FAILURE'
    case 'confirmation':
    case 'application_persisted':
    case 'applications':
      return 'SUBMISSION_CONFIRMATION_FAILURE'
    default:
      return null
  }
}

export function smokeProfileYesNo(fields: Record<string, SmokeTestAvailability>): Record<string, 'yes' | 'no'> {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, value === 'available' ? 'yes' : 'no']),
  ) as Record<string, 'yes' | 'no'>
}

export function validateSmokeTestSafety(job: ListedAutoApplyJob, now = Date.now()): { ok: boolean; reason: string | null; url: string | null } {
  const title = job.title?.trim() ?? ''
  const company = job.company?.trim() ?? ''
  if (!title || !company) {
    return { ok: false, reason: 'Job is missing an identifiable title or company.', url: null }
  }
  const url = jobApplicationUrl(job)
  const inspected = inspectApplicationUrl(url)
  if (!inspected.ok || !inspected.url) {
    return { ok: false, reason: 'Application URL is missing or invalid.', url: null }
  }
  if (inspected.url.protocol !== 'http:' && inspected.url.protocol !== 'https:') {
    return { ok: false, reason: 'Application URL must be http or https.', url: null }
  }
  if (job.rawMetadata && (isJobExpired(job, now) || !isJobLive(job))) {
    return { ok: false, reason: 'Job is expired or no longer live.', url: inspected.url.toString() }
  }
  return { ok: true, reason: null, url: inspected.url.toString() }
}

export async function probeApplicationUrlReachable(
  url: string,
  fetchImpl: FetchLike = fetch,
  timeoutMs = 8_000,
): Promise<{ ok: boolean; status: number | null; reason: string | null }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, { method: 'GET', redirect: 'follow', signal: controller.signal })
    if (response.status >= 500) {
      return { ok: false, status: response.status, reason: 'Application URL returned a server error.' }
    }
    return { ok: true, status: response.status, reason: null }
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError'
    return {
      ok: false,
      status: null,
      reason: aborted ? 'Application URL reachability timed out.' : 'Application URL is not reachable.',
    }
  } finally {
    clearTimeout(timer)
  }
}

export function selectSmokeTestJob(input: {
  jobs: ListedAutoApplyJob[]
  existingApplications?: ExistingApplicationRecord[]
  existingQueueIdentities?: string[]
  now?: number
}): { job: ListedAutoApplyJob; url: string; reason: null } | { job: null; url: null; reason: string } {
  if (!canSelectAnotherSmokeTestJob()) {
    return { job: null, url: null, reason: 'Smoke test already selected one job.' }
  }
  for (const job of input.jobs) {
    const safety = validateSmokeTestSafety(job, input.now)
    if (!safety.ok || !safety.url) continue
    if (hasDuplicateApplication(job, input.existingApplications)) continue
    if (hasDuplicateQueueEntry(job, input.existingQueueIdentities)) continue
    return { job, url: safety.url, reason: null }
  }
  return { job: null, url: null, reason: 'No live job with a valid unused application URL was found.' }
}

export function mapSmokeTestStatus(input: {
  captcha?: boolean
  login?: boolean
  mfa?: boolean
  unknownRequired?: boolean
  missingProfile?: boolean
  submitClicked?: boolean
  confirmed?: boolean
  attempted?: boolean
}): { status: SmokeTestOutcomeStatus; firstFailure: SmokeTestStage | null; rootCause: string } {
  if (input.missingProfile) {
    return { status: 'needs_user_input', firstFailure: 'fields', rootCause: 'Required candidate profile fields are missing.' }
  }
  if (input.captcha) {
    return { status: 'captcha_required', firstFailure: 'form', rootCause: 'CAPTCHA prevented autonomous completion.' }
  }
  if (input.login) {
    return { status: 'login_required', firstFailure: 'application_page', rootCause: 'Login is required.' }
  }
  if (input.mfa) {
    return { status: 'mfa_required', firstFailure: 'application_page', rootCause: 'MFA is required.' }
  }
  if (input.unknownRequired) {
    return { status: 'needs_user_input', firstFailure: 'fields', rootCause: 'An unknown required question could not be answered from verified profile data.' }
  }
  if (input.submitClicked && input.confirmed) {
    return { status: 'submitted', firstFailure: null, rootCause: '' }
  }
  if (input.submitClicked && !input.confirmed) {
    return { status: 'submission_uncertain', firstFailure: 'confirmation', rootCause: 'Final submit was clicked but confirmation was not reliable.' }
  }
  if (input.attempted) {
    return { status: 'submission_failed', firstFailure: 'final_submit', rootCause: 'Final submit was not performed.' }
  }
  return { status: 'failed', firstFailure: 'job_selected', rootCause: 'Smoke test did not start.' }
}

export function mapAgentStatusToSmokeStatus(status: AutoApplyQueueStatus, submitClicked = false): AutoApplyQueueStatus {
  if (status === 'submitted') return 'submitted'
  if (status === 'captcha_required' || status === 'login_required' || status === 'mfa_required' || status === 'needs_user_input') {
    return status
  }
  if (status === 'needs_confirmation' || status === 'needs_user_confirmation') return 'submission_uncertain'
  if (submitClicked) return 'submission_uncertain'
  if (status === 'failed' || status === 'skipped' || status === 'blocked' || status === 'automation_blocked') {
    return 'submission_failed'
  }
  return status === 'queued' ? status : 'submission_failed'
}

export function executionStateForSmokeStatus(status: AutoApplyQueueStatus): ExecutionState {
  if (status === 'submitted') return 'submitted'
  if (status === 'needs_user_input') return 'needs_user_input'
  if (status === 'submission_uncertain' || status === 'needs_confirmation') return 'submission_uncertain'
  if (status === 'captcha_required' || status === 'login_required' || status === 'mfa_required') return 'failed'
  return 'failed'
}

export function buildSmokeTestQueueItem(input: {
  run: AutoApplyRun
  start: AutoApplyStartInput
  job: ListedAutoApplyJob
  url: string
}): AutoApplyQueueItem {
  const now = new Date().toISOString()
  return {
    id: randomUUID(),
    runId: input.run.id,
    jobId: input.job.id,
    identityKey: applicationIdentity(input.job),
    applicationId: randomUUID(),
    resumeVersionId: input.start.resumeVersionId,
    resumeVersionName: 'Master',
    sourceResumeId: input.start.resumeId,
    title: input.job.title,
    company: input.job.company,
    applicationUrl: input.url,
    initialMatchScore: input.job.matchScore,
    finalMatchScore: input.job.matchScore,
    c2cStatus: input.job.c2cStatus,
    c2cEvidence: input.job.c2cEvidence,
    applicationStatus: 'queued',
    failureReason: null,
    questions: [],
    tailoredResumeText: input.start.resumeText || input.start.masterResumeText,
    jobDescriptionSnapshot: input.job.description ?? null,
    location: input.job.location ?? null,
    confirmationNumber: null,
    confirmationText: null,
    submittedAt: null,
    masterResumeUnchanged: true,
    sessionId: null,
    createdAt: now,
    updatedAt: now,
    applicationCapability: 'unknown',
    discoverySource: SMOKE_TEST_SOURCE,
    applicationSource: SMOKE_TEST_SOURCE,
    applicationProvider: null,
    initialUrl: input.url,
    redirectUrls: [],
    finalApplicationUrl: input.url,
  }
}

export function buildSmokeTestReport(input: {
  jobTitle?: string | null
  company?: string | null
  initialUrl?: string | null
  finalUrl?: string | null
  provider?: string | null
  stages: Partial<Record<SmokeTestStage, 'PASS' | 'FAIL'>>
  applicationsCreated: boolean
  firstFailure: SmokeTestStage | string | null
  rootCause: string
}): string {
  const stage = (key: SmokeTestStage) => input.stages[key] ?? 'FAIL'
  return [
    `JOB: ${[input.jobTitle, input.company].filter(Boolean).join(' / ') || 'none'}`,
    `INITIAL URL: ${input.initialUrl || 'none'}`,
    `FINAL URL: ${input.finalUrl || 'none'}`,
    `PROVIDER: ${input.provider || 'unknown'}`,
    `BROWSER: ${stage('browser')}`,
    `APPLICATION PAGE: ${stage('application_page')}`,
    `FORM: ${stage('form')}`,
    `FIELDS: ${stage('fields')}`,
    `RESUME: ${stage('resume')}`,
    `MULTI-STEP: ${stage('multi_step')}`,
    `FINAL SUBMIT: ${stage('final_submit')}`,
    `CONFIRMATION: ${stage('confirmation')}`,
    `APPLICATION PERSISTED: ${stage('application_persisted')}`,
    `APPLICATIONS: ${input.applicationsCreated ? 'CREATED' : 'NOT CREATED'}`,
    `FIRST FAILURE: ${input.firstFailure || 'none'}`,
    `ROOT CAUSE: ${input.rootCause || 'none'}`,
  ].join('\n')
}

export async function startSmokeTestCampaign(serverConfig: ServerConfig, input: AutoApplyStartInput, fetchImpl?: FetchLike) {
  const createdAt = new Date().toISOString()
  const run: AutoApplyRun = {
    id: randomUUID(),
    userId: input.userId,
    status: 'running',
    config: smokeTestCampaignConfig(input.config),
    counts: emptyCounts(),
    createdAt,
    updatedAt: createdAt,
  }
  await persistRun(memoryStore, run, [], serverConfig)
  createCampaignRecord({
    runId: run.id,
    userId: input.userId,
    status: 'running',
    startInput: { ...input, config: run.config },
    serverConfig,
    fetchImpl,
    counters: run.counts,
  })
  saveCandidateProfile({
    userId: input.userId,
    profile: input.profile,
    resumeText: input.resumeText ?? input.masterResumeText,
    resumeVersionId: input.resumeVersionId,
  })
  await hydrateCandidateStoreFromSupabase(input.userId, serverConfig)
  rememberAutoApplyProfile(input.userId, input.profile)
  touchAgentHeartbeat({ currentCampaignId: run.id, lastDiscoveryAt: createdAt })
  logSmokeTest('Started')
  void processSmokeTestCampaign(run.id, fetchImpl).catch((error) => {
    console.error('[SmokeTest] FAILED', error instanceof Error ? error.message : error)
  })
  return { campaignId: run.id, status: 'running' as const, run, items: [] as AutoApplyQueueItem[] }
}

export async function processSmokeTestCampaign(runId: string, fetchImpl?: FetchLike) {
  const stored = await memoryStore.get(runId)
  if (!stored) throw new AgentError('CAMPAIGN_NOT_FOUND', 'Auto Apply campaign was not found.')
  const campaign = getCampaign(runId)
  if (!campaign) throw new AgentError('CAMPAIGN_NOT_FOUND', 'Auto Apply campaign was not found.')

  const storedCandidate = getCandidateProfile(stored.run.userId)
  const profileCheck = inspectCandidateProfileAvailability({
    profile: storedCandidate?.profile ?? campaign.input.profile,
    resumeText: storedCandidate?.resumeText ?? campaign.input.resumeText ?? campaign.input.masterResumeText,
    resumeVersionId: storedCandidate?.resumeVersionId ?? campaign.input.resumeVersionId,
  })
  logSmokeTest('Candidate profile', { fields: profileCheck.fields })
  if (!profileCheck.ready) {
    stored.run.status = 'needs_attention'
    stored.run.counts.found = 0
    stored.run.counts.eligible = 0
    await persistCampaignQueue(stored)
    logSmokeTest('Stopped', { reason: 'required_profile_fields_missing' })
    return stored
  }

  const listed = await listLiveJobs(
    campaign.serverConfig,
    {
      q: campaign.input.config.q || '',
      country: campaign.input.config.country || 'US',
      state: '',
      location: '',
      remote: 'any',
      employmentType: 'any',
      seniority: '',
      page: 1,
      limit: 25,
      sort: 'recent',
      jobType: 'all',
      includeSynthetic: false,
    },
    fetchImpl ?? campaign.fetchImpl,
  )

  const existing = [
    ...(campaign.input.existingApplications ?? []),
    ...listConfirmedApplications(stored.run.userId).map((record) => ({
      jobId: record.jobId,
      identityKey: record.identityKey,
      applicationUrl: record.applicationUrl,
      status: record.status,
    })),
  ]
  const selected = selectSmokeTestJob({
    jobs: listed.jobs,
    existingApplications: existing,
    existingQueueIdentities: stored.items.map((item) => item.identityKey),
  })
  stored.run.counts.found = listed.jobs.length
  if (!selected.job || !selected.url || !markSmokeTestJobSelected()) {
    stored.run.status = 'completed'
    stored.run.counts.eligible = 0
    await persistCampaignQueue(stored)
    logSmokeTest('Stopped', { reason: selected.reason || 'already_selected' })
    return stored
  }

  const reachable = await probeApplicationUrlReachable(selected.url, fetchImpl ?? campaign.fetchImpl ?? fetch)
  if (!reachable.ok) {
    stored.run.status = 'completed'
    stored.run.counts.eligible = 0
    await persistCampaignQueue(stored)
    logSmokeTest('Stopped', { reason: reachable.reason })
    return stored
  }

  logSmokeTest('Selected job', { title: selected.job.title, company: selected.job.company })
  logSmokeTest('Application URL', { hostname: safeHostname(selected.url) })
  const item = buildSmokeTestQueueItem({
    run: stored.run,
    start: campaign.input,
    job: selected.job,
    url: selected.url,
  })
  stored.items.push(item)
  stored.run.counts = {
    ...recount(stored.items),
    found: listed.jobs.length,
    eligible: 1,
    autoApplyCapable: 1,
    queued: 1,
  }
  syncRunStatus(stored.run, stored.items)
  rememberQueueResume(stored.run.userId, item)
  persistExecutionState(item.id, 'queued')
  await persistCampaignQueue(stored)
  wakeApplicationWorker()
  return stored
}

export function buildDirectSmokeTestReport(input: {
  jobTitle?: string | null
  company?: string | null
  jobId?: string | null
  applicationUrl?: string | null
  queue: 'PASS' | 'FAIL'
  worker: 'PASS' | 'FAIL'
  browser: 'PASS' | 'FAIL'
  initialUrl?: string | null
  finalUrl?: string | null
  pageType?: string | null
  provider?: string | null
  applicationDetected: 'PASS' | 'FAIL'
  fields: 'PASS' | 'FAIL'
  profileMapping: 'PASS' | 'FAIL'
  resume: 'PASS' | 'FAIL'
  multiStep: 'PASS' | 'FAIL'
  finalSubmit: 'PASS' | 'FAIL'
  confirmation: 'PASS' | 'FAIL'
  applicationCreated: boolean
  firstFailure: SmokeTestStage | string | null
  rootCause: string
}): string {
  const failureCode = input.firstFailure ? smokeFailureCodeForStage(input.firstFailure) : null
  return [
    `JOB: ${[input.jobTitle, input.company].filter(Boolean).join(' / ') || 'none'}`,
    `JOB ID: ${input.jobId || 'none'}`,
    `APPLICATION URL: ${input.applicationUrl || 'none'}`,
    `QUEUE: ${input.queue}`,
    `WORKER: ${input.worker}`,
    `BROWSER: ${input.browser}`,
    `INITIAL URL: ${input.initialUrl || 'none'}`,
    `FINAL URL: ${input.finalUrl || 'none'}`,
    `PAGE TYPE: ${input.pageType || 'unknown'}`,
    `PROVIDER: ${input.provider || 'unknown'}`,
    `APPLICATION DETECTED: ${input.applicationDetected}`,
    `FIELDS: ${input.fields}`,
    `PROFILE MAPPING: ${input.profileMapping}`,
    `RESUME: ${input.resume}`,
    `MULTI-STEP: ${input.multiStep}`,
    `FINAL SUBMIT: ${input.finalSubmit}`,
    `CONFIRMATION: ${input.confirmation}`,
    `APPLICATION: ${input.applicationCreated ? 'CREATED' : 'NOT CREATED'}`,
    `FIRST FAILURE: ${input.firstFailure || 'none'}`,
    `FAILURE CODE: ${failureCode || 'none'}`,
    `ROOT CAUSE: ${input.rootCause || 'none'}`,
  ].join('\n')
}

export async function queueDirectSmokeTestJob(input: { userId: string; jobId: string; serverConfig: ServerConfig }) {
  const userId = input.userId.trim()
  if (!userId) throw new HttpError(401, 'userId is required')
  const jobId = input.jobId.trim()
  if (!jobId) throw new HttpError(400, 'jobId is required')
  if (!canSelectAnotherSmokeTestJob()) {
    throw new HttpError(409, 'Smoke test already queued one job.')
  }
  const snapshot = getLiveJobSnapshot(jobId)
  if (!snapshot) {
    throw new HttpError(404, 'Live job was not found in the loaded Live Jobs data.')
  }
  const job = liveJobToListedJob(snapshot)
  if (!job.title?.trim() || !job.company?.trim()) {
    throw new HttpError(422, 'Job is missing an identifiable title or company.')
  }
  const urlCheck = validateDirectSmokeUrl(jobApplicationUrl(job))
  if (!urlCheck.ok || !urlCheck.url) {
    throw new HttpError(422, urlCheck.reason ?? 'Application URL is missing or invalid.')
  }
  await hydrateCandidateStoreFromSupabase(userId, input.serverConfig)
  const candidate = getCandidateProfile(userId)
  if (!candidate?.profile) {
    throw new HttpError(422, 'The JobPilot profile required for this application is missing.')
  }
  if (!candidate.resumeText?.trim() || !candidate.resumeVersionId?.trim()) {
    throw new HttpError(422, 'A completed resume is required for the smoke test.')
  }
  const confirmed = listConfirmedApplications(userId).map((record) => ({
    jobId: record.jobId,
    identityKey: record.identityKey,
    applicationUrl: record.applicationUrl,
    status: record.status,
  }))
  if (hasDuplicateApplication(job, confirmed)) {
    throw new HttpError(409, 'An application for this job already exists.')
  }
  const runs = memoryStore.listAll ? await memoryStore.listAll() : []
  const queuedIdentities = runs.flatMap((entry) => entry.items.map((item) => item.identityKey))
  if (hasDuplicateQueueEntry(job, queuedIdentities)) {
    throw new HttpError(409, 'This job is already in the Auto Apply queue.')
  }
  markSmokeTestJobSelected()

  const createdAt = new Date().toISOString()
  const run: AutoApplyRun = {
    id: randomUUID(),
    userId,
    status: 'running',
    config: smokeTestCampaignConfig(undefined),
    counts: emptyCounts(),
    createdAt,
    updatedAt: createdAt,
  }
  await persistRun(memoryStore, run, [], input.serverConfig)
  const startInput: AutoApplyStartInput = {
    userId,
    resumeId: candidate.resumeVersionId,
    resumeVersionId: candidate.resumeVersionId,
    resumeText: candidate.resumeText,
    masterResumeText: candidate.resumeText,
    profile: candidate.profile,
    config: run.config,
  }
  createCampaignRecord({
    runId: run.id,
    userId,
    status: 'running',
    startInput,
    serverConfig: input.serverConfig,
    counters: run.counts,
  })
  rememberAutoApplyProfile(userId, candidate.profile)
  touchAgentHeartbeat({ currentCampaignId: run.id, lastDiscoveryAt: createdAt })
  logSmokeTest('Selected existing job', { jobId: job.id })
  const availability = inspectCandidateProfileAvailability({
    profile: candidate.profile,
    resumeText: candidate.resumeText,
    resumeVersionId: candidate.resumeVersionId,
  })
  logSmokeTest('Profile mapping', { fields: smokeProfileYesNo(availability.fields) })

  const stored = await memoryStore.get(run.id)
  if (!stored) throw new AgentError('CAMPAIGN_NOT_FOUND', 'Auto Apply campaign was not found.')
  const item = buildSmokeTestQueueItem({ run: stored.run, start: startInput, job, url: urlCheck.url })
  stored.items.push(item)
  stored.run.counts = {
    ...recount(stored.items),
    found: 1,
    eligible: 1,
    autoApplyCapable: 1,
    queued: 1,
  }
  syncRunStatus(stored.run, stored.items)
  rememberQueueResume(stored.run.userId, item)
  persistExecutionState(item.id, 'queued')
  await persistCampaignQueue(stored)
  logSmokeTest('Queue created')
  logSmokeTest('Job queued')
  wakeApplicationWorker()
  return { run: stored.run, item, job }
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return 'invalid'
  }
}
