import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../app'
import { getServerConfig } from '../config'
import { resetConfirmedApplicationsForTests } from '../apply/confirmed'
import { clearAutoApplyMemory, memoryStore } from '../apply/store'
import type { AutoApplyProfile, AutoApplyQueueItem, AutoApplyRun } from '../apply/types'
import { rememberLiveJobs, resetLiveJobStoreForTests } from '../jobs/live-store'
import type { LiveJob } from '../jobs/list'
import { emptyLiveMatch } from '../jobs/score'
import { useAutomationRuntimeForTests } from '../automation/runtime-io'
import { fakeSessionToken, installFakeSupabase, uninstallFakeSupabase } from '../testing/fake-supabase'
import { classifyV2Page, detectV2Provider } from './agent'
import { firstValidV2Job, isV2JobAlreadyApplied, loadV2Job, validateV2ApplicationUrl } from './application'
import { startV2AutoApply, startV2AutoApplyCampaign, toAutoApplyRunResult, V2_START_ONE_CONFIG } from './campaign'
import { detectV2Confirmation } from './confirmation'
import { V2_ERROR_CODES } from './errors'
import { classifyV2Field, mapV2Fields, type V2FieldDescriptor } from './fields'
import { V2_APPLY_LABEL, V2_APPLY_MANUAL_LABEL, V2_NEXT_LABEL, V2_SUBMIT_LABEL } from './navigation'
import { loadV2Profile, requireV2Profile } from './profile'
import { cancelV2Run, getV2Run, resetV2QueueForTests, updateV2Run } from './queue'
import { loadV2Resume } from './resume'
import { resetV2SessionsForTests } from './session'
import { persistV2Application, processV2QueueOnce, resetV2WorkerForTests } from './worker'

const USER_ID = '33333333-3333-4333-8333-333333333333'
const OTHER_USER_ID = '55555555-5555-4555-8555-555555555555'
const RESUME_ID = '44444444-4444-4444-8444-444444444444'
const RESUME_PATH = `${USER_ID}/${RESUME_ID}/Master_Resume.pdf`
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
    fetchedAt: '2026-09-25T00:00:00.000Z',
    provider: 'test',
    providerJobId: null,
    jobUrl: 'https://example.com/jobs/1/apply',
    workArrangement: null,
    discoveredAt: '2026-09-25T00:00:00.000Z',
    lastVerifiedAt: '2026-09-25T00:00:00.000Z',
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

function profileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: USER_ID,
    full_name: 'Ada Lovelace',
    first_name: 'Ada',
    last_name: 'Lovelace',
    email: 'ada@example.com',
    phone: '555-0100',
    location: 'Austin, TX',
    work_authorization: 'us_citizen',
    sponsorship_required: false,
    ...overrides,
  }
}

function resumeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: RESUME_ID,
    user_id: USER_ID,
    file_name: 'Master_Resume.pdf',
    file_type: 'application/pdf',
    version_label: 'Master',
    is_master: true,
    storage_path: RESUME_PATH,
    parsed_text: 'Ada Lovelace resume text',
    created_at: '2026-09-01T00:00:00.000Z',
    ...overrides,
  }
}

function seedAccount(
  options: {
    profile?: Record<string, unknown> | null
    resume?: Record<string, unknown> | null
    file?: boolean
    failures?: { profiles?: number }
    serviceRoleKey?: string | null
  } = {},
) {
  return installFakeSupabase(
    {
      users: [{ id: USER_ID }, { id: OTHER_USER_ID }],
      profiles: options.profile === null ? [] : [profileRow(options.profile ?? {})],
      resumes: options.resume === null ? [] : [resumeRow(options.resume ?? {})],
      files:
        options.file === false
          ? {}
          : { [`resumes/${RESUME_PATH}`]: { body: Buffer.from('%PDF-1.4 master resume bytes'), contentType: 'application/pdf' } },
      failures: options.failures,
    },
    { serviceRoleKey: options.serviceRoleKey },
  )
}

const bearer = (userId = USER_ID) => `Bearer ${fakeSessionToken(userId)}`

const startProfile: AutoApplyProfile = {
  fullName: 'Ada',
  email: 'ada@example.com',
  location: 'Austin, TX',
  yearsOfExperience: 8,
  workAuthorization: null,
  sponsorshipRequired: false,
  preferredWorkArrangement: null,
  targetSalaryMin: null,
  targetSalaryMax: null,
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
  resetLiveJobStoreForTests()
  resetConfirmedApplicationsForTests()
  resetV2QueueForTests()
  resetV2SessionsForTests()
  resetV2WorkerForTests()
  clearAutoApplyMemory()
})

afterEach(() => {
  uninstallFakeSupabase()
})

describe('V2 job selection', () => {
  it('selects the first job with an id, title, company, description, and valid URL that is not applied', () => {
    const picked = firstValidV2Job(USER_ID, [
      { id: 'bad-title', title: '  ', company: 'Acme', description: 'JD', applicationUrl: 'https://example.com/a' },
      { id: 'no-description', title: 'T', company: 'Acme', description: ' ', applicationUrl: 'https://example.com/b' },
      { id: 'bad-url', title: 'T', company: 'Acme', description: 'JD', applicationUrl: 'javascript:alert(1)' },
      { id: 'synthetic', title: 'T', company: 'Test Employer', description: 'JD', applicationUrl: 'http://127.0.0.1:8787/test-employer/job/1' },
      { id: 'good-1', title: 'Engineer I', company: 'Acme', description: 'JD', applicationUrl: 'https://example.com/good-1' },
      { id: 'good-2', title: 'Engineer II', company: 'Acme', description: 'JD', applicationUrl: 'https://example.com/good-2' },
    ])
    expect(picked?.id).toBe('good-1')
  })

  it('loads one existing live job and resolves jobUrl over url', () => {
    rememberLiveJobs([liveJob({ id: 'job-9', jobUrl: 'https://example.com/apply-9', url: 'https://example.com/job-9' })])
    const job = loadV2Job(USER_ID, 'job-9')
    expect(job.applicationUrl).toBe('https://example.com/apply-9')
  })

  it('skips and rejects jobs with a submitted or possibly submitted V2 run', async () => {
    seedAccount()
    rememberLiveJobs([liveJob({ id: 'job-1' })])
    const started = await startV2AutoApply({ userId: USER_ID, jobId: 'job-1' })
    updateV2Run(started.runId, { status: 'submission_uncertain' })
    expect(firstValidV2Job(USER_ID, [{ id: 'job-1', title: 'T', company: 'Acme', description: 'JD', applicationUrl: 'https://example.com/other' }])).toBeNull()
    expect(() => loadV2Job(USER_ID, 'job-1')).toThrow(expect.objectContaining({ code: 'ALREADY_APPLIED' }))
  })
})

describe('V2 URL validation', () => {
  it.each(['javascript:alert(1)', 'chrome://settings', 'file:///etc/passwd', 'http://localhost:9999/job'])(
    'rejects %s',
    (url) => {
      expect(() => validateV2ApplicationUrl(url)).toThrow(expect.objectContaining({ code: 'INVALID_APPLICATION_URL' }))
    },
  )

  it('accepts the synthetic localhost employer URL only when a test explicitly allows it', () => {
    const url = 'http://127.0.0.1:9999/test-employer/job/1'
    expect(() => validateV2ApplicationUrl(url)).toThrow(expect.objectContaining({ code: 'INVALID_APPLICATION_URL' }))
    expect(() => validateV2ApplicationUrl(url, { allowSyntheticEmployer: true })).not.toThrow()
  })
})

describe('V2 profile precheck', () => {
  it('loads the canonical profile from public.profiles', async () => {
    seedAccount()
    const loaded = await loadV2Profile(USER_ID)
    expect(loaded.profileReady).toBe(true)
    expect(loaded.profile).toMatchObject({ firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', phone: '555-0100' })
  })

  it('returns PROFILE_INCOMPLETE with camelCase missingFields and no invented values', async () => {
    seedAccount({ profile: { first_name: null, last_name: null, full_name: 'Ada', phone: null } })
    const loaded = await loadV2Profile(USER_ID)
    expect(loaded.profileReady).toBe(false)
    expect(loaded.missing).toEqual(['lastName', 'phone'])
    expect(loaded.profile?.lastName).toBe('')
    await expect(requireV2Profile(USER_ID)).rejects.toMatchObject({
      code: 'PROFILE_INCOMPLETE',
      missingFields: ['lastName', 'phone'],
    })
  })

  it('keeps missing server config, missing rows, and failed queries distinct from an incomplete profile', async () => {
    await expect(requireV2Profile(USER_ID)).rejects.toMatchObject({ code: 'SUPABASE_NOT_CONFIGURED' })
    seedAccount({ profile: null })
    await expect(requireV2Profile(USER_ID)).rejects.toMatchObject({ code: 'PROFILE_NOT_FOUND' })
    uninstallFakeSupabase()
    seedAccount({ failures: { profiles: 500 } })
    await expect(requireV2Profile(USER_ID)).rejects.toMatchObject({ code: 'PROFILE_DATABASE_ERROR' })
  })
})

describe('V2 resume', () => {
  it('downloads the master resume file from Supabase storage without tailoring it', async () => {
    seedAccount()
    const resume = await loadV2Resume(USER_ID)
    expect(resume).toMatchObject({
      versionId: RESUME_ID,
      versionName: 'Master',
      fileName: 'Master_Resume.pdf',
      mimeType: 'application/pdf',
      text: 'Ada Lovelace resume text',
    })
    expect(resume.buffer.toString()).toBe('%PDF-1.4 master resume bytes')
  })

  it('loads the resume the user selected', async () => {
    seedAccount()
    expect((await loadV2Resume(USER_ID, RESUME_ID)).versionId).toBe(RESUME_ID)
    await expect(loadV2Resume(USER_ID, '55555555-5555-4555-8555-555555555555')).rejects.toMatchObject({ code: 'RESUME_NOT_FOUND' })
  })

  it('rejects a resume without a stored file, a failed download, and a server without storage', async () => {
    seedAccount({ resume: { storage_path: null } })
    await expect(loadV2Resume(USER_ID)).rejects.toMatchObject({ code: 'RESUME_NOT_FOUND' })
    uninstallFakeSupabase()
    seedAccount({ file: false })
    await expect(loadV2Resume(USER_ID)).rejects.toMatchObject({ code: 'RESUME_NOT_FOUND' })
    uninstallFakeSupabase()
    await expect(loadV2Resume(USER_ID)).rejects.toMatchObject({ code: 'RESUME_NOT_FOUND' })
  })
})

describe('V2 queue', () => {
  it('creates exactly one queued run and refuses a second active run', async () => {
    seedAccount()
    rememberLiveJobs([liveJob({ id: 'job-1' }), liveJob({ id: 'job-2', jobUrl: 'https://example.com/apply-2' })])
    const first = await startV2AutoApply({ userId: USER_ID, jobId: 'job-1' })
    expect(first.status).toBe('queued')
    expect(getV2Run(first.runId)).toMatchObject({ jobId: 'job-1', source: 'start-one', resumeVersionId: RESUME_ID })
    await expect(startV2AutoApply({ userId: USER_ID, jobId: 'job-2' })).rejects.toMatchObject({ code: 'WORKER_BUSY' })
  })

  it('does not queue when the profile is incomplete', async () => {
    seedAccount({ profile: { phone: null } })
    rememberLiveJobs([liveJob({ id: 'job-1' })])
    await expect(startV2AutoApply({ userId: USER_ID, jobId: 'job-1' })).rejects.toMatchObject({
      code: 'PROFILE_INCOMPLETE',
      missingFields: ['phone'],
    })
    await expect(processV2QueueOnce()).resolves.toBeNull()
  })

  it('never picks up non-queued runs for processing (no retry)', async () => {
    seedAccount()
    rememberLiveJobs([liveJob({ id: 'job-1' })])
    const started = await startV2AutoApply({ userId: USER_ID, jobId: 'job-1' })
    updateV2Run(started.runId, { status: 'submission_uncertain' })
    await expect(processV2QueueOnce()).resolves.toBeNull()
    expect(getV2Run(started.runId)?.status).toBe('submission_uncertain')
  })

  it('cancels queued and stopped runs but not runs in progress or submitted', async () => {
    seedAccount()
    rememberLiveJobs([liveJob({ id: 'job-1' })])
    const started = await startV2AutoApply({ userId: USER_ID, jobId: 'job-1' })
    updateV2Run(started.runId, { status: 'filling' })
    expect(() => cancelV2Run(started.runId)).toThrow(expect.objectContaining({ code: 'RUN_IN_PROGRESS' }))
    updateV2Run(started.runId, { status: 'submitted' })
    expect(cancelV2Run(started.runId).status).toBe('submitted')
    updateV2Run(started.runId, { status: 'needs_user_input' })
    expect(cancelV2Run(started.runId).status).toBe('cancelled')
  })
})

describe('V2 production Start Auto Apply', () => {
  const uiConfig = { ...V2_START_ONE_CONFIG, maxJobs: 5, minimumMatchRate: 70, autoTailorResume: true }

  it('keeps the UI config and queues the first real live job instead of the synthetic Test Employer', async () => {
    seedAccount()
    rememberLiveJobs([
      liveJob({
        id: 'synthetic-test-employer',
        title: 'Full Stack Java Developer',
        company: 'Test Employer',
        provider: 'synthetic',
        source: 'synthetic',
        jobUrl: 'http://127.0.0.1:8787/test-employer',
        url: null,
      }),
      liveJob({ id: 'no-description', description: null, jobUrl: 'https://example.com/jobs/nodesc' }),
      liveJob({ id: 'real-1', title: 'Backend Engineer', company: 'Globex', jobUrl: 'https://jobs.example.com/real-1/apply' }),
    ])
    const started = await startV2AutoApplyCampaign({
      userId: USER_ID,
      resumeId: RESUME_ID,
      resumeVersionId: RESUME_ID,
      resumeText: 'resume',
      masterResumeText: 'resume',
      profile: startProfile,
      config: uiConfig,
    })
    expect(started.status).toBe('running')
    expect(started.run.config).toEqual(uiConfig)
    expect(started.run.status).toBe('running')
    expect(started.items).toHaveLength(1)
    expect(started.items[0]).toMatchObject({
      jobId: 'real-1',
      title: 'Backend Engineer',
      company: 'Globex',
      applicationStatus: 'queued',
      initialMatchScore: null,
      finalMatchScore: null,
      resumeVersionId: RESUME_ID,
    })
    expect(getV2Run(started.campaignId)?.source).toBe('auto-apply')
  })

  it('refuses to start without a complete profile or any real live job', async () => {
    seedAccount({ profile: { last_name: null, full_name: 'Ada' } })
    rememberLiveJobs([liveJob({ id: 'real-1' })])
    const input = { userId: USER_ID, resumeId: null, resumeVersionId: null, resumeText: 'r', masterResumeText: 'r', profile: startProfile, config: uiConfig }
    await expect(startV2AutoApplyCampaign(input)).rejects.toMatchObject({ code: 'PROFILE_INCOMPLETE', missingFields: ['lastName'] })
    uninstallFakeSupabase()
    useAutomationRuntimeForTests(mkdtempSync(join(tmpdir(), 'jobpilot-v2-empty-')))
    resetLiveJobStoreForTests()
    seedAccount()
    await expect(startV2AutoApplyCampaign(input)).rejects.toMatchObject({ code: 'JOB_NOT_FOUND' })
  })

  it('maps V2 states onto the existing Auto Apply panel statuses', async () => {
    seedAccount()
    rememberLiveJobs([liveJob({ id: 'job-1' })])
    const { runId } = await startV2AutoApply({ userId: USER_ID, jobId: 'job-1' })
    const cases: Array<[string, string, string]> = [
      ['queued', 'running', 'queued'],
      ['filling', 'running', 'filling'],
      ['needs_user_input', 'needs_attention', 'needs_user_input'],
      ['login_required', 'needs_attention', 'login_required'],
      ['captcha_required', 'needs_attention', 'captcha_required'],
      ['submission_uncertain', 'needs_attention', 'submission_uncertain'],
      ['failed', 'failed', 'failed'],
      ['cancelled', 'cancelled', 'cancelled'],
      ['submitted', 'completed', 'submitted'],
    ]
    for (const [v2Status, runStatus, itemStatus] of cases) {
      const mapped = toAutoApplyRunResult(updateV2Run(runId, { status: v2Status as never })!)
      expect([mapped.run.status, mapped.items[0].applicationStatus]).toEqual([runStatus, itemStatus])
    }
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

  it('maps the canonical profile and flags unknown required fields', async () => {
    seedAccount()
    const profile = await requireV2Profile(USER_ID)
    const mapping = mapV2Fields(
      [
        descriptor({ label: 'First Name *', required: true }),
        descriptor({ label: 'Last Name *', required: true }),
        descriptor({ label: 'Phone *', type: 'tel', required: true }),
        descriptor({ label: 'Favorite color *', required: true }),
        descriptor({ tag: 'select', label: 'Veteran status', value: 'no-answer', options: ['Prefer not to answer'] }),
      ],
      profile,
    )
    expect(Object.fromEntries(mapping.mapped.map((entry) => [entry.key, entry.value]))).toEqual({
      firstName: 'Ada',
      lastName: 'Lovelace',
      phone: '555-0100',
    })
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
  const classify = (bodyText: string, extra: Partial<Parameters<typeof classifyV2Page>[0]> = {}, html?: string) =>
    classifyV2Page({ snapshot: snapshot(bodyText, html), hasPasswordField: false, hasApplyControl: false, fieldCount: 0, hasFileInput: false, ...extra })

  it('detects login, captcha, mfa, application, job, error, and unknown pages', () => {
    expect(classify('Sign in to continue Password', { hasPasswordField: true, fieldCount: 2 })).toBe('LOGIN_PAGE')
    expect(classify('Verify you are human', {}, '<div class="g-recaptcha"></div>')).toBe('CAPTCHA_PAGE')
    expect(classify('Enter the verification code from your authenticator app', { fieldCount: 1 })).toBe('MFA_PAGE')
    expect(classify('First Name Last Name Email', { fieldCount: 3 })).toBe('APPLICATION_PAGE')
    expect(classify('Senior Engineer responsibilities qualifications', { hasApplyControl: true })).toBe('JOB_PAGE')
    expect(classify('404 page not found')).toBe('ERROR_PAGE')
    expect(classify('Welcome to our site')).toBe('UNKNOWN')
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
      detectV2Confirmation({ title: 'Done', bodyText: 'Your application has been received.', url: 'https://x/y' }).confirmed,
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
    expect(detectV2Confirmation({ title: 'Thanks', bodyText: 'Thank you for visiting.', url: 'https://x/y' }).confirmed).toBe(false)
    expect(detectV2Confirmation({ title: 'Home', bodyText: 'Welcome back.', url: 'https://x/y' }).confirmed).toBe(false)
  })
})

describe('V2 error model', () => {
  it('keeps explicit error codes', () => {
    for (const code of [
      'INVALID_APPLICATION_URL',
      'APPLICATION_NOT_REACHABLE',
      'APPLICATION_UNSUPPORTED',
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
  it('persists only confirmed submissions with both URLs, no scores, and the submitted resume snapshot', async () => {
    const { writes } = seedAccount()
    rememberLiveJobs([liveJob({ id: 'job-1' })])
    const started = await startV2AutoApply({ userId: USER_ID, jobId: 'job-1' })
    const resume = await loadV2Resume(USER_ID, RESUME_ID)
    expect(await persistV2Application(getV2Run(started.runId)!, resume)).toBeNull()
    expect(writes.filter((write) => write.table === 'applications')).toHaveLength(0)

    updateV2Run(started.runId, {
      status: 'submitted',
      finalUrl: 'https://example.com/jobs/1/apply/done',
      confirmationNumber: 'ABC-12345',
      submittedAt: '2026-09-25T12:00:00.000Z',
    })
    const record = await persistV2Application(getV2Run(started.runId)!, resume)
    expect(record).toMatchObject({
      status: 'applied',
      jobTitle: 'Senior Engineer',
      company: 'Acme',
      applicationUrl: 'https://example.com/jobs/1/apply',
      finalUrl: 'https://example.com/jobs/1/apply/done',
      originalMatchScore: null,
      currentMatchScore: null,
      tailoredMatchScore: null,
      confirmationNumber: 'ABC-12345',
      submittedJobDescriptionSnapshot: 'Build things.',
      submittedAt: '2026-09-25T12:00:00.000Z',
    })
    expect(record?.submittedResumeVersionId).toMatch(UUID)
    expect(writes.find((write) => write.table === 'applications')?.body).toMatchObject({
      application_url: 'https://example.com/jobs/1/apply/done',
      selected_resume_version_id: record?.submittedResumeVersionId,
      current_match_score: null,
      is_confirmed_submission: true,
      confirmation_number: 'ABC-12345',
    })
    expect(writes.find((write) => write.table === 'resume_versions')?.body).toMatchObject({
      id: record?.submittedResumeVersionId,
      source_resume_id: RESUME_ID,
    })
    expect(isV2JobAlreadyApplied(USER_ID, { id: 'job-1', applicationUrl: 'https://example.com/jobs/1/apply' })).toBe(true)

    const forUi = toAutoApplyRunResult(getV2Run(started.runId)!)
    expect(forUi.items[0]).toMatchObject({
      applicationId: record?.applicationId,
      jobId: record?.jobId,
      resumeVersionId: record?.submittedResumeVersionId,
      applicationStatus: 'submitted',
      tailoredResumeText: 'Ada Lovelace resume text',
    })
  })
})

describe('V2 isolation', () => {
  it('never imports match, C2C, tailoring, discovery, or the old execution flow', () => {
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
      'application/candidate-store',
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
      'startSyntheticSliceCampaign',
      'discoverJobs',
      'listLiveJobs',
      'getCandidateProfile(',
      'saveCandidateProfile',
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

function legacySyntheticRun(): { run: AutoApplyRun; items: AutoApplyQueueItem[] } {
  const now = '2026-09-24T00:00:00.000Z'
  return {
    run: {
      id: 'legacy-run-1',
      userId: USER_ID,
      status: 'needs_attention',
      config: { ...V2_START_ONE_CONFIG, includeSynthetic: true },
      counts: { found: 1, eligible: 1, autoApplyCapable: 1, tailored: 0, ready: 0, needsInput: 1, submitted: 0, skipped: 0, failed: 0, queued: 0, processing: 0, processed: 1, blocked: 0, captcha: 0 },
      createdAt: now,
      updatedAt: now,
    },
    items: [
      {
        id: 'legacy-item-1',
        runId: 'legacy-run-1',
        jobId: 'synthetic-job-1',
        identityKey: 'synthetic:senior java full stack developer',
        applicationId: null,
        resumeVersionId: null,
        resumeVersionName: 'Master',
        title: 'Senior Java Full Stack Developer',
        company: 'Test Employer',
        applicationUrl: 'http://127.0.0.1:8787/test-employer/job/1',
        initialMatchScore: 100,
        finalMatchScore: 100,
        c2cStatus: 'unknown',
        c2cEvidence: [],
        applicationStatus: 'needs_user_input',
        failureReason: 'MISSING_PROFILE_FIELD:last_name,phone',
        questions: [],
        tailoredResumeText: null,
        jobDescriptionSnapshot: null,
        location: null,
        confirmationNumber: null,
        confirmationText: null,
        submittedAt: null,
        masterResumeUnchanged: true,
        sessionId: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
  }
}

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
      supabase: { urlConfigured: false, serviceRole: 'missing', anonConfigured: false, frontendProject: 'unknown' },
    })
    expect(JSON.stringify(response.body)).not.toMatch(/key|secret|token/i)
  })

  it('authenticates start-one with the Supabase session and returns immediately with queued', async () => {
    seedAccount({ profile: { last_name: null, full_name: 'Ada', phone: null } })
    const app = createApp({ config: getServerConfig() })
    const missingAuth = await request(app).post('/api/autoapply-v2/start-one').set('x-jobpilot-user-id', USER_ID).send({ jobId: 'job-1' })
    expect(missingAuth.status).toBe(401)
    expect(missingAuth.body.code).toBe('AUTH_NOT_AVAILABLE')
    await request(app).post('/api/autoapply-v2/start-one').set('Authorization', 'Bearer not-a-session').send({ jobId: 'job-1' }).expect(401)
    await request(app).post('/api/autoapply-v2/start-one').set('Authorization', bearer()).send({}).expect(400)
    await request(app).post('/api/autoapply-v2/start-one').set('Authorization', bearer()).send({ jobId: 'missing' }).expect(404)

    rememberLiveJobs([liveJob({ id: 'job-1' })])
    const incomplete = await request(app).post('/api/autoapply-v2/start-one').set('Authorization', bearer()).send({ jobId: 'job-1' })
    expect(incomplete.status).toBe(422)
    expect(incomplete.body).toMatchObject({ success: false, code: 'PROFILE_INCOMPLETE', missingFields: ['lastName', 'phone'] })

    uninstallFakeSupabase()
    seedAccount()
    const response = await request(app)
      .post('/api/autoapply-v2/start-one')
      .set('Authorization', bearer())
      .send({ jobId: 'job-1', userId: OTHER_USER_ID })
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ success: true, status: 'queued', runId: expect.any(String) })
    expect(getV2Run(response.body.runId)?.userId).toBe(USER_ID)
  })

  it('profile-check finds the authenticated user profile and returns only availability', async () => {
    seedAccount()
    const app = createApp({ config: getServerConfig() })
    const missingAuth = await request(app).get('/api/autoapply-v2/profile-check')
    expect(missingAuth.status).toBe(401)
    expect(missingAuth.body.code).toBe('AUTH_NOT_AVAILABLE')

    const present = await request(app).get('/api/autoapply-v2/profile-check').set('Authorization', bearer())
    expect(present.status).toBe(200)
    expect(present.body).toEqual({ profileFound: true, firstName: true, lastName: true, email: true, phone: true })
    expect(JSON.stringify(present.body)).not.toMatch(/Ada|Lovelace|555-0100|ada@example.com/)

    const otherUser = await request(app).get('/api/autoapply-v2/profile-check').set('Authorization', bearer(OTHER_USER_ID))
    expect(otherUser.body).toEqual({ profileFound: false, firstName: false, lastName: false, email: false, phone: false })
  })

  it('profile-check reports database failures and reads as the user without a service-role key', async () => {
    seedAccount({ failures: { profiles: 500 } })
    const failing = await request(createApp({ config: getServerConfig() })).get('/api/autoapply-v2/profile-check').set('Authorization', bearer())
    expect(failing.status).toBe(503)
    expect(failing.body.code).toBe('PROFILE_DATABASE_ERROR')

    uninstallFakeSupabase()
    seedAccount({ serviceRoleKey: null })
    const userScoped = await request(createApp({ config: getServerConfig() }))
      .get('/api/autoapply-v2/profile-check')
      .set('Authorization', bearer())
    expect(userScoped.body).toEqual({ profileFound: true, firstName: true, lastName: true, email: true, phone: true })

    uninstallFakeSupabase()
    const noServer = await request(createApp({ config: getServerConfig() })).get('/api/autoapply-v2/profile-check').set('Authorization', bearer())
    expect(noServer.status).toBe(503)
    expect(noServer.body.code).toBe('SUPABASE_NOT_CONFIGURED')
  })

  it('Start Auto Apply verifies the session before the profile, also on Node.js without a built-in WebSocket', async () => {
    const productionStart = (profile?: Record<string, unknown>) => {
      seedAccount({ profile })
      vi.stubEnv('VITEST', 'false')
      vi.stubGlobal('WebSocket', undefined)
      rememberLiveJobs([liveJob({ id: 'real-1', jobUrl: 'https://jobs.example.com/real-1/apply' })])
      return createApp({ config: getServerConfig() })
    }
    const body = { userId: OTHER_USER_ID, resumeId: RESUME_ID, resumeVersionId: RESUME_ID, resumeText: 'resume', profile: startProfile }

    const incompleteApp = productionStart({ last_name: null, full_name: 'Ada' })
    const unauthenticated = await request(incompleteApp).post('/api/jobs/auto-apply/start').send(body)
    expect(unauthenticated.status).toBe(401)
    expect(unauthenticated.body.code).toBe('AUTH_NOT_AVAILABLE')
    const incomplete = await request(incompleteApp).post('/api/jobs/auto-apply/start').set('Authorization', bearer()).send(body)
    expect(incomplete.status).toBe(422)
    expect(incomplete.body).toMatchObject({ code: 'PROFILE_INCOMPLETE', missingFields: ['lastName'] })

    uninstallFakeSupabase()
    const started = await request(productionStart()).post('/api/jobs/auto-apply/start').set('Authorization', bearer()).send(body)
    expect(started.status).toBe(200)
    expect(started.body.items[0]).toMatchObject({ jobId: 'real-1', applicationStatus: 'queued' })
    expect(getV2Run(started.body.campaignId)?.userId).toBe(USER_ID)
  })

  it('shows V2 runs in the Auto Apply panel and hides stale legacy Test Employer runs', async () => {
    seedAccount()
    rememberLiveJobs([liveJob({ id: 'job-1' })])
    const legacy = legacySyntheticRun()
    await memoryStore.save(legacy.run, legacy.items)
    const { runId } = await startV2AutoApply({ userId: USER_ID, jobId: 'job-1' })
    const app = createApp({ config: getServerConfig() })

    const list = await request(app).get('/api/jobs/auto-apply').query({ userId: USER_ID })
    expect(list.status).toBe(200)
    expect(list.body.runs.map((entry: { run: { id: string } }) => entry.run.id)).toEqual([runId])
    const authenticated = await request(app).get('/api/jobs/auto-apply').query({ userId: OTHER_USER_ID }).set('Authorization', bearer())
    expect(authenticated.body.runs.map((entry: { run: { id: string } }) => entry.run.id)).toEqual([runId])

    const current = await request(app).get(`/api/jobs/auto-apply/${runId}`)
    expect(current.body.items[0]).toMatchObject({ title: 'Senior Engineer', company: 'Acme', applicationStatus: 'queued' })

    const pause = await request(app).post(`/api/jobs/auto-apply/${runId}/pause`)
    expect(pause.status).toBe(409)
    expect(pause.body.code).toBe('ACTION_UNSUPPORTED')

    const cancelled = await request(app).post(`/api/jobs/auto-apply/${runId}/cancel`)
    expect(cancelled.status).toBe(200)
    expect(cancelled.body.run.status).toBe('cancelled')
  })
})

describe('V2 score independence', () => {
  it('loads jobs and queues runs without reading match scores', async () => {
    seedAccount()
    rememberLiveJobs([liveJob({ id: 'job-1', matchScore: 97, matchedSkills: ['java'], missingSkills: [] })])
    const job = loadV2Job(USER_ID, 'job-1')
    expect(job).not.toHaveProperty('matchScore')
    const started = await startV2AutoApply({ userId: USER_ID, jobId: 'job-1' })
    const run = getV2Run(started.runId)
    expect(JSON.stringify(run)).not.toMatch(/matchScore|tailoredScore|matchedSkills/)
  })
})
