import { describe, expect, it, vi, afterEach } from 'vitest'
import request from 'supertest'
import { createApp } from '../app'
import { JAVA_RESUME_TEXT } from '../tailor/fixtures'
import { ApplyError } from './errors'
import { inspectApplicationPage } from './detect'
import {
  defaultAutoApplyConfig,
  prepareQueueItem,
  resetAutoApplyEngineForTests,
  startAutoApply,
} from './engine'
import { resetAgentForTests } from '../agent'
import { assertCanPrepareItem, assertSupportedProvider, inspectApplicationUrl } from './validate'
import { clearAutoApplyMemory, memoryStore } from './store'
import type { AutoApplyProfile, AutoApplyQueueItem } from './types'
import type { ServerConfig } from '../config'
import { classifyC2c } from '../jobs/c2c'
import { emptyLiveMatch } from '../jobs/score'
import type { ListedAutoApplyJob } from './types'

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

function listing(partial: Partial<ListedAutoApplyJob> & Pick<ListedAutoApplyJob, 'id' | 'title'>): ListedAutoApplyJob {
  const description = partial.description ?? 'Java Spring Boot C2C'
  const c2c = classifyC2c({ title: partial.title, description })
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
    matchScore: 90,
    ...partial,
  }
}

function sampleItem(overrides: Partial<AutoApplyQueueItem> = {}): AutoApplyQueueItem {
  return {
    id: 'item-1',
    runId: 'run-1',
    jobId: 'job-1',
    identityKey: 'job-opportunities:job-1',
    applicationId: 'app-1',
    resumeVersionId: 'resume-1',
    resumeVersionName: 'Master',
    title: 'Java Engineer',
    company: 'Example',
    applicationUrl: 'https://jobs.example.com/job-1',
    initialMatchScore: 80,
    finalMatchScore: 86,
    c2cStatus: 'confirmed',
    c2cEvidence: [],
    applicationStatus: 'ready',
    failureReason: null,
    questions: [],
    tailoredResumeText: JAVA_RESUME_TEXT,
    jobDescriptionSnapshot: 'Java Spring Boot C2C',
    location: 'Austin, TX',
    confirmationNumber: null,
    confirmationText: null,
    submittedAt: null,
    masterResumeUnchanged: true,
    sessionId: null,
    createdAt: '2026-09-18T00:00:00.000Z',
    updatedAt: '2026-09-18T00:00:00.000Z',
    ...overrides,
  }
}

async function startReadyRun() {
  return startAutoApply(
    config,
    {
      userId: 'user-1',
      resumeId: 'resume-1',
      resumeVersionId: 'resume-1',
      resumeText: JAVA_RESUME_TEXT,
      masterResumeText: JAVA_RESUME_TEXT,
      profile,
      config: defaultAutoApplyConfig({ autoTailorResume: false, minimumMatchRate: 70, maxJobs: 1 }),
    },
    undefined,
    { listJobs: async () => ({ jobs: [listing({ id: 'ready-1', title: 'Java Engineer' })] }), delayMs: 0 },
  )
}

afterEach(() => {
  clearAutoApplyMemory()
  resetAutoApplyEngineForTests()
  resetAgentForTests()
})

describe('application preparation validation', () => {
  it('accepts an absolute http(s) employer URL and rejects missing or invalid URLs', () => {
    expect(inspectApplicationUrl('https://jobs.example.com/apply').ok).toBe(true)
    expect(inspectApplicationUrl(null).code).toBe('APPLICATION_URL_MISSING')
    expect(inspectApplicationUrl('javascript:alert(1)').code).toBe('INVALID_APPLICATION_URL')
    expect(inspectApplicationUrl('/relative/apply').code).toBe('INVALID_APPLICATION_URL')
    expect(inspectApplicationUrl('http://localhost:5173/jobs').code).toBe('INVALID_APPLICATION_URL')
    expect(inspectApplicationUrl('chrome://settings').code).toBe('INVALID_APPLICATION_URL')
    expect(inspectApplicationUrl('file:///tmp/apply.html').code).toBe('INVALID_APPLICATION_URL')
  })

  it('requires a ready selected resume version and file text', () => {
    expect(() => assertCanPrepareItem(sampleItem())).not.toThrow()
    expect(() => assertCanPrepareItem(sampleItem({ jobId: '' }))).toThrow(ApplyError)
    expect(() => assertCanPrepareItem(sampleItem({ applicationUrl: null }))).toThrow(/application URL/i)
    expect(() => assertCanPrepareItem(sampleItem({ resumeVersionId: null, tailoredResumeText: null }))).toThrow(
      /resume version/i,
    )
    expect(() => assertCanPrepareItem(sampleItem({ resumeVersionName: 'Tailored pending' }))).toThrow(/not ready/i)
    expect(() => assertCanPrepareItem(sampleItem({ tailoredResumeText: '   ' }))).toThrow(/missing text/i)
  })

  it('rejects an unsupported provider identity', () => {
    expect(() => assertSupportedProvider('unknown')).toThrow(/source/i)
    expect(() => assertSupportedProvider('job-opportunities:abc')).not.toThrow()
  })

  it('rejects a mismatched user as an authentication failure', () => {
    try {
      assertCanPrepareItem(sampleItem(), { userId: 'other', runUserId: 'user-1' })
      throw new Error('expected auth failure')
    } catch (error) {
      expect(error).toBeInstanceOf(ApplyError)
      expect((error as ApplyError).code).toBe('AUTHENTICATION_FAILURE')
    }
  })
})

describe('application preparation flow', () => {
  it('prepares a ready queue item and returns items without marking Applied', async () => {
    const started = await startReadyRun()
    expect(started.items[0].applicationStatus).toBe('queued')
    const prepared = await prepareQueueItem(
      started.run.id,
      started.items[0].id,
      { profile, html: '<form><label>Full name</label><input name="name"><button type="submit">Submit</button></form>' },
      {
        delayMs: 0,
        browser: {
          async prepare() {
            return { status: 'ready_for_submission', questions: [], failureReason: null, sessionId: 'filled:1' }
          },
          async submit() {
            return { status: 'submitted', failureReason: null }
          },
        },
      },
    )
    expect(prepared.items).toHaveLength(1)
    expect(prepared.item.applicationStatus).toBe('ready_for_submission')
    expect(prepared.item.applicationStatus).not.toBe('applied')
    expect(prepared.item.applicationStatus).not.toBe('submitted')
    expect(prepared.item.resumeVersionId).toBeTruthy()
    expect(prepared.item.sourceResumeId).toBe('resume-1')
    expect(prepared.item.tailoredResumeText).toContain('Java')
  })

  it('retries Apply after a previous Playwright install failure', async () => {
    const started = await startReadyRun()
    const stored = await memoryStore.get(started.run.id)
    if (!stored) throw new Error('run missing')
    stored.items[0].applicationStatus = 'automation_blocked'
    stored.items[0].failureReason = 'Playwright is not installed'
    await memoryStore.save(stored.run, stored.items)
    const prepared = await prepareQueueItem(
      started.run.id,
      stored.items[0].id,
      { profile, html: '<form><label>Full name</label><input name="name"><button type="submit">Submit</button></form>' },
      {
        delayMs: 0,
        browser: {
          async prepare() {
            return { status: 'ready_for_submission', questions: [], failureReason: null, sessionId: 'filled:retry' }
          },
          async submit() {
            return { status: 'needs_user_confirmation', failureReason: null }
          },
        },
      },
    )
    expect(prepared.item.applicationStatus).toBe('ready_for_submission')
    expect(prepared.item.applicationStatus).not.toBe('submitted')
    expect(prepared.item.failureReason).toBeNull()
  })

  it('returns APPLICATION_NOT_FOUND for a missing queue item', async () => {
    await expect(prepareQueueItem('missing-run', 'missing-item', { profile }, { delayMs: 0 })).rejects.toMatchObject({
      code: 'APPLICATION_NOT_FOUND',
    })
  })

  it('returns JOB_NOT_FOUND, URL, and resume errors for incomplete queue items', async () => {
    const started = await startReadyRun()
    const stored = await memoryStore.get(started.run.id)
    if (!stored) throw new Error('run missing')
    stored.items[0].jobId = ''
    await memoryStore.save(stored.run, stored.items)
    await expect(prepareQueueItem(started.run.id, stored.items[0].id, { profile }, { delayMs: 0 })).rejects.toMatchObject({
      code: 'JOB_NOT_FOUND',
    })

    stored.items[0].jobId = 'job-1'
    stored.items[0].applicationUrl = ''
    await memoryStore.save(stored.run, stored.items)
    await expect(prepareQueueItem(started.run.id, stored.items[0].id, { profile }, { delayMs: 0 })).rejects.toMatchObject({
      code: 'APPLICATION_URL_MISSING',
    })

    stored.items[0].applicationUrl = 'notaurl'
    await memoryStore.save(stored.run, stored.items)
    await expect(prepareQueueItem(started.run.id, stored.items[0].id, { profile }, { delayMs: 0 })).rejects.toMatchObject({
      code: 'INVALID_APPLICATION_URL',
    })

    stored.items[0].applicationUrl = 'https://jobs.example.com/ready-1'
    stored.items[0].resumeVersionId = null
    stored.items[0].tailoredResumeText = null
    await memoryStore.save(stored.run, stored.items)
    await expect(prepareQueueItem(started.run.id, stored.items[0].id, { profile }, { delayMs: 0 })).rejects.toMatchObject({
      code: 'RESUME_VERSION_NOT_FOUND',
    })

    stored.items[0].resumeVersionId = 'resume-1'
    stored.items[0].resumeVersionName = 'Tailored pending'
    stored.items[0].tailoredResumeText = JAVA_RESUME_TEXT
    await memoryStore.save(stored.run, stored.items)
    await expect(prepareQueueItem(started.run.id, stored.items[0].id, { profile }, { delayMs: 0 })).rejects.toMatchObject({
      code: 'RESUME_VERSION_NOT_READY',
    })
  })

  it('surfaces browser automation failure without marking Applied', async () => {
    const started = await startReadyRun()
    await expect(
      prepareQueueItem(
        started.run.id,
        started.items[0].id,
        { profile },
        {
          delayMs: 0,
          browser: {
            async prepare() {
              throw new Error('chromium launch failed')
            },
            async submit() {
              return { status: 'submitted', failureReason: null }
            },
          },
        },
      ),
    ).rejects.toMatchObject({ code: 'BROWSER_AUTOMATION_ERROR' })
    const stored = await memoryStore.get(started.run.id)
    expect(stored?.items[0].applicationStatus).toBe('failed')
    expect(stored?.items[0].applicationStatus).not.toBe('applied')
    expect(stored?.items[0].applicationStatus).not.toBe('submitted')
  })

  it('pauses for CAPTCHA and MFA without submitting', async () => {
    expect(inspectApplicationPage('<div class="g-recaptcha" data-sitekey="x"></div>').status).toBe('captcha_required')
    expect(inspectApplicationPage('<p>Enter the authenticator app code</p>').status).toBe('mfa_required')
    expect(inspectApplicationPage('<form>Sign in<input type="password"></form>').status).toBe('login_required')
    const started = await startReadyRun()
    const prepared = await prepareQueueItem(
      started.run.id,
      started.items[0].id,
      { profile, html: '<div class="g-recaptcha" data-sitekey="x"></div>' },
      {
        delayMs: 0,
        browser: {
          async prepare(input) {
            const inspection = inspectApplicationPage(input.html ?? '')
            return { status: inspection.status, questions: [], failureReason: inspection.failureReason, sessionId: null }
          },
          async submit() {
            return { status: 'submitted', failureReason: null }
          },
        },
      },
    )
    expect(prepared.item.applicationStatus).toBe('captcha_required')
    expect(prepared.item.applicationStatus).not.toBe('applied')
  })
})

describe('POST /api/jobs/auto-apply item apply', () => {
  it('returns run and items so the Live Jobs Apply button can continue', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'ffd759ce-b1fa-4ace-a823-bb0d0595e4ae',
              title: 'Java Software Engineer',
              company: 'Example',
              description: 'Java Spring Boot C2C',
              apply_url: 'https://jobs.example.com/java',
              employment_type: 'Contract',
              posted_at: '2026-09-17T00:00:00Z',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    const app = createApp({
      config: { ...config, joobleEnabled: false, usajobsEnabled: false },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    const started = await request(app).post('/api/jobs/auto-apply/start').send({
      userId: 'user-1',
      resumeId: 'resume-1',
      resumeVersionId: 'resume-1',
      resumeText: JAVA_RESUME_TEXT,
      profile,
      config: { maxJobs: 1, minimumMatchRate: 1, autoTailorResume: false, q: 'Java', jobType: 'all' },
    })
    expect(started.status).toBe(200)
    expect(started.body.items?.length).toBeGreaterThan(0)
    const item = started.body.items[0]
    const prepared = await request(app)
      .post(`/api/jobs/auto-apply/${started.body.run.id}/items/${item.id}/apply`)
      .send({ profile, userId: 'user-1' })
    expect([200, 504, 503]).toContain(prepared.status)
    const preparedItem = prepared.body.item ?? prepared.body.items?.[0]
    expect(prepared.body.success === false ? prepared.body.code : true).toBeTruthy()
    expect(preparedItem?.applicationStatus).not.toBe('applied')
    expect(preparedItem?.applicationStatus).not.toBe('submitted')
    expect(preparedItem?.applicationStatus).not.toBe('preparing')
    if (prepared.body.items) {
      expect(prepared.body.items).toEqual(expect.any(Array))
      expect([
        'ready_for_submission',
        'needs_user_input',
        'needs_user_confirmation',
        'captcha_required',
        'mfa_required',
        'login_required',
        'automation_blocked',
        'queued',
        'failed',
      ]).toContain(prepared.body.items[0].applicationStatus)
    }

    const missing = await request(app).post('/api/jobs/auto-apply/missing/items/missing/apply').send({ profile })
    expect(missing.status).toBe(404)
    expect(missing.body.success).toBe(false)
    expect(missing.body.code).toBe('APPLICATION_NOT_FOUND')
  })
})
