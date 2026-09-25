import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../app'
import type { ServerConfig } from '../config'
import { resetAgentForTests } from './index'
import { clearAutoApplyMemory } from '../apply/store'
import { buildConfirmedApplicationRecord, resetConfirmedApplicationsForTests, shouldPersistConfirmedApplication } from '../apply/confirmed'
import { detectSubmissionConfirmation, isFinalSubmitLabel } from '../apply/confirm'
import { isLegitimateApplyLabel } from '../apply/apply-action'
import { analyzeApplicationSurface } from '../apply/surface'
import { inspectApplicationPage } from '../apply/detect'
import { resolveApplicationQuestions } from '../apply/questions'
import { selectedResumeForUpload } from '../application/resume'
import { classifyNavigationControl, isBoundedStepTimeout, persistStepState } from '../application/navigation'
import { saveCandidateProfile, resetCandidateStoreForTests } from '../application/candidate-store'
import { claimNextBrowserJob, resetBrowserWorkerQueueForTests } from '../browser-worker/queue'
import { getLiveJobSnapshot, listLiveJobSnapshots, liveJobToListedJob, rememberLiveJobs, resetLiveJobStoreForTests } from '../jobs/live-store'
import type { LiveJob } from '../jobs/list'
import type { AutoApplyProfile, AutoApplyQueueItem } from '../apply/types'
import {
  buildDirectSmokeTestReport,
  buildSmokeTestQueueItem,
  mapAgentStatusToSmokeStatus,
  mapSmokeTestStatus,
  queueDirectSmokeTestJob,
  smokeFailureCodeForStage,
  smokeTestCampaignConfig,
  validateDirectSmokeUrl,
} from './smoke-test'

const config: ServerConfig = {
  port: 0,
  llmApiKey: '',
  llmApiBaseUrl: 'https://example.invalid/v1',
  llmModel: 'test-model',
  supabaseUrl: '',
  supabaseServiceRoleKey: '',
  joobleApiKey: '',
  joobleEnabled: false,
  joobleApiBaseUrl: 'https://jooble.org/api',
  usajobsApiKey: '',
  usajobsUserAgentEmail: '',
  usajobsEnabled: false,
  jobOpportunitiesEnabled: false,
  jobOpportunitiesApiBaseUrl: 'https://api.jobopportunitiesapi.org',
}

const profile: AutoApplyProfile = {
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

function liveJob(partial: Partial<LiveJob> & { id: string }): LiveJob {
  const url = partial.applicationUrl ?? 'https://job-boards.greenhouse.io/gitlab/jobs/1'
  return {
    id: partial.id,
    title: partial.title ?? 'Backend Engineer',
    company: partial.company ?? 'GitLab',
    location: partial.location ?? 'Remote',
    remote: partial.remote ?? true,
    employmentType: partial.employmentType ?? 'full-time',
    seniority: partial.seniority ?? null,
    description: partial.description ?? 'Build things.',
    url: partial.url ?? url,
    source: partial.source ?? 'greenhouse',
    sourceJobId: partial.sourceJobId ?? partial.id,
    postedAt: partial.postedAt ?? new Date().toISOString(),
    fetchedAt: partial.fetchedAt ?? new Date().toISOString(),
    provider: partial.provider ?? 'greenhouse',
    providerJobId: partial.providerJobId ?? partial.id,
    jobUrl: partial.jobUrl ?? url,
    workArrangement: partial.workArrangement ?? 'remote',
    discoveredAt: partial.discoveredAt ?? new Date().toISOString(),
    lastVerifiedAt: partial.lastVerifiedAt ?? new Date().toISOString(),
    identityKey: partial.identityKey ?? `greenhouse:${partial.id}`,
    salaryMin: partial.salaryMin ?? null,
    salaryMax: partial.salaryMax ?? null,
    salaryCurrency: partial.salaryCurrency ?? null,
    rawMetadata: partial.rawMetadata ?? {},
    match: partial.match ?? { score: null, matchedSkills: [], missingSkills: [], resumeVersionId: null, scoreUpdatedAt: null, cached: false },
    matchScore: partial.matchScore ?? null,
    matchedSkills: partial.matchedSkills ?? [],
    missingSkills: partial.missingSkills ?? [],
    c2cStatus: partial.c2cStatus ?? 'unknown',
    c2cEvidence: partial.c2cEvidence ?? [],
    applicationUrl: url,
    discoveryProvider: partial.discoveryProvider ?? 'greenhouse',
    applicationProvider: partial.applicationProvider ?? null,
    applicationCapability: partial.applicationCapability ?? null,
  }
}

function seedCandidate(userId = 'direct-user') {
  saveCandidateProfile({ userId, profile, resumeText: 'Java engineer resume', resumeVersionId: 'resume-1' })
}

beforeEach(() => {
  resetAgentForTests()
  clearAutoApplyMemory()
  resetConfirmedApplicationsForTests()
  resetCandidateStoreForTests()
  resetLiveJobStoreForTests()
  resetBrowserWorkerQueueForTests()
})

afterEach(() => {
  resetAgentForTests()
  clearAutoApplyMemory()
  resetConfirmedApplicationsForTests()
  resetCandidateStoreForTests()
  resetLiveJobStoreForTests()
  resetBrowserWorkerQueueForTests()
})

describe('direct one-job smoke test', () => {
  it('queues one already-loaded live job without discovery, match, C2C, or tailoring', async () => {
    seedCandidate()
    expect(rememberLiveJobs([liveJob({ id: 'live-1' })])).toBe(1)
    expect(getLiveJobSnapshot('live-1')?.title).toBe('Backend Engineer')
    expect(listLiveJobSnapshots()).toHaveLength(1)

    const queued = await queueDirectSmokeTestJob({ userId: 'direct-user', jobId: 'live-1', serverConfig: config })
    expect(queued.item.applicationStatus).toBe('queued')
    expect(queued.item.applicationUrl).toBe('https://job-boards.greenhouse.io/gitlab/jobs/1')
    expect(queued.item.discoverySource).toBe('smoke-test')
    expect(queued.item.applicationCapability).toBe('unknown')
    expect(queued.item.masterResumeUnchanged).toBe(true)
    expect(queued.item.tailoredResumeText).toBe('Java engineer resume')
    expect(queued.run.config.maxJobs).toBe(1)
    expect(queued.run.config.autoTailorResume).toBe(false)
    expect(queued.item.applicationId).toBeTruthy()
  })

  it('rejects an unknown jobId without calling discovery', async () => {
    seedCandidate()
    await expect(queueDirectSmokeTestJob({ userId: 'direct-user', jobId: 'missing', serverConfig: config })).rejects.toMatchObject({
      status: 404,
    })
  })

  it('lets the browser worker claim the direct smoke-test item', async () => {
    seedCandidate()
    rememberLiveJobs([liveJob({ id: 'live-1' })])
    const queued = await queueDirectSmokeTestJob({ userId: 'direct-user', jobId: 'live-1', serverConfig: config })
    const claimed = await claimNextBrowserJob()
    expect(claimed?.item.id).toBe(queued.item.id)
    expect(claimed?.item.applicationStatus).toBe('opening')
  })

  it('validates employer URLs and rejects localhost, non-http, and placeholder values', () => {
    expect(validateDirectSmokeUrl('https://job-boards.greenhouse.io/gitlab/jobs/1').ok).toBe(true)
    expect(validateDirectSmokeUrl('http://localhost:5173/jobs').ok).toBe(false)
    expect(validateDirectSmokeUrl('http://127.0.0.1:8787/jobs').ok).toBe(false)
    expect(validateDirectSmokeUrl('chrome://settings').ok).toBe(false)
    expect(validateDirectSmokeUrl('file:///tmp/resume.pdf').ok).toBe(false)
    expect(validateDirectSmokeUrl('javascript:alert(1)').ok).toBe(false)
    expect(validateDirectSmokeUrl('undefined').ok).toBe(false)
    expect(validateDirectSmokeUrl('null').ok).toBe(false)
    expect(validateDirectSmokeUrl(null).ok).toBe(false)
    expect(validateDirectSmokeUrl('http://127.0.0.1:8787/test-employer/job/1').ok).toBe(true)
  })

  it('detects legitimate Apply and final Submit labels only', () => {
    expect(isLegitimateApplyLabel('Apply')).toBe(true)
    expect(isLegitimateApplyLabel('Apply Now')).toBe(true)
    expect(isLegitimateApplyLabel('Apply to Job')).toBe(true)
    expect(isLegitimateApplyLabel('Start Application')).toBe(true)
    expect(isLegitimateApplyLabel('Sign in')).toBe(false)
    expect(isLegitimateApplyLabel('LinkedIn Easy Apply')).toBe(false)
    expect(isFinalSubmitLabel('Submit Application')).toBe(true)
    expect(isFinalSubmitLabel('Submit')).toBe(true)
    expect(isFinalSubmitLabel('Next')).toBe(false)
  })

  it('detects application surfaces and blocking page states', () => {
    const surface = analyzeApplicationSurface(
      `<form><label>First Name</label><input name="first_name"><label>Email</label><input type="email" name="email"><input type="file" name="resume"><button>Submit Application</button></form>`,
      { url: 'https://example.com/apply' },
    )
    expect(surface.kind).toBe('application')
    expect(surface.inspection.hasFileInput).toBe(true)
    expect(inspectApplicationPage('<div class="g-recaptcha"></div>').status).toBe('captcha_required')
    expect(inspectApplicationPage('<p>Enter the authenticator app code</p><input name="otp">').status).toBe('mfa_required')
    expect(inspectApplicationPage('<p>Sign in to continue</p><input type="password" name="pw">').status).toBe('login_required')
  })

  it('maps known questions from the profile and leaves unknown required questions unanswered', () => {
    const resolved = resolveApplicationQuestions(
      ['What is your first name?', 'What is your favorite color?'],
      profile,
      'direct-user',
    )
    expect(resolved.answered.map((item) => item.prompt)).toContain('What is your first name?')
    expect(resolved.unknown.map((item) => item.prompt)).toContain('What is your favorite color?')
    expect(resolved.unknown[0]?.answer).toBeNull()
  })

  it('uploads the selected resume without modifying the master resume', () => {
    const upload = selectedResumeForUpload({
      resumeVersionId: 'resume-1',
      resumeVersionName: 'Master',
      tailoredResumeText: 'Java engineer resume',
      masterResumeUnchanged: true,
    })
    expect(upload?.buffer.toString()).toBe('Java engineer resume')
    expect(upload?.versionId).toBe('resume-1')
    expect(upload?.masterUnchanged).toBe(true)
  })

  it('supports bounded multi-step navigation state', () => {
    expect(classifyNavigationControl('Apply Now')).toBe('apply')
    expect(classifyNavigationControl('Next')).toBe('next')
    expect(classifyNavigationControl('Submit Application')).toBe('submit')
    const step = persistStepState({ step: 2, pageType: 'application', url: 'https://example.com/apply/2' })
    expect(step.step).toBe(2)
    expect(step.persistedAt).toBeTruthy()
    expect(isBoundedStepTimeout(5_000)).toBe(true)
    expect(isBoundedStepTimeout(60_000)).toBe(false)
  })

  it('stops on CAPTCHA, login, and MFA without submitting', () => {
    expect(mapSmokeTestStatus({ captcha: true }).status).toBe('captcha_required')
    expect(mapSmokeTestStatus({ login: true }).status).toBe('login_required')
    expect(mapSmokeTestStatus({ mfa: true }).status).toBe('mfa_required')
    expect(shouldPersistConfirmedApplication({ applicationStatus: 'captcha_required' })).toBe(false)
    expect(shouldPersistConfirmedApplication({ applicationStatus: 'login_required' })).toBe(false)
    expect(shouldPersistConfirmedApplication({ applicationStatus: 'mfa_required' })).toBe(false)
  })

  it('confirms submission only with reliable post-submit evidence', () => {
    const confirmed = detectSubmissionConfirmation({
      html: '<h1>Application Submitted</h1><p>Confirmation Number: ABC-12345</p>',
      title: 'Application Submitted',
      url: 'https://example.com/done',
    })
    expect(confirmed.confirmed).toBe(true)
    const weak = detectSubmissionConfirmation({ html: '<p>Thank you!</p>', title: 'Thank you!' })
    expect(weak.confirmed).toBe(false)
    const missing = detectSubmissionConfirmation({ html: '<p>Review your application</p>', title: 'Review' })
    expect(missing.confirmed).toBe(false)
  })

  it('persists Applications only after a confirmed submission', () => {
    const base = buildSmokeTestQueueItem({
      run: {
        id: 'run-1',
        userId: 'direct-user',
        status: 'running',
        config: smokeTestCampaignConfig(undefined),
        counts: {
          found: 0, eligible: 0, autoApplyCapable: 0, tailored: 0, ready: 0, needsInput: 0,
          submitted: 0, skipped: 0, failed: 0, queued: 0, processing: 0, processed: 0, blocked: 0, captcha: 0,
        },
        createdAt: '2026-09-25T00:00:00.000Z',
        updatedAt: '2026-09-25T00:00:00.000Z',
      },
      start: {
        userId: 'direct-user',
        resumeId: 'resume-1',
        resumeVersionId: 'resume-1',
        resumeText: 'Java engineer resume',
        masterResumeText: 'Java engineer resume',
        profile,
        config: smokeTestCampaignConfig(undefined),
      },
      job: liveJobToListedJob(liveJob({ id: 'live-1' })),
      url: 'https://job-boards.greenhouse.io/gitlab/jobs/1',
    })
    const submitted: AutoApplyQueueItem = { ...base, applicationStatus: 'submitted', submittedAt: '2026-09-25T00:01:00.000Z' }
    const record = buildConfirmedApplicationRecord({ userId: 'direct-user', item: submitted })
    expect(record?.status).toBe('applied')
    expect(record?.submittedResumeVersionId).toBe('resume-1')
    expect(record?.submittedJobDescriptionSnapshot).toContain('Build things')
    expect(buildConfirmedApplicationRecord({ userId: 'direct-user', item: { ...base, applicationStatus: 'submission_uncertain' } })).toBeNull()
    expect(buildConfirmedApplicationRecord({ userId: 'direct-user', item: { ...base, applicationStatus: 'ready_for_submission' } })).toBeNull()
  })

  it('rejects duplicates and never queues a second smoke-test job', async () => {
    seedCandidate()
    rememberLiveJobs([liveJob({ id: 'live-1' }), liveJob({ id: 'live-2', identityKey: 'greenhouse:live-2' })])
    await queueDirectSmokeTestJob({ userId: 'direct-user', jobId: 'live-1', serverConfig: config })
    await expect(queueDirectSmokeTestJob({ userId: 'direct-user', jobId: 'live-1', serverConfig: config })).rejects.toMatchObject({
      status: 409,
    })
    await expect(queueDirectSmokeTestJob({ userId: 'direct-user', jobId: 'live-2', serverConfig: config })).rejects.toMatchObject({
      status: 409,
    })
  })

  it('never reports a false Submitted status', () => {
    expect(mapAgentStatusToSmokeStatus('submitted', true)).toBe('submitted')
    expect(mapAgentStatusToSmokeStatus('needs_confirmation', true)).toBe('submission_uncertain')
    expect(mapAgentStatusToSmokeStatus('needs_user_confirmation', false)).toBe('submission_uncertain')
    expect(mapAgentStatusToSmokeStatus('failed', false)).toBe('submission_failed')
    expect(mapAgentStatusToSmokeStatus('ready_for_submission', false)).toBe('submission_failed')
    expect(shouldPersistConfirmedApplication({ applicationStatus: 'submission_uncertain' })).toBe(false)
    expect(shouldPersistConfirmedApplication({ applicationStatus: 'submission_failed' })).toBe(false)
  })

  it('maps each failing stage to a distinct failure code', () => {
    expect(smokeFailureCodeForStage('job_selected')).toBe('WORKER_QUEUE_FAILURE')
    expect(smokeFailureCodeForStage('browser')).toBe('NAVIGATION_FAILURE')
    expect(smokeFailureCodeForStage('application_page')).toBe('APPLICATION_NAVIGATION_FAILURE')
    expect(smokeFailureCodeForStage('fields')).toBe('APPLICATION_DETECTION_FAILURE')
    expect(smokeFailureCodeForStage('resume')).toBe('RESUME_UPLOAD_FAILURE')
    expect(smokeFailureCodeForStage('final_submit')).toBe('SUBMISSION_ACTION_FAILURE')
    expect(smokeFailureCodeForStage('confirmation')).toBe('SUBMISSION_CONFIRMATION_FAILURE')
    const report = buildDirectSmokeTestReport({
      jobTitle: 'Backend Engineer',
      company: 'GitLab',
      jobId: 'live-1',
      applicationUrl: 'https://job-boards.greenhouse.io/gitlab/jobs/1',
      queue: 'PASS',
      worker: 'PASS',
      browser: 'PASS',
      initialUrl: 'https://job-boards.greenhouse.io/gitlab/jobs/1',
      finalUrl: 'https://job-boards.greenhouse.io/gitlab/jobs/1',
      pageType: 'UNKNOWN_PAGE',
      provider: 'greenhouse',
      applicationDetected: 'FAIL',
      fields: 'FAIL',
      profileMapping: 'PASS',
      resume: 'FAIL',
      multiStep: 'FAIL',
      finalSubmit: 'FAIL',
      confirmation: 'FAIL',
      applicationCreated: false,
      firstFailure: 'application_page',
      rootCause: 'No application form was detected.',
    })
    expect(report).toContain('JOB ID:')
    expect(report).toContain('APPLICATION DETECTED:')
    expect(report).toContain('FAILURE CODE: APPLICATION_NAVIGATION_FAILURE')
  })

  it('exposes POST /api/automation/smoke-test for one existing job', async () => {
    seedCandidate()
    rememberLiveJobs([liveJob({ id: 'live-1' })])
    const app = createApp({ config })
    const queued = await request(app).post('/api/automation/smoke-test').send({ jobId: 'live-1', userId: 'direct-user' })
    expect(queued.status).toBe(200)
    expect(queued.body.success).toBe(true)
    expect(queued.body.status).toBe('queued')
    expect(queued.body.applicationId).toBeTruthy()

    const missingUser = await request(app).post('/api/automation/smoke-test').send({ jobId: 'live-1' })
    expect(missingUser.status).toBe(401)
  })
})
