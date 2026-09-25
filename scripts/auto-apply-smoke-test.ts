import { getServerConfig } from '../server/config'
import { listLiveJobs } from '../server/jobs/list'
import { getCandidateProfile, listCandidateUserIds } from '../server/application/candidate-store'
import { listConfirmedApplications } from '../server/apply/confirmed'
import { memoryStore } from '../server/apply/store'
import { createBrowserWorker } from '../server/browser-worker/worker'
import {
  buildSmokeTestReport,
  inspectCandidateProfileAvailability,
  isFixtureCandidateProfile,
  selectSmokeTestJob,
  startSmokeTestCampaign,
  validateSmokeTestSafety,
} from '../server/agent/smoke-test'

const USER_ID = process.env.JOBPILOT_SMOKE_USER_ID?.trim() || ''

async function waitForQueued(runId: string, timeoutMs = 60_000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const stored = await memoryStore.get(runId)
    if (stored && (stored.items.length > 0 || stored.run.status !== 'running')) return stored
    await new Promise<void>((resolve) => setTimeout(resolve, 250))
  }
  return memoryStore.get(runId)
}

async function waitForItem(runId: string, timeoutMs = 180_000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const stored = await memoryStore.get(runId)
    const item = stored?.items[0]
    if (item && !['queued', 'opening', 'filling', 'preparing', 'submitting', 'ready', 'tailoring'].includes(item.applicationStatus)) {
      return { stored, item }
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 1_000))
  }
  const stored = await memoryStore.get(runId)
  return { stored, item: stored?.items[0] ?? null }
}

async function main() {
  process.env.AUTO_APPLY_SMOKE_TEST = 'true'
  process.env.JOBPILOT_BROWSER_HEADLESS = process.env.JOBPILOT_BROWSER_HEADLESS ?? '1'
  const config = getServerConfig()
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
  const preview = selectSmokeTestJob({
    jobs: listed.jobs,
    existingApplications: listConfirmedApplications().map((record) => ({
      jobId: record.jobId,
      identityKey: record.identityKey,
      applicationUrl: record.applicationUrl,
      status: record.status,
    })),
  })
  const storedIds = listCandidateUserIds()
  const storedProfile = USER_ID
    ? getCandidateProfile(USER_ID)
    : storedIds.map((id) => getCandidateProfile(id)).find((entry) => entry && !isFixtureCandidateProfile(entry.profile)) ??
      (storedIds[0] ? getCandidateProfile(storedIds[0]) : null)
  const fallbackId = storedProfile?.userId || USER_ID || 'smoke-test-user'
  const candidate = storedProfile ?? getCandidateProfile(fallbackId)
  const availability = inspectCandidateProfileAvailability({
    profile: candidate?.profile ?? storedProfile?.profile ?? null,
    resumeText: candidate?.resumeText ?? storedProfile?.resumeText ?? null,
    resumeVersionId: candidate?.resumeVersionId ?? storedProfile?.resumeVersionId ?? null,
  })
  console.info('[SmokeTest] Profile fields', availability.fields)

  if (!preview.job || !preview.url) {
    console.log(
      buildSmokeTestReport({
        jobTitle: null,
        company: null,
        initialUrl: null,
        finalUrl: null,
        provider: null,
        stages: { job_selected: 'FAIL' },
        applicationsCreated: false,
        firstFailure: 'job_selected',
        rootCause: preview.reason || 'No live job with a valid application URL was found.',
      }),
    )
    process.exitCode = 1
    return
  }

  const safety = validateSmokeTestSafety(preview.job)
  const fixture = isFixtureCandidateProfile(candidate?.profile ?? storedProfile?.profile)
  if (!availability.ready || !candidate || fixture) {
    console.log(
      buildSmokeTestReport({
        jobTitle: preview.job.title,
        company: preview.job.company,
        initialUrl: safety.url,
        finalUrl: safety.url,
        provider: preview.job.applicationProvider ?? preview.job.provider,
        stages: { job_selected: 'PASS', application_url: safety.ok ? 'PASS' : 'FAIL', fields: 'FAIL' },
        applicationsCreated: false,
        firstFailure: 'fields',
        rootCause: fixture
          ? 'Stored candidate profile is a test fixture. Smoke test will not submit fake identity data to a real employer.'
          : `Required candidate fields missing: ${availability.requiredMissing.join(', ') || 'profile'}`,
      }),
    )
    process.exitCode = 1
    return
  }

  const started = await startSmokeTestCampaign(config, {
    userId: candidate.userId,
    resumeId: candidate.resumeVersionId,
    resumeVersionId: candidate.resumeVersionId,
    resumeText: candidate.resumeText || '',
    masterResumeText: candidate.resumeText || '',
    profile: candidate.profile,
    config: {
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
      includeSynthetic: false,
    },
  })
  const queued = await waitForQueued(started.campaignId)
  if (!queued?.items.length) {
    console.log(
      buildSmokeTestReport({
        jobTitle: preview.job.title,
        company: preview.job.company,
        initialUrl: preview.url,
        finalUrl: preview.url,
        provider: preview.job.applicationProvider ?? preview.job.provider,
        stages: { job_selected: 'PASS', application_url: 'PASS', browser: 'FAIL' },
        applicationsCreated: false,
        firstFailure: 'job_selected',
        rootCause: 'Smoke test campaign did not queue a job.',
      }),
    )
    process.exitCode = 1
    return
  }
  const worker = await createBrowserWorker({ headless: true, autoSubmit: true, pollMs: 250 })
  await worker.start()
  try {
    await worker.processOnce()
    const finished = await waitForItem(started.campaignId)
    const item = finished.item
    const applications = item ? listConfirmedApplications(candidate.userId).filter((record) => record.jobId === item.jobId) : []
    const submitted = item?.applicationStatus === 'submitted'
    const firstFailure =
      item?.applicationStatus === 'submitted'
        ? null
        : item?.applicationStatus === 'captcha_required'
          ? 'form'
          : item?.applicationStatus === 'login_required' || item?.applicationStatus === 'mfa_required'
            ? 'application_page'
            : item?.applicationStatus === 'needs_user_input'
              ? 'fields'
              : item?.applicationStatus === 'submission_uncertain'
                ? 'confirmation'
                : item?.applicationStatus === 'submission_failed'
                  ? 'final_submit'
                  : 'browser'
    console.log(
      buildSmokeTestReport({
        jobTitle: item?.title ?? preview.job.title,
        company: item?.company ?? preview.job.company,
        initialUrl: item?.initialUrl ?? preview.url,
        finalUrl: item?.finalApplicationUrl ?? item?.applicationUrl ?? preview.url,
        provider: item?.applicationProvider ?? 'unknown',
        stages: {
          job_selected: 'PASS',
          application_url: 'PASS',
          browser: item ? 'PASS' : 'FAIL',
          employer_page: item ? 'PASS' : 'FAIL',
          application_page: item && !['failed', 'submission_failed'].includes(item.applicationStatus) ? 'PASS' : 'FAIL',
          form: item && item.applicationStatus !== 'captcha_required' ? 'PASS' : 'FAIL',
          fields: item && item.applicationStatus !== 'needs_user_input' ? 'PASS' : 'FAIL',
          resume: item ? 'PASS' : 'FAIL',
          multi_step: item ? 'PASS' : 'FAIL',
          final_submit: item?.applicationStatus === 'submitted' || item?.applicationStatus === 'submission_uncertain' ? 'PASS' : 'FAIL',
          confirmation: submitted ? 'PASS' : 'FAIL',
          application_persisted: submitted ? 'PASS' : 'FAIL',
        },
        applicationsCreated: applications.length > 0,
        firstFailure,
        rootCause: item?.failureReason || (submitted ? 'none' : 'Smoke test did not confirm a submission.'),
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
