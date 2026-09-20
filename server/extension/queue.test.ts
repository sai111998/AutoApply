import { afterEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../app'
import type { ServerConfig } from '../config'
import { startAutoApply, resetAutoApplyEngineForTests, prepareQueueItem, defaultAutoApplyConfig } from '../apply/engine'
import { JAVA_RESUME_TEXT } from '../tailor/fixtures'
import { classifyC2c } from '../jobs/c2c'
import { emptyLiveMatch } from '../jobs/score'
import { clearAutoApplyMemory } from '../apply/store'
import { resetExtensionConnectionsForTests } from './connection'
import { resetExtensionProfilesForTests } from './profile-store'
import { isEligibleForAutoApply } from '../apply/eligibility'
import type { AutoApplyProfile, ListedAutoApplyJob } from '../apply/types'

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

function job(partial: Partial<ListedAutoApplyJob> & { id: string; title: string }): ListedAutoApplyJob {
  const description = partial.description ?? 'Java Spring Boot C2C corp to corp'
  const c2c = classifyC2c({ title: partial.title, description })
  const matchScore = partial.matchScore ?? 90
  return {
    company: 'Acme',
    description,
    url: `https://jobs.example.com/${partial.id}`,
    jobUrl: `https://jobs.example.com/${partial.id}`,
    identityKey: `job-opportunities:${partial.id}`,
    provider: 'job-opportunities',
    providerJobId: partial.id,
    employmentType: 'Contract',
    postedAt: '2026-09-17T00:00:00.000Z',
    fetchedAt: '2026-09-17T00:00:00.000Z',
    ...partial,
    c2cStatus: partial.c2cStatus ?? c2c.status,
    c2cEvidence: partial.c2cEvidence ?? c2c.evidence,
    match: partial.match ?? { ...emptyLiveMatch('resume-1'), score: matchScore, matchedSkills: ['Java'], missingSkills: [] },
    matchScore: partial.matchScore ?? matchScore,
  }
}

afterEach(() => {
  resetAutoApplyEngineForTests()
  clearAutoApplyMemory()
  resetExtensionConnectionsForTests()
  resetExtensionProfilesForTests()
})

describe('automation queue', () => {
  it('only enqueues jobs that meet match, C2C, and duplicate rules', () => {
    const listed = job({ id: 'java', title: 'Java Engineer', matchScore: 90 })
    expect(
      isEligibleForAutoApply(listed, {
        minimumMatchRate: 85,
        finalMatchScore: 82,
        jobType: 'all',
      }).ok,
    ).toBe(false)
    expect(
      isEligibleForAutoApply(listed, {
        minimumMatchRate: 85,
        finalMatchScore: 87,
        jobType: 'c2c',
      }).ok,
    ).toBe(listed.c2cStatus === 'confirmed')
    const w2 = job({ id: 'w2', title: 'W2 Java', description: 'W2 only Java role', matchScore: 90 })
    expect(isEligibleForAutoApply(w2, { minimumMatchRate: 70, finalMatchScore: 90, jobType: 'c2c' }).ok).toBe(false)
  })

  it('registers the extension, claims the next job, and never marks submitted without confirmation', async () => {
    const app = createApp({ config })
    const started = await startAutoApply(
      config,
      {
        userId: 'user-1',
        resumeId: 'resume-1',
        resumeVersionId: 'resume-1',
        resumeText: JAVA_RESUME_TEXT,
        masterResumeText: JAVA_RESUME_TEXT,
        profile,
        config: defaultAutoApplyConfig({ maxJobs: 1, minimumMatchRate: 70, autoTailorResume: false, q: 'Java', jobType: 'all' }),
      },
      undefined,
      { listJobs: async () => ({ jobs: [job({ id: 'java', title: 'Java Engineer', matchScore: 90 })] }), delayMs: 0 },
    )
    expect(started.items).toHaveLength(1)
    const unconnected = await request(app).get('/api/automation/queue/next').set('x-jobpilot-user-id', 'user-1')
    expect(unconnected.body.code).toBe('EXTENSION_NOT_CONNECTED')
    const registered = await request(app).post('/api/automation/extension/register').send({ userId: 'user-1', extensionId: 'test-ext' })
    expect(registered.body.connected).toBe(true)
    const next = await request(app).get('/api/automation/queue/next').set('x-jobpilot-user-id', 'user-1')
    expect(next.body.item.jobTitle).toBe('Java Engineer')
    expect(next.body.item.applicationUrl).toMatch(/^https:\/\//)
    expect(JSON.stringify(next.body)).not.toMatch(/jordan\.hale@example.com|SERVICE_ROLE/)
    expect(next.body.item.status).toBe('opening')
    const filling = await request(app).post('/api/automation/events').send({
      userId: 'user-1',
      itemId: next.body.item.itemId,
      applicationId: next.body.item.applicationId,
      type: 'filling',
    })
    expect(filling.body.item.applicationStatus).toBe('filling')
    const ready = await request(app).post('/api/automation/events').send({
      userId: 'user-1',
      itemId: next.body.item.itemId,
      type: 'ready_for_review',
    })
    expect(ready.body.item.applicationStatus).toBe('ready_for_submission')
    const fakeSubmit = await request(app).post('/api/automation/events').send({
      userId: 'user-1',
      itemId: next.body.item.itemId,
      type: 'submitted',
    })
    expect(fakeSubmit.body.item.applicationStatus).toBe('needs_user_confirmation')
    expect(fakeSubmit.body.item.applicationStatus).not.toBe('submitted')
    const confirmed = await request(app).post('/api/automation/events').send({
      userId: 'user-1',
      itemId: next.body.item.itemId,
      type: 'submitted',
      html: '<h1>Thank you for applying</h1><p>Confirmation number ABC12345</p>',
      title: 'Application submitted',
    })
    expect(confirmed.body.item.applicationStatus).toBe('submitted')
  })

  it('marks Apply as extension_not_connected when the extension is missing', async () => {
    const started = await startAutoApply(
      config,
      {
        userId: 'user-1',
        resumeId: 'resume-1',
        resumeVersionId: 'resume-1',
        resumeText: JAVA_RESUME_TEXT,
        masterResumeText: JAVA_RESUME_TEXT,
        profile,
        config: defaultAutoApplyConfig({ maxJobs: 1, minimumMatchRate: 70, autoTailorResume: false, q: 'Java' }),
      },
      undefined,
      { listJobs: async () => ({ jobs: [job({ id: 'java', title: 'Java Engineer', matchScore: 90 })] }), delayMs: 0 },
    )
    const prepared = await prepareQueueItem(started.run.id, started.items[0].id, { profile, userId: 'user-1' }, { delayMs: 0 })
    expect(prepared.item.applicationStatus).toBe('extension_not_connected')
    expect(prepared.item.applicationStatus).not.toBe('submitted')
  })

  it('returns profile values and authorized resume text after a run starts', async () => {
    const app = createApp({ config })
    const started = await startAutoApply(
      config,
      {
        userId: 'user-1',
        resumeId: 'resume-1',
        resumeVersionId: 'resume-1',
        resumeText: JAVA_RESUME_TEXT,
        masterResumeText: JAVA_RESUME_TEXT,
        profile,
        config: defaultAutoApplyConfig({ maxJobs: 1, minimumMatchRate: 70, autoTailorResume: false, q: 'Java' }),
      },
      undefined,
      { listJobs: async () => ({ jobs: [job({ id: 'java', title: 'Java Engineer', matchScore: 90 })] }), delayMs: 0 },
    )
    const values = await request(app).get('/api/extension/profile').set('x-jobpilot-user-id', 'user-1')
    expect(values.body.profile.firstName).toBe('Jordan')
    expect(values.body.profile.email).toBe('jordan.hale@example.com')
    const resume = await request(app)
      .get('/api/extension/resume')
      .query({ userId: 'user-1', applicationId: started.items[0].applicationId })
    expect(resume.body.available).toBe(true)
    expect(Buffer.from(resume.body.resume.contentBase64, 'base64').toString('utf8')).toContain('Java')
  })

  it('filters match threshold, C2C, maxJobs, and duplicates when creating the queue', async () => {
    const listed = [
      job({ id: 'low', title: 'Java Low', matchScore: 70, description: 'Java Spring Boot C2C corp to corp' }),
      job({ id: 'w2', title: 'W2 Java', matchScore: 92, description: 'W2 only Java role' }),
      job({ id: 'c2c-a', title: 'C2C Java A', matchScore: 90, description: 'Java Spring Boot C2C corp to corp' }),
      job({ id: 'c2c-b', title: 'C2C Java B', matchScore: 91, description: 'Java Spring Boot corp to corp' }),
      job({ id: 'c2c-c', title: 'C2C Java C', matchScore: 88, description: 'Java Spring Boot corporation-to-corporation' }),
    ]
    const started = await startAutoApply(
      config,
      {
        userId: 'user-1',
        resumeId: 'resume-1',
        resumeVersionId: 'resume-1',
        resumeText: JAVA_RESUME_TEXT,
        masterResumeText: JAVA_RESUME_TEXT,
        profile,
        config: defaultAutoApplyConfig({
          maxJobs: 2,
          minimumMatchRate: 85,
          autoTailorResume: false,
          q: 'Java',
          jobType: 'c2c',
        }),
      },
      undefined,
      { listJobs: async () => ({ jobs: listed }), delayMs: 0 },
    )
    expect(started.items).toHaveLength(2)
    expect(started.items.every((item) => item.c2cStatus === 'confirmed')).toBe(true)
    expect(started.items.every((item) => (item.finalMatchScore ?? 0) >= 85)).toBe(true)
    const duplicate = await startAutoApply(
      config,
      {
        userId: 'user-1',
        resumeId: 'resume-1',
        resumeVersionId: 'resume-1',
        resumeText: JAVA_RESUME_TEXT,
        masterResumeText: JAVA_RESUME_TEXT,
        profile,
        config: defaultAutoApplyConfig({ maxJobs: 10, minimumMatchRate: 85, autoTailorResume: false, q: 'Java', jobType: 'c2c' }),
        existingQueueIdentities: started.items.map((item) => item.identityKey),
      },
      undefined,
      { listJobs: async () => ({ jobs: listed }), delayMs: 0 },
    )
    expect(duplicate.items.every((item) => !started.items.some((queued) => queued.identityKey === item.identityKey))).toBe(true)
  })

  it('keeps concurrency at one claimed browser session and records pause, timeout, and cancel events', async () => {
    const app = createApp({ config })
    const started = await startAutoApply(
      config,
      {
        userId: 'user-1',
        resumeId: 'resume-1',
        resumeVersionId: 'resume-1',
        resumeText: JAVA_RESUME_TEXT,
        masterResumeText: JAVA_RESUME_TEXT,
        profile,
        config: defaultAutoApplyConfig({ maxJobs: 2, minimumMatchRate: 70, autoTailorResume: false, q: 'Java', jobType: 'all' }),
      },
      undefined,
      {
        listJobs: async () => ({
          jobs: [
            job({ id: 'one', title: 'Java One', matchScore: 90 }),
            job({ id: 'two', title: 'Java Two', matchScore: 91 }),
          ],
        }),
        delayMs: 0,
      },
    )
    expect(started.items).toHaveLength(2)
    await request(app).post('/api/automation/extension/register').send({ userId: 'user-1', extensionId: 'test-ext' })
    const peek = await request(app).get('/api/automation/queue/next').query({ peek: '1' }).set('x-jobpilot-user-id', 'user-1')
    expect(peek.body.item.status).toBe('ready')
    const first = await request(app).get('/api/automation/queue/next').set('x-jobpilot-user-id', 'user-1')
    expect(first.body.item.status).toBe('opening')
    const second = await request(app).get('/api/automation/queue/next').set('x-jobpilot-user-id', 'user-1')
    expect(second.body.item.itemId).toBe(first.body.item.itemId)
    const captcha = await request(app).post('/api/automation/events').send({
      userId: 'user-1',
      itemId: first.body.item.itemId,
      type: 'captcha_required',
    })
    expect(captcha.body.item.applicationStatus).toBe('captcha_required')
    const unknown = await request(app).post('/api/automation/events').send({
      userId: 'user-1',
      itemId: first.body.item.itemId,
      type: 'needs_user_input',
      questions: [{ prompt: 'When can you start?' }],
    })
    expect(unknown.body.item.applicationStatus).toBe('needs_user_input')
    expect(unknown.body.item.questions[0].prompt).toMatch(/start/i)
    const timedOut = await request(app).post('/api/automation/events').send({
      userId: 'user-1',
      itemId: first.body.item.itemId,
      type: 'failed',
      reason: 'Application preparation timed out.',
    })
    expect(timedOut.body.item.applicationStatus).toBe('failed')
    const nextAfterFail = await request(app).get('/api/automation/queue/next').set('x-jobpilot-user-id', 'user-1')
    expect(nextAfterFail.body.item.jobTitle).toBe('Java Two')
    const cancelled = await request(app).post('/api/automation/events').send({
      userId: 'user-1',
      itemId: nextAfterFail.body.item.itemId,
      type: 'cancelled',
    })
    expect(cancelled.body.item.applicationStatus).toBe('cancelled')
  })

  it('rejects an invalid application URL instead of opening it', async () => {
    const app = createApp({ config })
    const started = await startAutoApply(
      config,
      {
        userId: 'user-1',
        resumeId: 'resume-1',
        resumeVersionId: 'resume-1',
        resumeText: JAVA_RESUME_TEXT,
        masterResumeText: JAVA_RESUME_TEXT,
        profile,
        config: defaultAutoApplyConfig({ maxJobs: 1, minimumMatchRate: 70, autoTailorResume: false, q: 'Java' }),
      },
      undefined,
      { listJobs: async () => ({ jobs: [job({ id: 'bad', title: 'Java Bad', matchScore: 90, url: 'javascript:alert(1)', jobUrl: 'javascript:alert(1)' })] }), delayMs: 0 },
    )
    expect(started.items).toHaveLength(1)
    await request(app).post('/api/automation/extension/register').send({ userId: 'user-1' })
    const next = await request(app).get('/api/automation/queue/next').set('x-jobpilot-user-id', 'user-1')
    expect(next.body.item).toBeNull()
  })
})
