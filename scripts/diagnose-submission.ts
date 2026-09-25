import { JAVA_RESUME_TEXT } from '../server/tailor/fixtures'
import { detectSubmissionConfirmation, capturePostSubmitEvidence, isFinalSubmitLabel } from '../server/apply/confirm'
import { syntheticEmployerHtml } from '../server/browser-worker/synthetic'
import { livePreflightApplicationUrl } from '../server/apply/live-capability'

const base = (process.env.API_BASE_URL?.trim() || `http://127.0.0.1:${process.env.API_PORT ?? 8787}`).replace(/\/$/, '')

const profile = {
  fullName: 'Jordan Hale',
  email: 'jordan.hale@example.com',
  location: 'Austin, TX',
  yearsOfExperience: 6,
  workAuthorization: 'us_citizen',
  sponsorshipRequired: false,
  preferredWorkArrangement: 'hybrid',
  targetSalaryMin: null,
  targetSalaryMax: null,
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  const body = (await response.json()) as T
  if (!response.ok) {
    throw new Error(`${path} failed: ${response.status} ${JSON.stringify(body)}`)
  }
  return body
}

function diagnoseSyntheticDetector() {
  const html = syntheticEmployerHtml('confirm', '/test-employer')
  const confirmation = detectSubmissionConfirmation({
    html,
    title: 'Application submitted',
    url: 'http://127.0.0.1:8787/test-employer/submit',
    provider: 'generic',
  })
  const evidence = capturePostSubmitEvidence({
    html,
    title: 'Application submitted',
    url: 'http://127.0.0.1:8787/test-employer/submit',
  })
  console.log('SYNTHETIC_DETECTOR', {
    confirmed: confirmation.confirmed,
    confirmationNumber: confirmation.confirmationNumber,
    confirmationText: confirmation.confirmationText,
    reason: confirmation.reason,
    evidence,
    submitLabelOk: isFinalSubmitLabel('Submit Application'),
    weakThankYouRejected: !detectSubmissionConfirmation({ html: '<h1>Thank you</h1>', title: 'Thank you' }).confirmed,
  })
  if (!confirmation.confirmed || confirmation.confirmationNumber !== 'ABC12345') {
    throw new Error('Production confirmation detector did not recognize the synthetic confirmation page.')
  }
}

async function runSyntheticCampaign() {
  const userId = `diagnose-synthetic-${Date.now()}`
  const started = await json<{
    run: { id: string; counts: Record<string, number> }
    items: Array<{ applicationStatus: string; confirmationNumber?: string | null; failureReason?: string | null }>
  }>('/api/jobs/auto-apply/start', {
    method: 'POST',
    body: JSON.stringify({
      userId,
      resumeId: 'resume-1',
      resumeVersionId: 'resume-1',
      resumeText: JAVA_RESUME_TEXT,
      masterResumeText: JAVA_RESUME_TEXT,
      profile,
      config: {
        maxJobs: 1,
        minimumMatchRate: 70,
        autoTailorResume: false,
        jobType: 'all',
        remotePreference: 'any',
        employmentType: 'any',
        keywords: [],
        q: '',
        country: 'US',
        includeSynthetic: true,
      },
    }),
  })
  const startedAt = Date.now()
  let current = started
  while (Date.now() - startedAt < 90_000) {
    current = await json(`/api/jobs/auto-apply/${started.run.id}`)
    const status = current.items[0]?.applicationStatus
    if (status && !['queued', 'opening', 'filling', 'preparing', 'submitting'].includes(status)) break
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  const item = current.items[0]
  const applications = await json<{ applications: Array<Record<string, unknown>> }>(
    `/api/automation/applications?userId=${encodeURIComponent(userId)}`,
  )
  console.log('SYNTHETIC_RUN', {
    status: item?.applicationStatus,
    confirmationNumber: item?.confirmationNumber,
    failureReason: item?.failureReason,
    applications: applications.applications.length,
  })
  if (item?.applicationStatus !== 'submitted' || item.confirmationNumber !== 'ABC12345') {
    throw new Error(`synthetic campaign ${item?.applicationStatus}: ${JSON.stringify(item)}`)
  }
}

async function diagnoseOneRealJob() {
  const discovered = await json<{
    jobs: Array<{
      title: string
      company: string
      provider: string
      discoveryProvider?: string
      applicationProvider?: string
      applicationCapability?: string
      url?: string | null
      jobUrl?: string | null
    }>
  }>(
    '/api/jobs?' +
      new URLSearchParams({
        q: 'Java Software Engineer',
        country: 'US',
        remote: 'any',
        jobType: 'all',
        includeSynthetic: '0',
      }).toString(),
  )
  const job = discovered.jobs.find(
    (entry) =>
      entry.company !== 'Test Employer' &&
      !/cisco/i.test(`${entry.title} ${entry.company}`) &&
      Boolean(entry.url || entry.jobUrl),
  )
  if (!job) {
    console.log('REAL_JOB', { result: 'no_real_job_returned' })
    return
  }
  const url = job.url || job.jobUrl || ''
  const decision = await livePreflightApplicationUrl({
    jobId: 'diagnose-real-1',
    title: job.title,
    company: job.company,
    applicationUrl: url,
  })
  console.log('REAL_JOB', {
    title: job.title,
    company: job.company,
    discoveryProvider: job.discoveryProvider || job.provider,
    applicationProvider: decision.provider || job.applicationProvider,
    listingCapability: job.applicationCapability,
    liveCapability: decision.capability,
    pageType: decision.pageType,
    applicationDetected: decision.applicationDetected,
    initialUrl: url,
    finalUrl: decision.finalUrl,
    evidence: decision.evidence,
    blockers: decision.blockers,
    submitClicked: false,
    confirmationDetected: false,
    note: 'Diagnostic only. Final Submit was not clicked on the real employer.',
  })
}

async function main() {
  diagnoseSyntheticDetector()
  const health = await json<Record<string, unknown>>('/api/automation/health')
  console.log('HEALTH', { agent: health.agent, worker: health.worker, browser: health.browser, queue: health.queue })
  await runSyntheticCampaign()
  await diagnoseOneRealJob()
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
