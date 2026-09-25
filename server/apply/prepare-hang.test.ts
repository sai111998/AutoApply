import { afterEach, describe, expect, it } from 'vitest'
import { JAVA_RESUME_TEXT } from '../tailor/fixtures'
import { PlaywrightApplyBrowser } from './browser'
import {
  defaultAutoApplyConfig,
  failStuckPreparations,
  getAutoApplyRun,
  prepareQueueItem,
  resetAutoApplyEngineForTests,
  startAutoApply,
} from './engine'
import { inspectApplicationPage } from './detect'
import { clearAutoApplyMemory, memoryStore } from './store'
import { resetAutomationHeartbeatsForTests, touchWorkerHeartbeat } from '../automation/heartbeat'
import type { ApplyBrowser, AutoApplyProfile, AutoApplyQueueItem, ListedAutoApplyJob } from './types'
import type { ServerConfig } from '../config'
import { classifyC2c } from '../jobs/c2c'
import { emptyLiveMatch } from '../jobs/score'

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

const shortTimeouts = {
  launchMs: 40,
  navigationMs: 40,
  selectorMs: 40,
  fillMs: 40,
  databaseMs: 80,
  prepareMs: 60,
  lockMs: 80,
  stuckMs: 30,
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

function neverResolve<T = never>() {
  return new Promise<T>(() => undefined)
}

async function startReadyRun(overrides: Partial<AutoApplyQueueItem> = {}) {
  const started = await startAutoApply(
    config,
    {
      userId: 'user-1',
      resumeId: 'resume-1',
      resumeVersionId: 'resume-1',
      resumeText: JAVA_RESUME_TEXT,
      masterResumeText: JAVA_RESUME_TEXT,
      profile,
      config: defaultAutoApplyConfig({ autoTailorResume: true, minimumMatchRate: 70, maxJobs: 10 }),
    },
    undefined,
    { listJobs: async () => ({ jobs: [listing({ id: 'ready-1', title: 'Java Engineer' })] }), delayMs: 0 },
  )
  if (Object.keys(overrides).length) {
    const stored = await memoryStore.get(started.run.id)
    if (!stored) throw new Error('run missing')
    Object.assign(stored.items[0], overrides)
    await memoryStore.save(stored.run, stored.items)
    return { run: stored.run, items: stored.items }
  }
  return started
}

function readyBrowser(result?: Partial<Awaited<ReturnType<ApplyBrowser['prepare']>>>): ApplyBrowser {
  return {
    async prepare() {
      return {
        status: 'ready_for_submission',
        questions: [],
        failureReason: null,
        sessionId: 'filled:1',
        ...result,
      }
    },
    async submit() {
      return { status: 'needs_user_confirmation', failureReason: 'not submitted' }
    },
  }
}

afterEach(() => {
  clearAutoApplyMemory()
  resetAutoApplyEngineForTests()
  resetAutomationHeartbeatsForTests()
})

describe('auto apply preparation hang recovery', () => {
  it('prepares a ready item without regenerating an existing tailored resume', async () => {
    const started = await startReadyRun()
    const before = started.items[0]
    expect(before.resumeVersionName).toMatch(/Tailored v1/)
    const tailored = before.tailoredResumeText
    const versionId = before.resumeVersionId
    const prepared = await prepareQueueItem(
      started.run.id,
      before.id,
      { profile, html: '<form><label>Full name</label><input name="name"><button type="submit">Submit</button></form>' },
      { delayMs: 0, browser: readyBrowser(), timeouts: shortTimeouts },
    )
    expect(prepared.item.applicationStatus).toBe('ready_for_submission')
    expect(prepared.item.resumeVersionName).toBe(before.resumeVersionName)
    expect(prepared.item.resumeVersionId).toBe(versionId)
    expect(prepared.item.tailoredResumeText).toBe(tailored)
    expect(prepared.item.resumeVersionName).not.toMatch(/v2|v3/)
  })

  it('times out a hung browser.prepare and leaves the item failed', async () => {
    const started = await startReadyRun()
    await expect(
      prepareQueueItem(
        started.run.id,
        started.items[0].id,
        { profile },
        {
          delayMs: 0,
          timeouts: shortTimeouts,
          browser: {
            prepare: () => neverResolve(),
            async submit() {
              return { status: 'failed', failureReason: 'unused' }
            },
          },
        },
      ),
    ).rejects.toMatchObject({ code: 'PREPARE_TIMEOUT' })
    const stored = await memoryStore.get(started.run.id)
    expect(stored?.items[0].applicationStatus).toBe('failed')
    expect(stored?.items[0].applicationStatus).not.toBe('preparing')
    expect(stored?.items[0].failureReason).toMatch(/timed out/i)
  })

  it('times out a hung Chromium launch', async () => {
    const started = await startReadyRun()
    const browser = new PlaywrightApplyBrowser({
      timeouts: shortTimeouts,
      health: async () => ({ available: true, runtime: 'node-server' }),
      loadPlaywright: async () => ({
        chromium: {
          launch: () => neverResolve(),
        },
      }),
    })
    await expect(
      prepareQueueItem(started.run.id, started.items[0].id, { profile }, { delayMs: 0, browser, timeouts: shortTimeouts }),
    ).rejects.toMatchObject({ code: 'BROWSER_LAUNCH_TIMEOUT' })
    const stored = await memoryStore.get(started.run.id)
    expect(stored?.items[0].applicationStatus).toBe('failed')
  })

  it('times out a hung page.goto', async () => {
    const started = await startReadyRun()
    const browser = new PlaywrightApplyBrowser({
      timeouts: shortTimeouts,
      health: async () => ({ available: true, runtime: 'node-server' }),
      loadPlaywright: async () => ({
        chromium: {
          async launch() {
            return {
              async close() {
                return undefined
              },
              async newPage() {
                return {
                  goto: () => neverResolve(),
                  content: () => neverResolve<string>(),
                }
              },
            }
          },
        },
      }),
    })
    await expect(
      prepareQueueItem(started.run.id, started.items[0].id, { profile }, { delayMs: 0, browser, timeouts: shortTimeouts }),
    ).rejects.toMatchObject({ code: 'BROWSER_NAVIGATION_TIMEOUT' })
    const stored = await memoryStore.get(started.run.id)
    expect(stored?.items[0].applicationStatus).toBe('failed')
  })

  it('fails a missing application URL without launching a browser', async () => {
    const started = await startReadyRun({ applicationUrl: null })
    let launched = 0
    await expect(
      prepareQueueItem(
        started.run.id,
        started.items[0].id,
        { profile },
        {
          delayMs: 0,
          timeouts: shortTimeouts,
          browser: {
            async prepare() {
              launched += 1
              return { status: 'ready_for_submission', questions: [], failureReason: null, sessionId: 'x' }
            },
            async submit() {
              return { status: 'failed', failureReason: null }
            },
          },
        },
      ),
    ).rejects.toMatchObject({ code: 'APPLICATION_URL_MISSING' })
    expect(launched).toBe(0)
  })

  it('fails resume and job lookup errors before browser work', async () => {
    const started = await startReadyRun({ jobId: '' })
    await expect(
      prepareQueueItem(started.run.id, started.items[0].id, { profile }, { delayMs: 0, timeouts: shortTimeouts, browser: readyBrowser() }),
    ).rejects.toMatchObject({ code: 'JOB_NOT_FOUND' })

    const resumeMissing = await startReadyRun({
      jobId: 'job-1',
      resumeVersionId: null,
      tailoredResumeText: null,
      resumeVersionName: 'Master',
    })
    await expect(
      prepareQueueItem(resumeMissing.run.id, resumeMissing.items[0].id, { profile }, { delayMs: 0, timeouts: shortTimeouts, browser: readyBrowser() }),
    ).rejects.toMatchObject({ code: 'RESUME_VERSION_NOT_FOUND' })
  })

  it('fails when the application store cannot save', async () => {
    const started = await startReadyRun()
    const store = {
      save: async () => {
        throw new Error('supabase upsert failed')
      },
      get: async (runId: string) => memoryStore.get(runId),
      list: async (userId: string) => memoryStore.list(userId),
    }
    await expect(
      prepareQueueItem(
        started.run.id,
        started.items[0].id,
        { profile },
        { delayMs: 0, store, timeouts: shortTimeouts, browser: readyBrowser() },
      ),
    ).rejects.toMatchObject({ code: 'DATABASE_ERROR' })
  })

  it('fails fast when browser automation is unavailable', async () => {
    const started = await startReadyRun()
    const prepared = await prepareQueueItem(
      started.run.id,
      started.items[0].id,
      { profile },
      {
        delayMs: 0,
        timeouts: shortTimeouts,
        browser: {
          async prepare() {
            return {
              status: 'automation_blocked',
              questions: [],
              failureReason: 'Browser automation is not available. JobPilot cannot open the employer application in this environment.',
              sessionId: null,
            }
          },
          async submit() {
            return { status: 'failed', failureReason: null }
          },
        },
      },
    )
    expect(prepared.item.applicationStatus).toBe('automation_blocked')
    expect(prepared.item.applicationStatus).not.toBe('preparing')
  })

  it('does not treat a page that only mentions the word name as an application form', () => {
    const inspection = inspectApplicationPage(
      '<html><body><h1>Example Domain</h1><p>This domain is for use in illustrative examples in documents.</p></body></html>',
    )
    expect(inspection.mappedFields).toEqual([])
    expect(inspection.hasSubmit).toBe(false)
  })

  it('returns APPLICATION_FORM_NOT_FOUND when the employer page has no form', async () => {
    const started = await startReadyRun()
    const browser = new PlaywrightApplyBrowser()
    const prepared = await browser.prepare({
      url: 'https://jobs.example.com/empty',
      profile,
      resumeText: JAVA_RESUME_TEXT,
      html: '<html><body><p>Welcome to Example</p></body></html>',
    })
    expect(prepared.status).toBe('failed')
    expect(prepared.failureReason).toMatch(/classified after collecting evidence|supported application/i)
    const queued = await prepareQueueItem(
      started.run.id,
      started.items[0].id,
      { profile, html: '<html><body><p>Welcome to Example</p></body></html>' },
      { delayMs: 0, timeouts: shortTimeouts, browser },
    )
    expect(queued.item.applicationStatus).toBe('failed')
  })

  it('converts an unexpected exception into failed', async () => {
    const started = await startReadyRun()
    await expect(
      prepareQueueItem(
        started.run.id,
        started.items[0].id,
        { profile },
        {
          delayMs: 0,
          timeouts: shortTimeouts,
          browser: {
            async prepare() {
              throw new Error('boom')
            },
            async submit() {
              return { status: 'failed', failureReason: null }
            },
          },
        },
      ),
    ).rejects.toMatchObject({ code: 'BROWSER_AUTOMATION_ERROR' })
    const stored = await memoryStore.get(started.run.id)
    expect(stored?.items[0].applicationStatus).toBe('failed')
  })

  it('joins a duplicate Apply instead of starting a second preparation', async () => {
    const started = await startReadyRun()
    let calls = 0
    const browser: ApplyBrowser = {
      async prepare() {
        calls += 1
        await new Promise((resolve) => setTimeout(resolve, 40))
        return { status: 'ready_for_submission', questions: [], failureReason: null, sessionId: 'filled:dup' }
      },
      async submit() {
        return { status: 'failed', failureReason: null }
      },
    }
    const [first, second] = await Promise.all([
      prepareQueueItem(started.run.id, started.items[0].id, { profile }, { delayMs: 0, browser, timeouts: shortTimeouts }),
      prepareQueueItem(started.run.id, started.items[0].id, { profile }, { delayMs: 0, browser, timeouts: shortTimeouts }),
    ])
    expect(calls).toBe(1)
    expect(first.item.sessionId).toBe(second.item.sessionId)
    expect(first.item.applicationStatus).toBe('ready_for_submission')
  })

  it('returns the existing ready_for_submission item without preparing again', async () => {
    const started = await startReadyRun({
      applicationStatus: 'ready_for_submission',
      sessionId: 'filled:existing',
      resumeVersionName: 'Tailored v1 — Java Engineer',
    })
    let calls = 0
    const prepared = await prepareQueueItem(
      started.run.id,
      started.items[0].id,
      { profile },
      {
        delayMs: 0,
        timeouts: shortTimeouts,
        browser: {
          async prepare() {
            calls += 1
            return { status: 'ready_for_submission', questions: [], failureReason: null, sessionId: 'filled:new' }
          },
          async submit() {
            return { status: 'failed', failureReason: null }
          },
        },
      },
    )
    expect(calls).toBe(0)
    expect(prepared.item.applicationStatus).toBe('ready_for_submission')
    expect(prepared.item.sessionId).toBe('filled:existing')
  })

  it('does not prepare an already submitted application', async () => {
    const started = await startReadyRun({ applicationStatus: 'submitted' })
    let calls = 0
    const prepared = await prepareQueueItem(
      started.run.id,
      started.items[0].id,
      { profile },
      {
        delayMs: 0,
        timeouts: shortTimeouts,
        browser: {
          async prepare() {
            calls += 1
            return { status: 'ready_for_submission', questions: [], failureReason: null, sessionId: 'filled:new' }
          },
          async submit() {
            return { status: 'submitted', failureReason: null }
          },
        },
      },
    )
    expect(calls).toBe(0)
    expect(prepared.item.applicationStatus).toBe('submitted')
  })

  it('converts a stuck preparing record to failed', async () => {
    const started = await startReadyRun({
      applicationStatus: 'preparing',
      updatedAt: new Date(Date.now() - 120_000).toISOString(),
    })
    failStuckPreparations(started.items, 30)
    expect(started.items[0].applicationStatus).toBe('failed')
    const loaded = await getAutoApplyRun(started.run.id, { timeouts: shortTimeouts })
    expect(loaded?.items[0].applicationStatus).toBe('failed')
  })

  it('does not fail an in-progress item while the browser worker heartbeat is fresh', async () => {
    const started = await startReadyRun({
      applicationStatus: 'opening',
      updatedAt: new Date(Date.now() - 120_000).toISOString(),
    })
    touchWorkerHeartbeat()
    failStuckPreparations(started.items, 30)
    expect(started.items[0].applicationStatus).toBe('opening')
    const loaded = await getAutoApplyRun(started.run.id, { timeouts: shortTimeouts })
    expect(loaded?.items[0].applicationStatus).toBe('opening')
  })

  it('does not let one hung job block a second job after the lock timeout', async () => {
    const first = await startReadyRun()
    const second = await startAutoApply(
      config,
      {
        userId: 'user-1',
        resumeId: 'resume-1',
        resumeVersionId: 'resume-1',
        resumeText: JAVA_RESUME_TEXT,
        masterResumeText: JAVA_RESUME_TEXT,
        profile,
        config: defaultAutoApplyConfig({ autoTailorResume: false, minimumMatchRate: 70, maxJobs: 10 }),
      },
      undefined,
      { listJobs: async () => ({ jobs: [listing({ id: 'ready-2', title: 'Second Java' })] }), delayMs: 0 },
    )
    const hung: ApplyBrowser = {
      prepare: () => neverResolve(),
      async submit() {
        return { status: 'failed', failureReason: null }
      },
    }
    const ok = readyBrowser()
    const hanging = prepareQueueItem(first.run.id, first.items[0].id, { profile }, { delayMs: 0, browser: hung, timeouts: shortTimeouts })
    await new Promise((resolve) => setTimeout(resolve, 10))
    const prepared = await prepareQueueItem(second.run.id, second.items[0].id, { profile }, { delayMs: 0, browser: ok, timeouts: shortTimeouts })
    expect(prepared.item.applicationStatus).toBe('ready_for_submission')
    await expect(hanging).rejects.toMatchObject({ code: 'PREPARE_TIMEOUT' })
  })
})
