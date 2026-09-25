import { afterEach, describe, expect, it } from 'vitest'
import { classifyC2c } from '../jobs/c2c'
import { emptyLiveMatch } from '../jobs/score'
import { JAVA_RESUME_TEXT } from '../tailor/fixtures'
import { defaultAutoApplyConfig, resetAutoApplyEngineForTests, startAutoApply } from '../apply/engine'
import { clearAutoApplyMemory } from '../apply/store'
import { canEnterAutonomousApply } from '../apply/capability'
import { evaluateJobEligibility } from '../agent/pipeline'
import { startCampaign, resetAgentForTests } from '../agent'
import { claimNextBrowserJob, resetBrowserWorkerQueueForTests } from '../browser-worker/queue'
import { touchWorkerHeartbeat, readAutomationHeartbeats, resetAutomationHeartbeatsForTests } from './heartbeat'
import { getCandidateProfile } from '../application/candidate-store'
import { listConfirmedApplications, resetConfirmedApplicationsForTests, shouldPersistConfirmedApplication } from '../apply/confirmed'
import type { AutoApplyProfile, ListedAutoApplyJob } from '../apply/types'
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

function job(partial: Partial<ListedAutoApplyJob> & { id: string; title: string; url?: string }): ListedAutoApplyJob {
  const description = partial.description ?? 'Java Spring Boot full stack software engineer'
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
    employmentType: 'Full-time',
    postedAt: '2026-09-17T00:00:00.000Z',
    fetchedAt: '2026-09-17T00:00:00.000Z',
    ...partial,
    c2cStatus: partial.c2cStatus ?? c2c.status,
    c2cEvidence: partial.c2cEvidence ?? c2c.evidence,
    match: partial.match ?? { ...emptyLiveMatch('resume-1'), score: 88, matchedSkills: ['Java'], missingSkills: [] },
    matchScore: partial.matchScore ?? 88,
  }
}

afterEach(() => {
  resetAgentForTests()
  resetAutoApplyEngineForTests()
  clearAutoApplyMemory()
  resetBrowserWorkerQueueForTests()
  resetAutomationHeartbeatsForTests()
  resetConfirmedApplicationsForTests()
})

describe('agent to queue', () => {
  it('keeps jobs eligible when Job Type is ALL, Remote is ANY, C2C is OFF, and keywords are empty', () => {
    const listed = job({
      id: 'open',
      title: 'Senior Java Engineer',
      location: 'New York, NY',
      employmentType: 'Contract',
    })
    const evaluated = evaluateJobEligibility(listed, {
      startInput: {
        userId: 'user-1',
        resumeId: 'resume-1',
        resumeVersionId: 'resume-1',
        resumeText: JAVA_RESUME_TEXT,
        masterResumeText: JAVA_RESUME_TEXT,
        profile,
        config: defaultAutoApplyConfig({
          maxJobs: 1,
          minimumMatchRate: 70,
          autoTailorResume: false,
          jobType: 'all',
          remotePreference: 'any',
          keywords: [],
          employmentType: 'any',
        }),
      },
    })
    expect(evaluated.ok).toBe(true)
  })

  it('queues an eligible synthetic job when capability is auto_apply_supported', async () => {
    const listed = job({ id: 'synth', title: 'Java Engineer', url: 'https://jobs.example.com/test-employer' })
    const started = await startCampaign(
      config,
      {
        userId: 'user-1',
        resumeId: 'resume-1',
        resumeVersionId: 'resume-1',
        resumeText: JAVA_RESUME_TEXT,
        masterResumeText: JAVA_RESUME_TEXT,
        profile,
        config: defaultAutoApplyConfig({
          maxJobs: 1,
          minimumMatchRate: 70,
          autoTailorResume: false,
          q: 'Java',
          jobType: 'all',
          remotePreference: 'any',
          keywords: [],
          employmentType: 'any',
        }),
      },
      { deps: { delayMs: 0, listJobs: async () => ({ jobs: [listed] }) }, schedule: false },
    )
    expect(started.run.counts.eligible).toBe(1)
    expect(started.run.counts.autoApplyCapable).toBe(1)
    expect(started.items).toHaveLength(1)
    expect(started.items[0]?.applicationCapability).toBe('auto_apply_supported')
    expect(getCandidateProfile('user-1')?.profile.email).toBeTruthy()
    const claimed = await claimNextBrowserJob()
    expect(claimed?.item.applicationStatus).toBe('opening')
    touchWorkerHeartbeat()
    expect(readAutomationHeartbeats().worker.running).toBe(true)
  })

  it('keeps the job eligible when capability is unsupported', () => {
    const listed = job({
      id: 'indeed',
      title: 'Java Engineer',
      url: 'https://www.indeed.com/viewjob?jk=1',
    })
    const evaluated = evaluateJobEligibility(listed, {
      startInput: {
        userId: 'user-1',
        resumeId: 'resume-1',
        resumeVersionId: 'resume-1',
        resumeText: JAVA_RESUME_TEXT,
        masterResumeText: JAVA_RESUME_TEXT,
        profile,
        config: defaultAutoApplyConfig({
          maxJobs: 1,
          minimumMatchRate: 70,
          autoTailorResume: false,
          jobType: 'all',
          remotePreference: 'any',
          keywords: [],
        }),
      },
    })
    expect(evaluated.ok).toBe(true)
    expect(canEnterAutonomousApply(evaluated.capability)).toBe(false)
  })

  it('discovers the local test employer through listLiveJobs and queues it', async () => {
    const started = await startCampaign(
      { ...config, port: 8787 },
      {
        userId: 'user-1',
        resumeId: 'resume-1',
        resumeVersionId: 'resume-1',
        resumeText: JAVA_RESUME_TEXT,
        masterResumeText: JAVA_RESUME_TEXT,
        profile,
        config: defaultAutoApplyConfig({
          maxJobs: 1,
          minimumMatchRate: 70,
          autoTailorResume: false,
          q: '',
          jobType: 'all',
          remotePreference: 'any',
          keywords: [],
          employmentType: 'any',
          includeSynthetic: true,
        }),
      },
      { schedule: false },
    )
    expect(started.run.counts.eligible).toBeGreaterThan(0)
    expect(started.run.counts.autoApplyCapable).toBeGreaterThan(0)
    expect(started.items[0]?.company).toBe('Test Employer')
    expect(started.items[0]?.applicationCapability).toBe('auto_apply_supported')
    expect(started.items[0]?.applicationUrl).toMatch(/\/test-employer/)
  })
})

describe('confirmed persistence', () => {
  it('does not persist queued or ready items as Applied', async () => {
    const listed = job({ id: 'synth', title: 'Java Engineer', url: 'https://jobs.example.com/test-employer' })
    const started = await startAutoApply(
      config,
      {
        userId: 'user-1',
        resumeId: 'resume-1',
        resumeVersionId: 'resume-1',
        resumeText: JAVA_RESUME_TEXT,
        masterResumeText: JAVA_RESUME_TEXT,
        profile,
        config: defaultAutoApplyConfig({ maxJobs: 1, minimumMatchRate: 70, autoTailorResume: false }),
      },
      undefined,
      { delayMs: 0, listJobs: async () => ({ jobs: [listed] }) },
    )
    expect(shouldPersistConfirmedApplication(started.items[0])).toBe(false)
    expect(listConfirmedApplications('user-1')).toEqual([])
  })
})
