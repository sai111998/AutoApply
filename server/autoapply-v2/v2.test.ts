import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readdirSync, readFileSync } from 'node:fs'
import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app'
import { getServerConfig } from '../config'
import { resetCandidateStoreForTests, saveCandidateProfile } from '../application/candidate-store'
import { resetConfirmedApplicationsForTests } from '../apply/confirmed'
import { rememberLiveJobs, resetLiveJobStoreForTests } from '../jobs/live-store'
import type { LiveJob } from '../jobs/list'
import { emptyLiveMatch } from '../jobs/score'
import { useAutomationRuntimeForTests } from '../automation/runtime-io'
import { startV2AutoApply } from './agent'
import { firstValidV2Job, isV2JobAlreadyApplied, loadV2Job, validateV2ApplicationUrl } from './application'
import { classifyV2Page, detectV2Provider } from './agent'
import { detectV2Confirmation } from './confirmation'
import { V2_ERROR_CODES } from './errors'
import { classifyV2Field, mapV2Fields, type V2FieldDescriptor } from './fields'
import { V2_APPLY_LABEL, V2_APPLY_MANUAL_LABEL, V2_NEXT_LABEL, V2_SUBMIT_LABEL } from './navigation'
import { loadV2Profile } from './profile'
import { getV2Run, resetV2QueueForTests } from './queue'
import { loadV2Resume } from './resume'
import { resetV2SessionsForTests } from './session'
import { persistV2Application, processV2QueueOnce, resetV2WorkerForTests } from './worker'

const USER_ID = 'v2-unit-user'

function liveJob(overrides: Partial<LiveJob> = {}): LiveJob {
  return {
    id: 'job-1',
    title: 'Senior Engineer',
    company: 'Acme',
    location: 'Remote',
    remote: true,
    employmentType: 'Full-time',
    seniority: null,
    description: 'Build things.',
    url: 'https://example.com/jobs/1',
    source: 'test',
    sourceJobId: null,
    postedAt: null,
    fetchedAt: new Date().toISOString(),
    provider: 'test',
    providerJobId: null,
    jobUrl: 'https://example.com/jobs/1/apply',
    workArrangement: null,
    discoveredAt: new Date().toISOString(),
    lastVerifiedAt: new Date().toISOString(),
    identityKey: 'live:job-1',
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    rawMetadata: {},
    match: emptyLiveMatch(),
    matchScore: null,
    matchedSkills: [],
    missingSkills: [],
    c2cStatus: 'unknown',
    c2cEvidence: [],
    ...overrides,
  }
}

function seedProfile(overrides: Record<string, unknown> = {}) {
  return saveCandidateProfile({
    userId: USER_ID,
    profile: {
      fullName: 'Ada Lovelace',
      email: 'ada@example.com',
      location: 'Austin, TX',
      yearsOfExperience: 8,
      workAuthorization: 'US Citizen',
      sponsorshipRequired: false,
      preferredWorkArrangement: 'Remote',
      targetSalaryMin: null,
      targetSalaryMax: null,
      phone: '555-0100',
      linkedin: 'https://linkedin.com/in/ada',
      github: 'https://github.com/ada',
      ...overrides,
    },
    resumeText: 'Ada Lovelace resume text',
    resumeVersionId: 'resume-v1',
  })
}

function descriptor(overrides: Partial<V2FieldDescriptor> = {}): V2FieldDescriptor {
  return {
    frameIndex: 0,
    index: 0,
    tagIndex: 0,
    tag: 'input',
    type: 'text',
    name: '',
    label: '',
    placeholder: '',
    value: '',
    checked: false,
    required: false,
    options: [],
    ...overrides,
  }
}

beforeEach(() => {
  useAutomationRuntimeForTests(mkdtempSync(join(tmpdir(), 'jobpilot-v2-')))
  resetCandidateStoreForTests()
  resetLiveJobStoreForTests()
  resetConfirmedApplicationsForTests()
  resetV2QueueForTests()
  resetV2SessionsForTests()
  resetV2WorkerForTests()
})

describe('V2 job selection', () => {
  it('selects the first job with valid title/company/url that is not applied', () => {
    rememberLiveJobs([
      liveJob({ id: 'bad-title', title: '  ', jobUrl: 'https://example.com/a' }),
      liveJob({ id: 'bad-url', jobUrl: 'javascript:alert(1)', url: null }),
      liveJob({ id: 'good-1', title: 'Engineer I', jobUrl: 'https://example.com/good-1' }),
      liveJob({ id: 'good-2', title: 'Engineer II', jobUrl: 'https://example.com/good-2' }),
    ])
    const picked = firstValidV2Job(USER_ID, [
      { id: 'bad-title', title: '  ', company: 'Acme', applicationUrl: 'https://example.com/a' },
      { id: 'bad-url', title: 'T', company: 'Acme', applicationUrl: 'javascript:alert(1)' },
      { id: 'good-1', title: 'Engineer I', company: 'Acme', applicationUrl: 'https://example.com/good-1' },
      { id: 'good-2', title: 'Engineer II', company: 'Acme', applicationUrl: 'https://example.com/good-2' },
    ])
    expect(picked?.id).toBe('good-1')
  })

  it('loads one existing live job and resolves jobUrl over url', () => {
    rememberLiveJobs([liveJob({ id: 'job-9', jobUrl: 'https://example.com/apply-9', url: 'https://example.com/job-9' })])
    const job = loadV2Job(USER_ID, 'job-9')
    expect(job.applicationUrl).toBe('https://example.com/apply-9')
  })
})

describe('V2 URL validation', () => {
  it.each(['javascript:alert(1)', 'chrome://settings', 'file:///etc/passwd', 'http://localhost:9999/job'])(
    'rejects %s',
    (url) => {
      try {
        validateV2ApplicationUrl(url)
        expect.unreachable('expected INVALID_APPLICATION_URL')
      } catch (error) {
        expect((error as { code?: string }).code).toBe('INVALID_APPLICATION_URL')
      }
    },
  )

  it('accepts the synthetic localhost employer URL', () => {
    expect(() => validateV2ApplicationUrl('http://127.0.0.1:9999/test-employer/job/1')).not.toThrow()
  })
})

describe('V2 profile and resume', () => {
  it('loads the canonical profile and reports readiness', async () => {
    seedProfile()
    const loaded = await loadV2Profile(USER_ID)
    expect(loaded.profileReady).toBe(true)
    expect(loaded.profile.firstName).toBe('Ada')
    expect(loaded.profile.lastName).toBe('Lovelace')
  })

  it('reports missing required fields without inventing values', async () => {
    seedProfile({ fullName: 'Ada', phone: '' })
    const loaded = await loadV2Profile(USER_ID)
    expect(loaded.profileReady).toBe(false)
    expect(loaded.missing).toEqual(expect.arrayContaining(['lastName', 'phone']))
    expect(loaded.profile.lastName).toBe('')
  })

  it('loads the completed default resume', async () => {
    seedProfile()
    const resume = await loadV2Resume(USER_ID)
    expect(resume.versionId).toBe('resume-v1')
    expect(resume.buffer.length).toBeGreaterThan(0)
  })

  it('rejects a missing resume', async () => {
    saveCandidateProfile({
      userId: USER_ID,
      profile: {
        fullName: 'Ada Lovelace',
        email: 'ada@example.com',
        location: 'Austin, TX',
        yearsOfExperience: 8,
        workAuthorization: null,
        sponsorshipRequired: false,
        preferredWorkArrangement: null,
        targetSalaryMin: null,
        targetSalaryMax: null,
      },
      resumeText: null,
      resumeVersionId: null,
    })
    await expect(loadV2Resume(USER_ID)).rejects.toMatchObject({ code: 'RESUME_NOT_FOUND' })
  })
})

describe('V2 queue and start', () => {
  it('creates exactly one queued run and refuses a second active run', async () => {
    seedProfile()
    rememberLiveJobs([liveJob({ id: 'job-1' }), liveJob({ id: 'job-2', jobUrl: 'https://example.com/apply-2' })])
    const first = await startV2AutoApply({ userId: USER_ID, jobId: 'job-1' })
    expect(first.status).toBe('queued')
    expect(getV2Run(first.runId)?.jobId).toBe('job-1')
    await expect(startV2AutoApply({ userId: USER_ID, jobId: 'job-2' })).rejects.toMatchObject({
      code: 'WORKER_BUSY',
    })
  })

  it('never picks up non-queued runs for processing (no retry)', async () => {
    seedProfile()
    rememberLiveJobs([liveJob({ id: 'job-1' })])
    const started = await startV2AutoApply({ userId: USER_ID, jobId: 'job-1' })
    const { updateV2Run } = await import('./queue')
    updateV2Run(started.runId, { status: 'submission_uncertain' })
    await expect(processV2QueueOnce()).resolves.toBeNull()
    expect(getV2Run(started.runId)?.status).toBe('submission_uncertain')
  })
})

describe('V2 control labels', () => {
  it('matches legitimate Apply/Next/Submit controls only', () => {
    for (const label of ['Apply', 'Apply Now', 'Apply to Job', 'Start Application']) {
      expect(label).toMatch(V2_APPLY_LABEL)
    }
    for (const label of ['Sign in', 'Learn more', 'Save job', 'Apply with LinkedIn now']) {
      expect(label).not.toMatch(V2_APPLY_LABEL)
    }
    expect('Next').toMatch(V2_NEXT_LABEL)
    expect('Continue').toMatch(V2_NEXT_LABEL)
    expect('Continue shopping').not.toMatch(V2_NEXT_LABEL)
    for (const label of ['Submit Application', 'Submit', 'Finish', 'Complete Application']) {
      expect(label).toMatch(V2_SUBMIT_LABEL)
    }
    expect('Submit resume for review').not.toMatch(V2_SUBMIT_LABEL)
    expect('Apply Manually').toMatch(V2_APPLY_MANUAL_LABEL)
    expect('Apply with resume').not.toMatch(V2_APPLY_MANUAL_LABEL)
  })
})

describe('V2 semantic field mapping', () => {
  it('classifies standard identity/contact fields', () => {
    expect(classifyV2Field(descriptor({ label: 'First Name *' }))).toBe('firstName')
    expect(classifyV2Field(descriptor({ label: 'Last Name', type: 'text' }))).toBe('lastName')
    expect(classifyV2Field(descriptor({ label: 'Email', type: 'email' }))).toBe('email')
    expect(classifyV2Field(descriptor({ placeholder: 'Phone', type: 'tel' }))).toBe('phone')
    expect(classifyV2Field(descriptor({ label: 'Upload Resume', type: 'file' }))).toBe('resume')
    expect(classifyV2Field(descriptor({ label: 'Favorite color' }))).toBeNull()
  })

  it('flags unknown required fields and leaves satisfied selects alone', async () => {
    seedProfile()
    const { profile } = await loadV2Profile(USER_ID)
    const mapping = mapV2Fields(
      [
        descriptor({ label: 'First Name *', required: true }),
        descriptor({ label: 'Favorite color *', required: true }),
        descriptor({ tag: 'select', label: 'Veteran status', value: 'no-answer', options: ['Prefer not to answer'] }),
      ],
      profile,
    )
    expect(mapping.mapped.map((entry) => entry.key)).toContain('firstName')
    expect(mapping.unknownRequired.map((field) => field.label)).toEqual(['Favorite color *'])
  })
})

describe('V2 page classification', () => {
  const snapshot = (bodyText: string, html = '<html></html>') => ({
    url: 'https://example.com/apply',
    title: 'Apply',
    html,
    bodyText,
  })

  it('detects login, captcha, mfa, application, job, and unknown pages', () => {
    expect(
      classifyV2Page({
        snapshot: snapshot('Sign in to continue Password'),
        hasPasswordField: true,
        hasApplyControl: false,
        fieldCount: 2,
        hasFileInput: false,
      }),
    ).toBe('LOGIN_PAGE')
    expect(
      classifyV2Page({
        snapshot: snapshot('Verify you are human', '<div class="g-recaptcha"></div>'),
        hasPasswordField: false,
        hasApplyControl: false,
        fieldCount: 0,
        hasFileInput: false,
      }),
    ).toBe('CAPTCHA_PAGE')
    expect(
      classifyV2Page({
        snapshot: snapshot('Enter the verification code from your authenticator app'),
        hasPasswordField: false,
        hasApplyControl: false,
        fieldCount: 1,
        hasFileInput: false,
      }),
    ).toBe('MFA_PAGE')
    expect(
      classifyV2Page({
        snapshot: snapshot('First Name Last Name Email'),
        hasPasswordField: false,
        hasApplyControl: false,
        fieldCount: 3,
        hasFileInput: false,
      }),
    ).toBe('APPLICATION_PAGE')
    expect(
      classifyV2Page({
        snapshot: snapshot('Senior Engineer responsibilities qualifications'),
        hasPasswordField: false,
        hasApplyControl: true,
        fieldCount: 0,
        hasFileInput: false,
      }),
    ).toBe('JOB_PAGE')
    expect(
      classifyV2Page({
        snapshot: snapshot('Welcome to our site'),
        hasPasswordField: false,
        hasApplyControl: false,
        fieldCount: 0,
        hasFileInput: false,
      }),
    ).toBe('UNKNOWN')
  })

  it('detects providers from URL evidence only', () => {
    expect(detectV2Provider('https://acme.myworkdayjobs.com/job/1', '')).toBe('workday')
    expect(detectV2Provider('https://boards.greenhouse.io/acme/jobs/1', '')).toBe('greenhouse')
    expect(detectV2Provider('https://example.com/apply', '')).toBe('generic')
  })
})

describe('V2 confirmation', () => {
  it('confirms on strong phrases and confirmation numbers', () => {
    expect(
      detectV2Confirmation({ title: 'Done', bodyText: 'Your application has been received.', url: 'https://x/y' })
        .confirmed,
    ).toBe(true)
    expect(
      detectV2Confirmation({
        title: 'Done',
        bodyText: 'Thanks! Confirmation number: ABC-12345 for your submission.',
        url: 'https://x/y',
      }),
    ).toMatchObject({ confirmed: true, confirmationNumber: 'ABC-12345' })
  })

  it('rejects weak thank-you and generic loads', () => {
    expect(
      detectV2Confirmation({ title: 'Thanks', bodyText: 'Thank you for visiting.', url: 'https://x/y' }).confirmed,
    ).toBe(false)
    expect(detectV2Confirmation({ title: 'Home', bodyText: 'Welcome back.', url: 'https://x/y' }).confirmed).toBe(false)
  })
})

describe('V2 error model', () => {
  it('keeps explicit error codes', () => {
    for (const code of [
      'INVALID_APPLICATION_URL',
      'APPLICATION_PAGE_NOT_FOUND',
      'FORM_NOT_FOUND',
      'LOGIN_REQUIRED',
      'MFA_REQUIRED',
      'CAPTCHA_REQUIRED',
      'UNKNOWN_REQUIRED_FIELD',
      'RESUME_UPLOAD_FAILED',
      'NAVIGATION_TIMEOUT',
      'SUBMISSION_FAILED',
      'SUBMISSION_UNCERTAIN',
      'PROFILE_INCOMPLETE',
    ]) {
      expect(V2_ERROR_CODES).toContain(code)
    }
  })
})

describe('V2 persistence rules', () => {
  it('persists only submitted runs and blocks duplicates afterwards', async () => {
    seedProfile()
    rememberLiveJobs([liveJob({ id: 'job-1' })])
    const started = await startV2AutoApply({ userId: USER_ID, jobId: 'job-1' })
    const queued = getV2Run(started.runId)
    expect(queued).not.toBeNull()
    expect(await persistV2Application(queued!)).toBeNull()
    const { updateV2Run } = await import('./queue')
    updateV2Run(started.runId, {
      status: 'submitted',
      finalUrl: 'https://example.com/apply-1/done',
      confirmationNumber: 'ABC-1',
      submittedAt: new Date().toISOString(),
    })
    const record = await persistV2Application(getV2Run(started.runId)!)
    expect(record?.status).toBe('applied')
    expect(record?.submittedResumeVersionId).toBe('resume-v1')
    expect(isV2JobAlreadyApplied(USER_ID, { id: 'job-1', applicationUrl: 'https://example.com/jobs/1/apply' })).toBe(true)
  })
})

describe('V2 isolation', () => {
  it('never imports match, C2C, tailoring, or the old execution flow', () => {
    const directory = join(process.cwd(), 'server', 'autoapply-v2')
    const files = readdirSync(directory).filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    expect(files.length).toBeGreaterThan(10)
    const forbiddenModules = [
      '/match',
      'match/',
      'c2c',
      'tailor',
      'browser-worker',
      '../agent',
      'agent/smoke',
      'agent/campaign',
      'apply/engine',
      'apply/eligibility',
      'apply/live',
      'apply/surface',
      'apply/detect',
      'apply/confirm',
      'apply/validate',
      'apply/capability',
      'jobs/discover',
      'jobs/list',
      'jobs/preview',
      'jobs/provider',
      'jobs/score',
    ]
    const forbiddenCalls = [
      'tailorResume',
      'scoreJob',
      'classifyC2c',
      'prepareQueueItem',
      'queueDirectSmokeTest',
      'startCampaign',
      'startExecutionCampaign',
      'discoverJobs',
      'listLiveJobs',
    ]
    const allowedApplyImports = ["'../apply/confirmed'", "'../apply/types'", '"../apply/confirmed"', '"../apply/types"']
    for (const file of files) {
      const source = readFileSync(join(directory, file), 'utf8')
      const importLines = source
        .split('\n')
        .filter((line) => /^\s*(import|export)[^'"]*from\s+['"]/.test(line))
        .filter((line) => !allowedApplyImports.some((allowed) => line.includes(allowed)))
      for (const line of importLines) {
        for (const needle of forbiddenModules) {
          expect(line.includes(needle) ? `${file} imports forbidden module: ${line.trim()}` : '').toBe('')
        }
      }
      for (const needle of forbiddenCalls) {
        expect(source.includes(needle) ? `${file} calls forbidden function: ${needle}` : '').toBe('')
      }
    }
  })
})

describe('V2 HTTP endpoints', () => {
  it('exposes health without secrets', async () => {
    const app = createApp({ config: getServerConfig() })
    const response = await request(app).get('/api/autoapply-v2/health')
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      agentRunning: expect.any(Boolean),
      workerRunning: expect.any(Boolean),
      browserAvailable: expect.any(Boolean),
      queueDepth: expect.any(Number),
      currentState: expect.any(String),
    })
    expect(JSON.stringify(response.body)).not.toMatch(/key|secret|token/i)
  })

  it('validates start requests and returns immediately with queued', async () => {
    const app = createApp({ config: getServerConfig() })
    await request(app).post('/api/autoapply-v2/start').send({ jobId: 'job-1' }).expect(401)
    await request(app)
      .post('/api/autoapply-v2/start')
      .set('x-jobpilot-user-id', USER_ID)
      .send({})
      .expect(400)
    await request(app)
      .post('/api/autoapply-v2/start')
      .set('x-jobpilot-user-id', USER_ID)
      .send({ jobId: 'missing' })
      .expect(404)

    seedProfile({ fullName: 'Ada', phone: '' })
    rememberLiveJobs([liveJob({ id: 'job-1' })])
    await request(app)
      .post('/api/autoapply-v2/start')
      .set('x-jobpilot-user-id', USER_ID)
      .send({ jobId: 'job-1' })
      .expect(422)

    seedProfile()
    const response = await request(app)
      .post('/api/autoapply-v2/start')
      .set('x-jobpilot-user-id', USER_ID)
      .send({ jobId: 'job-1' })
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ success: true, status: 'queued', runId: expect.any(String) })
  })
})
