import { getServerConfig } from '../server/config'
import { listLiveJobs } from '../server/jobs/list'
import { getCandidateProfile, listCandidateUserIds } from '../server/application/candidate-store'
import { listConfirmedApplications } from '../server/apply/confirmed'
import { memoryStore } from '../server/apply/store'
import { createBrowserWorker } from '../server/browser-worker/worker'
import { rememberLiveJobs } from '../server/jobs/live-store'
import {
  buildDirectSmokeTestReport,
  isFixtureCandidateProfile,
  queueDirectSmokeTestJob,
  validateDirectSmokeUrl,
  type SmokeTestStage,
} from '../server/agent/smoke-test'
import { jobApplicationUrl } from '../server/apply/eligibility'
import type { AutoApplyQueueItem } from '../server/apply/types'

const TERMINAL = new Set([
  'submitted',
  'submission_uncertain',
  'submission_failed',
  'failed',
  'skipped',
  'cancelled',
  'blocked',
  'automation_blocked',
  'captcha_required',
  'login_required',
  'mfa_required',
  'needs_user_input',
  'needs_user_confirmation',
  'needs_confirmation',
  'ready_for_submission',
])

async function waitForTerminal(runId: string, timeoutMs = 180_000): Promise<AutoApplyQueueItem | null> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const stored = await memoryStore.get(runId)
    const item = stored?.items[0] ?? null
    if (item && TERMINAL.has(item.applicationStatus)) return item
    await new Promise<void>((resolve) => setTimeout(resolve, 1_000))
  }
  const stored = await memoryStore.get(runId)
  return stored?.items[0] ?? null
}

function stageFor(item: AutoApplyQueueItem | null): { firstFailure: SmokeTestStage | null; rootCause: string } {
  if (!item) return { firstFailure: 'job_selected', rootCause: 'Smoke-test item was never queued.' }
  switch (item.applicationStatus) {
    case 'submitted':
      return { firstFailure: null, rootCause: '' }
    case 'captcha_required':
      return { firstFailure: 'form', rootCause: 'CAPTCHA prevented autonomous completion.' }
    case 'login_required':
      return { firstFailure: 'application_page', rootCause: item.failureReason || 'Login is required.' }
    case 'mfa_required':
      return { firstFailure: 'application_page', rootCause: item.failureReason || 'MFA is required.' }
    case 'needs_user_input':
      return { firstFailure: 'fields', rootCause: item.failureReason || 'An unknown required question could not be answered.' }
    case 'submission_uncertain':
    case 'needs_confirmation':
    case 'needs_user_confirmation':
      return { firstFailure: 'confirmation', rootCause: item.failureReason || 'Final submit was clicked but confirmation was not reliable.' }
    case 'ready_for_submission':
      return { firstFailure: 'final_submit', rootCause: item.failureReason || 'Review reached but final submit was not performed.' }
    case 'queued':
    case 'opening':
      return { firstFailure: 'browser', rootCause: item.failureReason || 'Worker did not finish processing the queued job.' }
    default:
      if (!item.finalApplicationUrl || item.finalApplicationUrl === item.initialUrl) {
        const noForm = /not a supported application form|UNKNOWN_PAGE|applicationDetected=false/i.test(item.failureReason ?? '') || !item.applicationProvider
        if (noForm) {
          return { firstFailure: 'application_page', rootCause: item.failureReason || 'No application form was detected on the employer page.' }
        }
      }
      return { firstFailure: 'application_page', rootCause: item.failureReason || 'Application navigation failed.' }
  }
}

async function main() {
  process.env.AUTO_APPLY_SMOKE_TEST = 'true'
  const config = getServerConfig()

  const userIds = listCandidateUserIds()
  const candidate =
    userIds.map((id) => getCandidateProfile(id)).find((entry) => entry?.resumeText && entry.resumeVersionId) ?? null
  if (!candidate) {
    console.log(
      buildDirectSmokeTestReport({
        jobTitle: null, company: null, jobId: null, applicationUrl: null,
        queue: 'FAIL', worker: 'FAIL', browser: 'FAIL',
        initialUrl: null, finalUrl: null, pageType: null, provider: null,
        applicationDetected: 'FAIL', fields: 'FAIL', profileMapping: 'FAIL', resume: 'FAIL',
        multiStep: 'FAIL', finalSubmit: 'FAIL', confirmation: 'FAIL',
        applicationCreated: false,
        firstFailure: 'fields',
        rootCause: 'No stored candidate profile with a completed resume exists.',
      }),
    )
    process.exitCode = 1
    return
  }
  if (isFixtureCandidateProfile(candidate.profile)) {
    console.info('[SmokeTest] Stored candidate profile is a test fixture; the agent will stop before any real-employer submit.')
  }

  console.info('[SmokeTest] Loading the current Live Jobs page (UI dataset, not the smoke path)')
  const listed = await listLiveJobs(config, {
    q: '',
    country: 'US',
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
  })
  rememberLiveJobs(listed.jobs)
  console.info(`[SmokeTest] Live Jobs page loaded: ${listed.jobs.length} existing jobs (snapshot only)`)

  const existing = listed.jobs.find((job) => {
    if (!job.title?.trim() || !job.company?.trim()) return false
    return validateDirectSmokeUrl(jobApplicationUrl({ url: job.url, jobUrl: job.jobUrl })).ok
  })
  if (!existing) {
    console.log(
      buildDirectSmokeTestReport({
        jobTitle: null, company: null, jobId: null, applicationUrl: null,
        queue: 'FAIL', worker: 'FAIL', browser: 'FAIL',
        initialUrl: null, finalUrl: null, pageType: null, provider: null,
        applicationDetected: 'FAIL', fields: 'FAIL', profileMapping: 'FAIL', resume: 'FAIL',
        multiStep: 'FAIL', finalSubmit: 'FAIL', confirmation: 'FAIL',
        applicationCreated: false,
        firstFailure: 'job_selected',
        rootCause: 'No existing live job has a valid application URL.',
      }),
    )
    process.exitCode = 1
    return
  }

  console.info('[SmokeTest] Direct queue path starts here: no discovery, match, C2C, or tailoring')
  const queued = await queueDirectSmokeTestJob({ userId: candidate.userId, jobId: existing.id, serverConfig: config })
  const worker = await createBrowserWorker({ headless: true, autoSubmit: true, pollMs: 250 })
  await worker.start()
  try {
    await worker.processOnce()
    const item = await waitForTerminal(queued.run.id)
    const { firstFailure, rootCause } = stageFor(item)
    const applications = item
      ? listConfirmedApplications(candidate.userId).filter((record) => record.jobId === item.jobId)
      : []
    const submitted = item?.applicationStatus === 'submitted'
    const pageType = (item?.preflight?.pageType as string | undefined) ?? null
    console.log(
      buildDirectSmokeTestReport({
        jobTitle: item?.title ?? existing.title,
        company: item?.company ?? existing.company,
        jobId: item?.jobId ?? existing.id,
        applicationUrl: existing.applicationUrl ?? existing.jobUrl,
        queue: item ? 'PASS' : 'FAIL',
        worker: item && item.applicationStatus !== 'queued' ? 'PASS' : 'FAIL',
        browser: item && (item.redirectUrls?.length || item.finalApplicationUrl) ? 'PASS' : item ? 'PASS' : 'FAIL',
        initialUrl: item?.initialUrl ?? null,
        finalUrl: item?.finalApplicationUrl ?? item?.applicationUrl ?? null,
        pageType,
        provider: item?.applicationProvider ?? 'unknown',
        applicationDetected: pageType === 'APPLICATION_PAGE' || submitted ? 'PASS' : 'FAIL',
        fields: item && (item.questions.length > 0 || submitted) ? 'PASS' : 'FAIL',
        profileMapping: candidate ? 'PASS' : 'FAIL',
        resume: submitted ? 'PASS' : 'FAIL',
        multiStep: submitted ? 'PASS' : 'FAIL',
        finalSubmit: submitted || item?.applicationStatus === 'submission_uncertain' ? 'PASS' : 'FAIL',
        confirmation: submitted ? 'PASS' : 'FAIL',
        applicationCreated: applications.length > 0,
        firstFailure,
        rootCause: submitted ? 'none' : rootCause,
      }),
    )
    process.exitCode = submitted ? 0 : 1
  } finally {
    await worker.stop()
  }
}

void main().catch((error) => {
  console.error('[SmokeTest] FAILED', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
