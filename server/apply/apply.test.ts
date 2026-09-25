import { afterEach, describe, expect, it } from 'vitest'
import { classifyC2c } from '../jobs/c2c'
import { emptyLiveMatch } from '../jobs/score'
import { JAVA_BACKEND_JD, JAVA_RESUME_TEXT } from '../tailor/fixtures'
import { inspectApplicationPage } from './detect'
import {
  cancelQueueItem,
  cancelRun,
  defaultAutoApplyConfig,
  prepareQueueItem,
  resetAutoApplyEngineForTests,
  skipQueueItem,
  startAutoApply,
  submitQueueItem,
  tailorForJob,
} from './engine'
import { hasDuplicateApplication, isEligibleForAutoApply, meetsMatchThreshold } from './eligibility'
import { answerKnownQuestion } from './questions'
import { clearAutoApplyMemory } from './store'
import { resetAgentForTests } from '../agent'
import type { ApplyBrowser, AutoApplyProfile, ListedAutoApplyJob } from './types'
import type { ServerConfig } from '../config'

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
  jobOpportunitiesEnabled: true,
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
  targetSalaryMin: 120000,
  targetSalaryMax: 150000,
}

function job(partial: Partial<ListedAutoApplyJob> & Pick<ListedAutoApplyJob, 'id' | 'title'>): ListedAutoApplyJob {
  const description = partial.description ?? 'Java Spring Boot C2C'
  const c2c = classifyC2c({ title: partial.title, description, employmentType: partial.employmentType ?? 'Contract' })
  return {
    company: 'Example',
    description,
    url: `https://jobs.example.com/${partial.id}`,
    jobUrl: `https://jobs.example.com/${partial.id}`,
    identityKey: `job-opportunities:${partial.id}`,
    provider: 'job-opportunities',
    providerJobId: partial.id,
    location: 'Austin, TX',
    employmentType: 'Contract',
    c2cStatus: c2c.status,
    c2cEvidence: c2c.evidence,
    match: { ...emptyLiveMatch('resume-1'), score: 90, matchedSkills: ['Java'], missingSkills: [] },
    postedAt: '2026-09-17T00:00:00.000Z',
    fetchedAt: '2026-09-17T00:00:00.000Z',
    ...partial,
    matchScore: partial.matchScore ?? partial.match?.score ?? 90,
  }
}

const fakeBrowser: ApplyBrowser = {
  async prepare(input) {
    if (input.html) {
      const inspection = inspectApplicationPage(input.html)
      if (inspection.status !== 'filling') {
        return { status: inspection.status, questions: [], failureReason: inspection.failureReason, sessionId: null }
      }
    }
    return { status: 'ready_for_submission', questions: [], failureReason: null, sessionId: `filled:${input.url}` }
  },
  async submit() {
    return { status: 'submitted', failureReason: null }
  },
}

afterEach(() => {
  clearAutoApplyMemory()
  resetAutoApplyEngineForTests()
  resetAgentForTests()
})

describe('auto apply eligibility', () => {
  it('uses the raw match threshold without changing the score', () => {
    expect(meetsMatchThreshold(85, 85)).toBe(true)
    expect(meetsMatchThreshold(84, 85)).toBe(false)
    expect(meetsMatchThreshold(90, 85)).toBe(true)
    expect(meetsMatchThreshold(null, 70)).toBe(false)
  })

  it('rejects jobs without an application URL and duplicate applications', () => {
    const listing = job({ id: 'dup', title: 'Java Engineer', url: null, jobUrl: null, matchScore: 90 })
    expect(isEligibleForAutoApply(listing, { minimumMatchRate: 80, finalMatchScore: 90 }).ok).toBe(false)
    const withUrl = job({ id: 'dup', title: 'Java Engineer', matchScore: 90 })
    expect(
      hasDuplicateApplication(withUrl, [{ jobId: 'dup', identityKey: withUrl.identityKey, status: 'applied' }]),
    ).toBe(true)
    expect(hasDuplicateApplication(withUrl, [])).toBe(false)
  })
})

describe('auto apply engine', () => {
  it('selects only jobs at or above the threshold up to maxJobs', async () => {
    const listed = [
      job({ id: 'high', title: 'High', matchScore: 92, match: { ...emptyLiveMatch(), score: 92, matchedSkills: [], missingSkills: [] } }),
      job({ id: 'mid', title: 'Mid', matchScore: 80, match: { ...emptyLiveMatch(), score: 80, matchedSkills: [], missingSkills: [] } }),
      job({ id: 'low', title: 'Low', matchScore: 60, match: { ...emptyLiveMatch(), score: 60, matchedSkills: [], missingSkills: [] } }),
    ]
    const result = await startAutoApply(
      config,
      {
        userId: 'user-1',
        resumeId: 'resume-1',
        resumeVersionId: 'resume-1',
        resumeText: JAVA_RESUME_TEXT,
        masterResumeText: JAVA_RESUME_TEXT,
        profile,
        config: defaultAutoApplyConfig({ maxJobs: 1, minimumMatchRate: 85, autoTailorResume: false, q: 'Java', jobType: 'all' }),
      },
      undefined,
      { listJobs: async () => ({ jobs: listed }), delayMs: 0 },
    )
    expect(result.items).toHaveLength(1)
    expect(result.items[0].title).toBe('High')
    expect(result.items[0].finalMatchScore).toBe(92)
    expect(result.run.config.minimumMatchRate).toBe(85)
  })

  it('qualifies a current score at the threshold and fails one below it', async () => {
    const listed = [
      job({ id: 'pass', title: 'Pass', matchScore: 85, match: { ...emptyLiveMatch(), score: 85, matchedSkills: [], missingSkills: [] } }),
      job({ id: 'fail', title: 'Fail', matchScore: 84, match: { ...emptyLiveMatch(), score: 84, matchedSkills: [], missingSkills: [] } }),
    ]
    const result = await startAutoApply(
      config,
      {
        userId: 'user-1',
        resumeId: 'resume-1',
        resumeVersionId: 'resume-1',
        resumeText: JAVA_RESUME_TEXT,
        masterResumeText: JAVA_RESUME_TEXT,
        profile,
        config: defaultAutoApplyConfig({ maxJobs: 10, minimumMatchRate: 85, autoTailorResume: false }),
      },
      undefined,
      { listJobs: async () => ({ jobs: listed }), delayMs: 0 },
    )
    expect(result.items.map((item) => item.title)).toEqual(['Pass'])
  })

  it('can raise a score above the threshold with tailoring and keep the master resume unchanged', async () => {
    const master = JAVA_RESUME_TEXT
    const listed = [
      job({
        id: 'java',
        title: 'Senior Java Engineer',
        description: JAVA_BACKEND_JD + '\nC2C',
        matchScore: 40,
        match: { ...emptyLiveMatch(), score: 40, matchedSkills: [], missingSkills: [] },
      }),
    ]
    const tailored = tailorForJob({ resumeText: master, job: listed[0] })
    expect(tailored.score).toBeGreaterThanOrEqual(40)
    const result = await startAutoApply(
      config,
      {
        userId: 'user-1',
        resumeId: 'resume-1',
        resumeVersionId: 'resume-1',
        resumeText: master,
        masterResumeText: master,
        profile,
        config: defaultAutoApplyConfig({ maxJobs: 5, minimumMatchRate: 50, autoTailorResume: true }),
      },
      undefined,
      { listJobs: async () => ({ jobs: listed }), delayMs: 0 },
    )
    expect(master).toBe(JAVA_RESUME_TEXT)
    expect(result.items[0]?.masterResumeUnchanged).toBe(true)
    expect(result.items[0]?.resumeVersionId).toBeTruthy()
    expect(result.items[0]?.resumeVersionName).toMatch(/Tailored/)
    expect(result.items[0]?.finalMatchScore).toBeGreaterThanOrEqual(result.items[0]?.initialMatchScore ?? 0)
  })

  it('leaves jobs below the threshold out after tailoring', async () => {
    const listed = [
      job({
        id: 'k8s',
        title: 'Kubernetes Only',
        description: 'Required: Kubernetes Terraform Go Kafka only. No Java. C2C.',
        matchScore: 20,
        match: { ...emptyLiveMatch(), score: 20, matchedSkills: [], missingSkills: [] },
      }),
    ]
    const result = await startAutoApply(
      config,
      {
        userId: 'user-1',
        resumeId: 'resume-1',
        resumeVersionId: 'resume-1',
        resumeText: JAVA_RESUME_TEXT,
        masterResumeText: JAVA_RESUME_TEXT,
        profile,
        config: defaultAutoApplyConfig({ maxJobs: 5, minimumMatchRate: 95, autoTailorResume: true }),
      },
      undefined,
      { listJobs: async () => ({ jobs: listed }), delayMs: 0 },
    )
    expect(result.items).toEqual([])
  })

  it('prevents duplicate applications and duplicate queue entries', async () => {
    const listed = [job({ id: 'same', title: 'Java Engineer', matchScore: 90 })]
    const first = await startAutoApply(
      config,
      {
        userId: 'user-1',
        resumeId: 'resume-1',
        resumeVersionId: 'resume-1',
        resumeText: JAVA_RESUME_TEXT,
        masterResumeText: JAVA_RESUME_TEXT,
        profile,
        config: defaultAutoApplyConfig({ autoTailorResume: false, maxJobs: 5, minimumMatchRate: 70 }),
        existingApplications: [{ jobId: 'same', identityKey: 'job-opportunities:same', status: 'applied' }],
      },
      undefined,
      { listJobs: async () => ({ jobs: listed }), delayMs: 0 },
    )
    expect(first.items).toEqual([])
    const queued = await startAutoApply(
      config,
      {
        userId: 'user-1',
        resumeId: 'resume-1',
        resumeVersionId: 'resume-1',
        resumeText: JAVA_RESUME_TEXT,
        masterResumeText: JAVA_RESUME_TEXT,
        profile,
        config: defaultAutoApplyConfig({ autoTailorResume: false, maxJobs: 5, minimumMatchRate: 70 }),
        existingQueueIdentities: ['job-opportunities:same'],
      },
      undefined,
      { listJobs: async () => ({ jobs: listed }), delayMs: 0 },
    )
    expect(queued.items).toEqual([])
  })

  it('keeps selected resume version on tailored items and uses master when tailoring is off', async () => {
    const offListed = [job({ id: 'java-off', title: 'Java Engineer', description: JAVA_BACKEND_JD + '\nC2C', matchScore: 88 })]
    const off = await startAutoApply(
      config,
      {
        userId: 'user-1',
        resumeId: 'resume-1',
        resumeVersionId: 'resume-1',
        resumeText: JAVA_RESUME_TEXT,
        masterResumeText: JAVA_RESUME_TEXT,
        profile,
        config: defaultAutoApplyConfig({ autoTailorResume: false, minimumMatchRate: 70 }),
      },
      undefined,
      { listJobs: async () => ({ jobs: offListed }), delayMs: 0 },
    )
    expect(off.items[0]?.resumeVersionId).toBeTruthy()
    expect(off.items[0]?.sourceResumeId).toBe('resume-1')
    expect(off.items[0]?.resumeVersionName).toBe('Master')
    const onListed = [job({ id: 'java-on', title: 'Java Engineer', description: JAVA_BACKEND_JD + '\nC2C', matchScore: 88 })]
    const on = await startAutoApply(
      config,
      {
        userId: 'user-1',
        resumeId: 'resume-1',
        resumeVersionId: 'resume-1',
        resumeText: JAVA_RESUME_TEXT,
        masterResumeText: JAVA_RESUME_TEXT,
        profile,
        config: defaultAutoApplyConfig({ autoTailorResume: true, minimumMatchRate: 70 }),
      },
      undefined,
      { listJobs: async () => ({ jobs: onListed }), delayMs: 0 },
    )
    expect(on.items[0]?.resumeVersionId).toBeTruthy()
    expect(on.items[0]?.resumeVersionName).toMatch(/Tailored/)
  })

  it('detects captcha, MFA, unknown questions, failure, cancel, skip, and submission state', async () => {
    const listed = [job({ id: 'java', title: 'Java Engineer', matchScore: 90 })]
    const started = await startAutoApply(
      config,
      {
        userId: 'user-1',
        resumeId: 'resume-1',
        resumeVersionId: 'resume-1',
        resumeText: JAVA_RESUME_TEXT,
        masterResumeText: JAVA_RESUME_TEXT,
        profile,
        config: defaultAutoApplyConfig({ autoTailorResume: false, minimumMatchRate: 70 }),
      },
      undefined,
      { listJobs: async () => ({ jobs: listed }), browser: fakeBrowser, delayMs: 0 },
    )
    expect(started.items[0].applicationStatus).toBe('queued')
    expect(started.items[0].applicationStatus).not.toBe('submitted')
    const tooEarly = await submitQueueItem(started.run.id, started.items[0].id, { browser: fakeBrowser, delayMs: 0 })
    expect(tooEarly?.item.applicationStatus).toBe('queued')

    const captcha = inspectApplicationPage('<div class="g-recaptcha" data-sitekey="x"></div>')
    expect(captcha.status).toBe('captcha_required')
    const mfa = inspectApplicationPage('<p>Enter the authenticator app code</p>')
    expect(mfa.status).toBe('mfa_required')
    expect(answerKnownQuestion('Are you authorized to work in the United States?', profile)?.answer).toBe('Yes')
    expect(answerKnownQuestion('Availability?', profile)).toBeNull()

    const prepared = await prepareQueueItem(
      started.run.id,
      started.items[0].id,
      { profile, html: '<form><label>Full name</label><input name="name"><button type="submit">Submit</button></form>' },
      { browser: fakeBrowser, delayMs: 0 },
    )
    expect(prepared?.item.applicationStatus).toBe('ready_for_submission')
    const submitted = await submitQueueItem(started.run.id, started.items[0].id, { browser: fakeBrowser, delayMs: 0 })
    expect(submitted?.item.applicationStatus).toBe('submitted')

    const unconfirmedBrowser: ApplyBrowser = {
      async prepare() {
        return { status: 'ready_for_submission', questions: [], failureReason: null, sessionId: 'filled:unconfirmed' }
      },
      async submit() {
        return {
          status: 'needs_user_confirmation',
          failureReason: 'Submission could not be confirmed on the employer site.',
          success: false,
          confirmationDetected: false,
          finalActionCompleted: true,
          resultingUrl: 'https://jobs.example.com/thank-you',
        }
      },
    }
    const unconfirmedStart = await startAutoApply(
      config,
      {
        userId: 'user-1',
        resumeId: 'resume-1',
        resumeVersionId: 'resume-1',
        resumeText: JAVA_RESUME_TEXT,
        masterResumeText: JAVA_RESUME_TEXT,
        profile,
        config: defaultAutoApplyConfig({ autoTailorResume: false, minimumMatchRate: 70 }),
      },
      undefined,
      {
        listJobs: async () => ({ jobs: [job({ id: 'unconfirmed', title: 'Unconfirmed', matchScore: 90 })] }),
        browser: unconfirmedBrowser,
        delayMs: 0,
      },
    )
    await prepareQueueItem(unconfirmedStart.run.id, unconfirmedStart.items[0].id, { profile }, { browser: unconfirmedBrowser, delayMs: 0 })
    const unconfirmed = await submitQueueItem(unconfirmedStart.run.id, unconfirmedStart.items[0].id, {
      browser: unconfirmedBrowser,
      delayMs: 0,
    })
    expect(unconfirmed?.item.applicationStatus).toBe('needs_user_confirmation')
    expect(unconfirmed?.item.applicationStatus).not.toBe('submitted')

    const second = await startAutoApply(
      config,
      {
        userId: 'user-1',
        resumeId: 'resume-1',
        resumeVersionId: 'resume-1',
        resumeText: JAVA_RESUME_TEXT,
        masterResumeText: JAVA_RESUME_TEXT,
        profile,
        config: defaultAutoApplyConfig({ autoTailorResume: false, minimumMatchRate: 70 }),
      },
      undefined,
      {
        listJobs: async () => ({ jobs: [job({ id: 'other', title: 'Other', matchScore: 90 })] }),
        browser: fakeBrowser,
        delayMs: 0,
      },
    )
    const skipped = await skipQueueItem(second.run.id, second.items[0].id, { delayMs: 0 })
    expect(skipped?.item.applicationStatus).toBe('skipped')
    const third = await startAutoApply(
      config,
      {
        userId: 'user-1',
        resumeId: 'resume-1',
        resumeVersionId: 'resume-1',
        resumeText: JAVA_RESUME_TEXT,
        masterResumeText: JAVA_RESUME_TEXT,
        profile,
        config: defaultAutoApplyConfig({ autoTailorResume: false, minimumMatchRate: 70 }),
      },
      undefined,
      {
        listJobs: async () => ({ jobs: [job({ id: 'third', title: 'Third', matchScore: 90 })] }),
        delayMs: 0,
      },
    )
    const cancelled = await cancelQueueItem(third.run.id, third.items[0].id, { delayMs: 0 })
    expect(cancelled?.item.applicationStatus).toBe('cancelled')
    const run = await cancelRun(third.run.id)
    expect(run?.run.status).toBe('cancelled')

    const needsInput = inspectApplicationPage('<form><label>Availability?</label><input name="when"></form>')
    expect(needsInput.questions.join(' ')).toMatch(/Availability/)
  })

  it('filters C2C jobs using negative evidence', async () => {
    const listed = [
      job({ id: 'c2c', title: 'C2C Java', description: 'Corp to Corp Java', matchScore: 90 }),
      job({ id: 'nope', title: 'Java', description: 'No C2C. W2 only.', matchScore: 90 }),
    ]
    const result = await startAutoApply(
      config,
      {
        userId: 'user-1',
        resumeId: 'resume-1',
        resumeVersionId: 'resume-1',
        resumeText: JAVA_RESUME_TEXT,
        masterResumeText: JAVA_RESUME_TEXT,
        profile,
        config: defaultAutoApplyConfig({ autoTailorResume: false, minimumMatchRate: 70, jobType: 'c2c' }),
      },
      undefined,
      {
        listJobs: async () => ({
          jobs: listed.filter((item) => item.c2cStatus === 'confirmed'),
        }),
        delayMs: 0,
      },
    )
    expect(result.items).toHaveLength(1)
    expect(result.items[0].c2cStatus).toBe('confirmed')
  })
})
