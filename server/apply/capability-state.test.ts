import { afterEach, describe, expect, it } from 'vitest'
import { classifyC2c } from '../jobs/c2c'
import { emptyLiveMatch } from '../jobs/score'
import { JAVA_RESUME_TEXT } from '../tailor/fixtures'
import { defaultAutoApplyConfig, resetAutoApplyEngineForTests, startAutoApply } from './engine'
import { clearAutoApplyMemory } from './store'
import { resetCapabilityCacheForTests, rememberDecision, lookupCapability } from './capability-cache'
import { canEnterAutonomousApply, classifyApplicationCapability } from './capability'
import { applicationPreflight } from './application-preflight'
import { recount } from './counts'
import { isEligibleForAutoApply } from './eligibility'
import { analyzeCaptcha } from './captcha'
import { detectSubmissionConfirmation } from './confirm'
import { APPLY_LIFECYCLE_STATES, type AutoApplyProfile, type AutoApplyQueueItem, type ListedAutoApplyJob } from './types'
import { claimNextBrowserJob, resetBrowserWorkerQueueForTests } from '../browser-worker/queue'
import { evaluateJobEligibility } from '../agent/pipeline'
import { syntheticEmployerHtml } from '../browser-worker/synthetic'
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

const greenhouseForm = `
  <form id="application-form">
    <label>First Name</label><input name="first_name" autocomplete="given-name">
    <label>Last Name</label><input name="last_name" autocomplete="family-name">
    <label>Email</label><input type="email" name="email" autocomplete="email">
    <label>Upload Resume</label><input type="file" name="resume" aria-label="Upload Resume">
    <button type="submit">Submit Application</button>
  </form>
`

function job(partial: Partial<ListedAutoApplyJob> & { id: string; title?: string }): ListedAutoApplyJob {
  const description = partial.description ?? 'Java Spring Boot C2C corp to corp'
  const c2c = classifyC2c({ title: partial.title ?? 'Java Engineer', description })
  return {
    title: partial.title ?? 'Java Engineer',
    company: partial.company ?? 'Acme',
    description,
    url: partial.url ?? `https://jobs.example.com/${partial.id}`,
    jobUrl: partial.jobUrl ?? partial.url ?? `https://jobs.example.com/${partial.id}`,
    identityKey: partial.identityKey ?? `job-opportunities:${partial.id}`,
    provider: partial.provider ?? 'job-opportunities',
    providerJobId: partial.id,
    location: partial.location ?? 'Austin, TX',
    employmentType: 'Contract',
    postedAt: '2026-09-17T00:00:00.000Z',
    fetchedAt: '2026-09-17T00:00:00.000Z',
    ...partial,
    c2cStatus: partial.c2cStatus ?? c2c.status,
    c2cEvidence: partial.c2cEvidence ?? c2c.evidence,
    match: partial.match ?? { ...emptyLiveMatch('resume-1'), score: 90, matchedSkills: ['Java'], missingSkills: [] },
    matchScore: partial.matchScore ?? 90,
  }
}

const startInput = {
  userId: 'user-1',
  resumeId: 'resume-1',
  resumeVersionId: 'resume-1',
  resumeText: JAVA_RESUME_TEXT,
  masterResumeText: JAVA_RESUME_TEXT,
  profile,
  config: defaultAutoApplyConfig({ maxJobs: 5, minimumMatchRate: 80, autoTailorResume: false, q: 'Java', jobType: 'c2c' }),
}

afterEach(() => {
  resetAutoApplyEngineForTests()
  resetCapabilityCacheForTests()
  clearAutoApplyMemory()
  resetBrowserWorkerQueueForTests()
})

describe('capability state machine', () => {
  it('keeps eligible distinct from auto_apply_supported', () => {
    const listed = job({
      id: 'gh',
      url: 'https://boards.greenhouse.io/acme/jobs/1',
      jobUrl: 'https://boards.greenhouse.io/acme/jobs/1',
      provider: 'greenhouse',
      discoveryProvider: 'greenhouse',
    })
    expect(isEligibleForAutoApply(listed, { minimumMatchRate: 80, finalMatchScore: 90 }).ok).toBe(true)
    expect(classifyApplicationCapability({ url: listed.url }).capability).toBe('unknown')
    expect(canEnterAutonomousApply(classifyApplicationCapability({ url: listed.url }).capability)).toBe(false)
    const evaluated = evaluateJobEligibility(listed, { startInput })
    expect(evaluated.ok).toBe(true)
    expect(evaluated.capability).not.toBe('auto_apply_supported')
  })

  it('never queues unsupported jobs and can queue auto_apply_supported jobs', async () => {
    const started = await startAutoApply(
      config,
      startInput,
      undefined,
      {
        delayMs: 0,
        listJobs: async () => ({
          jobs: [
            job({ id: 'indeed', url: 'https://www.indeed.com/viewjob?jk=1', jobUrl: 'https://www.indeed.com/viewjob?jk=1' }),
            job({
              id: 'gh-host',
              url: 'https://boards.greenhouse.io/acme/jobs/1',
              jobUrl: 'https://boards.greenhouse.io/acme/jobs/1',
              provider: 'greenhouse',
            }),
            job({ id: 'ready', url: 'https://jobs.example.com/ready' }),
          ],
        }),
      },
    )
    expect(started.run.counts.found).toBe(3)
    expect(started.run.counts.eligible).toBe(3)
    expect(started.items.map((item) => item.jobId)).toEqual(['ready'])
    expect(started.items[0]?.applicationCapability).toBe('auto_apply_supported')
    expect(started.run.counts.autoApplyCapable).toBe(1)
    const claimed = await claimNextBrowserJob()
    expect(claimed?.item.jobId).toBe('ready')
    expect(claimed?.item.applicationCapability).toBe('auto_apply_supported')
  })

  it('does not count Auto-Apply Capable for skipped or unsupported jobs', () => {
    const items: AutoApplyQueueItem[] = [
      {
        id: '1',
        runId: 'run',
        jobId: 'a',
        identityKey: 'a',
        applicationId: 'app-a',
        resumeVersionId: 'r',
        resumeVersionName: 'Master',
        title: 'Java',
        company: 'Acme',
        applicationUrl: 'https://boards.greenhouse.io/acme/jobs/1',
        initialMatchScore: 90,
        finalMatchScore: 90,
        c2cStatus: 'confirmed',
        c2cEvidence: [],
        applicationStatus: 'skipped',
        failureReason: 'The page was classified after collecting evidence and is not a supported application form.',
        questions: [],
        tailoredResumeText: null,
        jobDescriptionSnapshot: null,
        location: null,
        confirmationNumber: null,
        confirmationText: null,
        submittedAt: null,
        masterResumeUnchanged: true,
        sessionId: null,
        createdAt: '2026-09-21T00:00:00.000Z',
        updatedAt: '2026-09-21T00:00:00.000Z',
        applicationCapability: 'unsupported',
      },
      {
        id: '2',
        runId: 'run',
        jobId: 'b',
        identityKey: 'b',
        applicationId: 'app-b',
        resumeVersionId: 'r',
        resumeVersionName: 'Master',
        title: 'Java',
        company: 'Bank',
        applicationUrl: 'https://jobs.example.com/b',
        initialMatchScore: 90,
        finalMatchScore: 90,
        c2cStatus: 'confirmed',
        c2cEvidence: [],
        applicationStatus: 'queued',
        failureReason: null,
        questions: [],
        tailoredResumeText: null,
        jobDescriptionSnapshot: null,
        location: null,
        confirmationNumber: null,
        confirmationText: null,
        submittedAt: null,
        masterResumeUnchanged: true,
        sessionId: null,
        createdAt: '2026-09-21T00:00:00.000Z',
        updatedAt: '2026-09-21T00:00:00.000Z',
        applicationCapability: 'auto_apply_supported',
      },
    ]
    const counts = recount(items)
    expect(counts.autoApplyCapable).toBe(1)
    expect(counts.skipped).toBe(1)
    expect(counts.queued).toBe(1)
    items[1]!.applicationStatus = 'skipped'
    items[1]!.applicationCapability = 'unsupported'
    const after = recount(items)
    expect(after.autoApplyCapable).toBe(0)
    expect(after.skipped).toBe(2)
  })

  it('treats a known provider as unknown until the workflow is preflighted', () => {
    expect(classifyApplicationCapability({ url: 'https://boards.greenhouse.io/acme/jobs/1' }).provider).toBe('greenhouse')
    expect(applicationPreflight({ url: 'https://boards.greenhouse.io/acme/jobs/1' }).capability).toBe('unknown')
    expect(applicationPreflight({ url: 'https://boards.greenhouse.io/acme/jobs/1', html: greenhouseForm }).capability).toBe(
      'auto_apply_supported',
    )
  })

  it('follows job page → Apply → application page before declaring support', () => {
    const jobPage = applicationPreflight({
      url: 'https://jobs.example.com/role',
      html: syntheticEmployerHtml('job', '/test-employer'),
    })
    expect(jobPage.pageType).toBe('JOB_DETAIL_PAGE')
    expect(jobPage.capability).toBe('unknown')
    expect(jobPage.applyActionAvailable).toBe(true)
    const afterApply = applicationPreflight({
      url: 'https://jobs.example.com/role',
      applicationUrl: 'https://jobs.example.com/role/apply',
      html: syntheticEmployerHtml('apply', '/test-employer'),
      applyFollowed: true,
    })
    expect(afterApply.pageType).toBe('APPLICATION_PAGE')
    expect(afterApply.applicationDetected).toBe(true)
    expect(afterApply.capability).toBe('auto_apply_supported')
  })

  it('inspects iframe applications instead of marking them unsupported immediately', () => {
    const wrapped = applicationPreflight({
      url: 'https://boards.greenhouse.io/acme/jobs/1',
      html: '<html><body><iframe src="https://boards.greenhouse.io/embed/job_app?for=acme"></iframe></body></html>',
    })
    expect(wrapped.capability).not.toBe('auto_apply_supported')
    expect(wrapped.capability).toBe('unknown')
    const inspected = applicationPreflight({
      url: 'https://boards.greenhouse.io/acme/jobs/1',
      documents: [
        { html: '<iframe src="https://boards.greenhouse.io/embed/job_app?for=acme"></iframe>', url: 'https://boards.greenhouse.io/acme/jobs/1' },
        { html: greenhouseForm, url: 'https://boards.greenhouse.io/embed/job_app?for=acme', inIframe: true },
      ],
    })
    expect(inspected.applicationDetected).toBe(true)
    expect(inspected.capability).toBe('auto_apply_supported')
    expect(inspected.iframeCount).toBeGreaterThan(0)
  })

  it('keeps redirect pages unknown until the destination is reached', () => {
    const redirect = applicationPreflight({
      url: 'https://boards.greenhouse.io/acme/jobs/1',
      html: '<html><head><meta http-equiv="refresh" content="0;url=/apply"></head><body>Redirecting</body></html>',
    })
    expect(redirect.pageType).toBe('REDIRECT_PAGE')
    expect(redirect.capability).toBe('unknown')
  })

  it('classifies CAPTCHA, login, and MFA as blocked with strong evidence only', () => {
    expect(analyzeCaptcha('<p>Please verify your application and complete this security challenge in the iframe.</p>').captcha).toBe(
      false,
    )
    const captcha = applicationPreflight({
      url: 'https://boards.greenhouse.io/acme/jobs/1',
      html: '<iframe src="https://www.google.com/recaptcha/api2/anchor"></iframe><div class="g-recaptcha"></div>',
    })
    expect(captcha.capability).toBe('blocked')
    expect(captcha.pageType).toBe('CAPTCHA_PAGE')
    const login = applicationPreflight({
      url: 'https://boards.greenhouse.io/acme/jobs/1',
      html: '<form>Sign in to continue<input type="password" name="password"></form>',
    })
    expect(login.capability).toBe('blocked')
    expect(login.pageType).toBe('LOGIN_PAGE')
    const mfa = applicationPreflight({
      url: 'https://boards.greenhouse.io/acme/jobs/1',
      html: '<form><p>Enter the authenticator app code</p><input name="otp"></form>',
    })
    expect(mfa.capability).toBe('blocked')
    expect(mfa.pageType).toBe('MFA_PAGE')
  })

  it('uses assisted_apply for unknown required questions and unsupported for unknown providers', () => {
    const unknownQuestion = applicationPreflight({
      url: 'https://boards.greenhouse.io/acme/jobs/1',
      html: `${greenhouseForm}<label>When can you start?</label><input name="start_date" required>`,
    })
    expect(unknownQuestion.capability).toBe('assisted_apply')
    const smart = applicationPreflight({
      url: 'https://jobs.smartrecruiters.com/acme/1',
      html: greenhouseForm,
    })
    expect(smart.capability).toBe('unsupported')
    expect(canEnterAutonomousApply(smart.capability)).toBe(false)
  })

  it('detects application forms from semantic signals rather than a bare form tag', () => {
    const bare = applicationPreflight({
      url: 'https://boards.greenhouse.io/acme/jobs/1',
      html: '<form><input type="text" name="q"></form>',
    })
    expect(bare.capability).not.toBe('auto_apply_supported')
    const semantic = applicationPreflight({
      url: 'https://boards.greenhouse.io/acme/jobs/1',
      html: greenhouseForm,
    })
    expect(semantic.applicationDetected).toBe(true)
    expect(semantic.detectedFields).toEqual(expect.arrayContaining(['email', 'resume']))
    expect(semantic.capability).toBe('auto_apply_supported')
  })

  it('requires a real confirmation before submitted and never treats weak copy as success', () => {
    expect(detectSubmissionConfirmation({ html: '<p>Thank you</p>' }).confirmed).toBe(false)
    expect(detectSubmissionConfirmation({ html: '<p>Review your application</p>' }).confirmed).toBe(false)
    expect(
      detectSubmissionConfirmation({
        html: '<h1>Thank you for applying</h1><p>Confirmation number ABC12345</p>',
      }).confirmed,
    ).toBe(true)
    const counts = recount([
      {
        id: '1',
        runId: 'run',
        jobId: 'filled',
        identityKey: 'filled',
        applicationId: 'app',
        resumeVersionId: 'r',
        resumeVersionName: 'Master',
        title: 'Java',
        company: 'Acme',
        applicationUrl: 'https://jobs.example.com/filled',
        initialMatchScore: 90,
        finalMatchScore: 90,
        c2cStatus: 'confirmed',
        c2cEvidence: [],
        applicationStatus: 'filling',
        failureReason: null,
        questions: [],
        tailoredResumeText: null,
        jobDescriptionSnapshot: null,
        location: null,
        confirmationNumber: null,
        confirmationText: null,
        submittedAt: null,
        masterResumeUnchanged: true,
        sessionId: null,
        createdAt: '2026-09-21T00:00:00.000Z',
        updatedAt: '2026-09-21T00:00:00.000Z',
        applicationCapability: 'auto_apply_supported',
      },
    ])
    expect(counts.submitted).toBe(0)
    expect(counts.autoApplyCapable).toBe(1)
  })

  it('persists capability cache and does not retry the same unsupported application', () => {
    rememberDecision('job-1', 'https://boards.greenhouse.io/acme/jobs/1', applicationPreflight({
      url: 'https://boards.greenhouse.io/acme/jobs/1',
      html: '<html><body><h1>Careers</h1></body></html>',
    }))
    const cached = lookupCapability('job-1', 'https://boards.greenhouse.io/acme/jobs/1')
    expect(cached?.capability).toBe('unsupported')
    expect(APPLY_LIFECYCLE_STATES).toEqual(expect.arrayContaining(['eligible', 'preflight', 'queued', 'submitted', 'skipped']))
  })
})
