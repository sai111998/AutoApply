import { afterEach, describe, expect, it } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import { mkdtempSync } from 'node:fs'
import { classifyC2c } from '../jobs/c2c'
import { emptyLiveMatch } from '../jobs/score'
import { JAVA_RESUME_TEXT } from '../tailor/fixtures'
import { defaultAutoApplyConfig, resetAutoApplyEngineForTests } from '../apply/engine'
import { clearAutoApplyMemory } from '../apply/store'
import { resetExtensionProfilesForTests } from '../extension/profile-store'
import { claimNextBrowserJob, resetBrowserWorkerQueueForTests } from '../browser-worker/queue'
import { createBrowserWorker, resetBrowserWorkerForTests } from '../browser-worker/worker'
import { startSyntheticEmployer } from '../browser-worker/synthetic'
import { inspectApplicationPage } from '../apply/detect'
import { recoverStuckBrowserJobs, shouldNeverAutoRetry } from '../browser-worker/recovery'
import { detectSubmissionConfirmation } from '../apply/confirm'
import { listConfirmedApplications, resetConfirmedApplicationsForTests } from '../apply/confirmed'
import type { AutoApplyProfile, ListedAutoApplyJob } from '../apply/types'
import type { ServerConfig } from '../config'
import {
  resetAgentForTests,
  startCampaign,
  tickCampaign,
  pauseCampaign,
  resumeCampaign,
  cancelCampaign,
  campaignJobEligible,
  meetsMatchThreshold,
  agentIntervalMs,
  DEFAULT_AGENT_INTERVAL_MS,
} from './index'
import { AgentError } from './errors'
import { canSearchAgain } from './policy'

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
  return {
    company: 'Acme',
    description,
    url: partial.url ?? `https://jobs.example.com/${partial.id}`,
    jobUrl: partial.jobUrl ?? partial.url ?? `https://jobs.example.com/${partial.id}`,
    identityKey: `job-opportunities:${partial.id}`,
    provider: 'job-opportunities',
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
  config: defaultAutoApplyConfig({ maxJobs: 2, minimumMatchRate: 85, autoTailorResume: false, q: 'Java', jobType: 'c2c' }),
}

afterEach(async () => {
  resetAgentForTests()
  resetAutoApplyEngineForTests()
  clearAutoApplyMemory()
  resetExtensionProfilesForTests()
  resetBrowserWorkerQueueForTests()
  resetConfirmedApplicationsForTests()
  await resetBrowserWorkerForTests()
})

describe('autonomous campaign agent', () => {
  it('uses a bounded scheduler interval instead of a tight loop', () => {
    expect(agentIntervalMs({} as NodeJS.ProcessEnv)).toBe(DEFAULT_AGENT_INTERVAL_MS)
    expect(agentIntervalMs({ JOBPILOT_AGENT_INTERVAL_MS: '1000' } as NodeJS.ProcessEnv)).toBeGreaterThanOrEqual(30_000)
    expect(canSearchAgain(Date.now(), Date.now() + 1000, 30_000)).toBe(false)
    expect(canSearchAgain(null)).toBe(true)
  })

  it('applies match threshold and C2C-only without changing scores', () => {
    expect(meetsMatchThreshold(85, 85)).toBe(true)
    expect(meetsMatchThreshold(82, 85)).toBe(false)
    const confirmed = job({ id: 'c2c', title: 'C2C Java', description: 'Corp to Corp Java C2C' })
    expect(
      campaignJobEligible(confirmed, { minimumMatchRate: 85, finalMatchScore: 87, jobType: 'c2c' }).ok,
    ).toBe(confirmed.c2cStatus === 'confirmed')
    const w2 = job({ id: 'w2', title: 'W2 Java', description: 'W2 only. No C2C.', matchScore: 90 })
    expect(campaignJobEligible(w2, { minimumMatchRate: 70, finalMatchScore: 90, jobType: 'c2c' }).ok).toBe(false)
  })

  it('queues eligible jobs as queued and running without a per-job Apply click', async () => {
    const started = await startCampaign(
      config,
      startInput,
      {
        deps: {
          delayMs: 0,
          listJobs: async () => ({ jobs: [job({ id: 'java', title: 'Java Engineer' })] }),
        },
      },
    )
    expect(started.items).toHaveLength(1)
    expect(started.items[0].applicationStatus).toBe('queued')
    expect(started.run.status).toBe('running')
    expect(started.items[0].applicationStatus).not.toBe('extension_not_connected')
    const claimed = await claimNextBrowserJob()
    expect(claimed?.item.id).toBe(started.items[0].id)
    expect(claimed?.item.applicationStatus).toBe('opening')
  })

  it('prevents duplicate queue entries across scheduler ticks', async () => {
    const listed = [job({ id: 'same', title: 'Java Engineer' })]
    const started = await startCampaign(config, startInput, {
      deps: { delayMs: 0, listJobs: async () => ({ jobs: listed }) },
    })
    expect(started.items).toHaveLength(1)
    const ticked = await tickCampaign(started.run.id)
    expect(ticked?.items).toHaveLength(1)
    expect(ticked?.added).toBe(0)
  })

  it('discovers newly eligible jobs on a later tick up to maxJobs', async () => {
    let page = 0
    const started = await startCampaign(
      config,
      { ...startInput, config: defaultAutoApplyConfig({ ...startInput.config, maxJobs: 2 }) },
      {
        deps: {
          delayMs: 0,
          listJobs: async () => {
            page += 1
            if (page === 1) return { jobs: [job({ id: 'one', title: 'Java One' })] }
            return {
              jobs: [job({ id: 'one', title: 'Java One' }), job({ id: 'two', title: 'Java Two' })],
            }
          },
        },
      },
    )
    expect(started.items).toHaveLength(1)
    const ticked = await tickCampaign(started.run.id)
    expect(ticked?.items).toHaveLength(2)
    expect(ticked?.added).toBe(1)
    expect(ticked?.items.every((item) => item.applicationStatus === 'queued' || item.applicationStatus === 'opening')).toBe(true)
  })

  it('pauses claiming and resumes the campaign', async () => {
    const started = await startCampaign(config, startInput, {
      deps: { delayMs: 0, listJobs: async () => ({ jobs: [job({ id: 'java', title: 'Java Engineer' })] }) },
    })
    const paused = await pauseCampaign(started.run.id)
    expect(paused.run.status).toBe('paused')
    expect(await claimNextBrowserJob()).toBeNull()
    const resumed = await resumeCampaign(started.run.id)
    expect(resumed.run.status).toBe('running')
    const claimed = await claimNextBrowserJob()
    expect(claimed?.item.id).toBe(started.items[0].id)
  })

  it('cancels queued applications without stopping later independent work', async () => {
    const started = await startCampaign(config, startInput, {
      deps: {
        delayMs: 0,
        listJobs: async () => ({
          jobs: [job({ id: 'one', title: 'Java One' }), job({ id: 'two', title: 'Java Two' })],
        }),
      },
    })
    const cancelled = await cancelCampaign(started.run.id)
    expect(cancelled.run.status).toBe('cancelled')
    expect(cancelled.items.every((item) => item.applicationStatus === 'cancelled')).toBe(true)
    await expect(tickCampaign(started.run.id)).rejects.toBeInstanceOf(AgentError)
  })

  it('does not mark submitted without confirmation and recovers crashed in-progress jobs', () => {
    expect(detectSubmissionConfirmation({ html: '<p>Thanks</p>' }).detected).toBe(false)
    expect(inspectApplicationPage('<div class="g-recaptcha"></div>').status).toBe('captcha_required')
    expect(inspectApplicationPage('<p>authenticator app code</p>').status).toBe('mfa_required')
    expect(inspectApplicationPage('<form>Sign in<input type="password"></form>').status).toBe('login_required')
    const opening = {
      id: 'item-1',
      runId: 'run-1',
      jobId: 'job-1',
      identityKey: 'job-1',
      applicationId: 'app-1',
      resumeVersionId: 'resume-1',
      resumeVersionName: 'Master',
      title: 'Engineer',
      company: 'Acme',
      applicationUrl: 'https://jobs.example.com/apply',
      initialMatchScore: 90,
      finalMatchScore: 90,
      c2cStatus: 'confirmed' as const,
      c2cEvidence: [],
      applicationStatus: 'opening' as const,
      failureReason: null,
      questions: [],
      tailoredResumeText: 'Java',
      jobDescriptionSnapshot: 'Java Spring Boot C2C',
      location: 'Austin, TX',
      confirmationNumber: null,
      confirmationText: null,
      submittedAt: null,
      masterResumeUnchanged: true,
      sessionId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    const submitted = { ...opening, id: 'item-2', applicationStatus: 'submitted' as const }
    recoverStuckBrowserJobs([opening, submitted], { stuckMs: 1, now: Date.now() + 10_000, restart: true })
    expect(opening.applicationStatus).toBe('queued')
    expect(submitted.applicationStatus).toBe('submitted')
    expect(shouldNeverAutoRetry(submitted)).toBe(true)
  })

  it('runs the synthetic employer application through the agent without a Chrome extension', async () => {
    const site = await startSyntheticEmployer()
    const profileDir = mkdtempSync(path.join(os.tmpdir(), 'jobpilot-agent-'))
    const worker = await createBrowserWorker({ headless: true, userDataDir: profileDir, autoSubmit: true })
    try {
      const started = await startCampaign(
        config,
        {
          ...startInput,
          config: defaultAutoApplyConfig({ maxJobs: 1, minimumMatchRate: 70, autoTailorResume: true, q: 'Java', jobType: 'all' }),
        },
        {
          deps: {
            delayMs: 0,
            listJobs: async () => ({
              jobs: [job({ id: 'synth', title: 'Java Engineer', url: site.jobUrl, jobUrl: site.jobUrl })],
            }),
          },
        },
      )
      expect(started.items[0].applicationStatus).toBe('queued')
      expect(listConfirmedApplications('user-1')).toEqual([])
      const processed = await worker.processOnce()
      expect(processed?.applicationStatus).toBe('submitted')
      expect(processed?.failureReason).toBeNull()
      expect(processed?.applicationStatus).not.toBe('extension_not_connected')
      const confirmed = listConfirmedApplications('user-1')
      expect(confirmed).toHaveLength(1)
      expect(confirmed[0]?.status).toBe('applied')
      expect(confirmed[0]?.isConfirmedSubmission).toBe(true)
    } finally {
      await worker.stop()
      await site.close()
    }
  }, 60_000)
})
