import { afterEach, describe, expect, it } from 'vitest'
import { classifyC2c } from '../jobs/c2c'
import { emptyLiveMatch } from '../jobs/score'
import { JAVA_RESUME_TEXT } from '../tailor/fixtures'
import { defaultAutoApplyConfig, normalizeMinimumMatchRate, resetAutoApplyEngineForTests, startAutoApply } from '../apply/engine'
import { parseAutoApplyStart } from '../apply/parse'
import { isEligibleForAutoApply } from '../apply/eligibility'
import { canEnterAutonomousApply } from '../apply/capability'
import { isApplyError } from '../apply/errors'
import { evaluateJobEligibility } from './pipeline'
import { clearAutoApplyMemory } from '../apply/store'
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

function job(partial: Partial<ListedAutoApplyJob> & { id: string }): ListedAutoApplyJob {
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
    employmentType: partial.employmentType ?? 'Full-time',
    postedAt: '2026-09-17T00:00:00.000Z',
    fetchedAt: '2026-09-17T00:00:00.000Z',
    ...partial,
    c2cStatus: partial.c2cStatus ?? c2c.status,
    c2cEvidence: partial.c2cEvidence ?? c2c.evidence,
    match: partial.match ?? { ...emptyLiveMatch('resume-1'), score: 90, matchedSkills: ['Java'], missingSkills: [] },
    matchScore: Object.prototype.hasOwnProperty.call(partial, 'matchScore')
      ? (partial.matchScore as number | null)
      : 90,
  }
}

function start(partial: Parameters<typeof defaultAutoApplyConfig>[0] = {}) {
  return {
    userId: 'user-1',
    resumeId: 'resume-1',
    resumeVersionId: 'resume-1',
    resumeText: JAVA_RESUME_TEXT,
    masterResumeText: JAVA_RESUME_TEXT,
    profile,
    config: defaultAutoApplyConfig({
      maxJobs: 5,
      minimumMatchRate: 70,
      autoTailorResume: true,
      jobType: 'all',
      remotePreference: 'any',
      keywords: [],
      q: 'Java',
      ...partial,
    }),
  }
}

afterEach(() => {
  resetAutoApplyEngineForTests()
  clearAutoApplyMemory()
})

describe('eligibility vs capability pipeline', () => {
  it('normalizes 70%, 0.70, and 70 to the same threshold', () => {
    expect(normalizeMinimumMatchRate(70)).toBe(70)
    expect(normalizeMinimumMatchRate(0.7)).toBe(70)
    expect(normalizeMinimumMatchRate(85)).toBe(85)
    const parsed = parseAutoApplyStart({
      userId: 'user-1',
      resumeText: JAVA_RESUME_TEXT,
      config: { minimumMatchRate: '70%', maxJobs: 5, jobType: 'all' },
    })
    expect(parsed.config.minimumMatchRate).toBe(70)
    expect(parsed.config.jobType).toBe('all')
    expect(parsed.config.remotePreference).toBe('any')
    expect(parsed.config.keywords).toEqual([])
  })

  it('keeps a 70 current score eligible and rejects 69 without tailoring', () => {
    const pass = evaluateJobEligibility(job({ id: 'pass', matchScore: 70, match: { ...emptyLiveMatch('resume-1'), score: 70 } }), {
      startInput: start({ autoTailorResume: false, minimumMatchRate: 70 }),
    })
    expect(pass.ok).toBe(true)
    const fail = evaluateJobEligibility(job({ id: 'fail', matchScore: 69, match: { ...emptyLiveMatch('resume-1'), score: 69 } }), {
      startInput: start({ autoTailorResume: false, minimumMatchRate: 70 }),
    })
    expect(fail.ok).toBe(false)
    expect(fail.stage).toBe('current_match')
  })

  it('auto-tailors before rejecting a below-threshold current score', () => {
    const evaluated = evaluateJobEligibility(
      job({
        id: 'low',
        title: 'Java Engineer',
        description: 'Java Spring Boot services, REST APIs, and SQL. C2C.',
        matchScore: 40,
        match: { ...emptyLiveMatch('resume-1'), score: 40, matchedSkills: ['Java'], missingSkills: [] },
      }),
      { startInput: start({ autoTailorResume: true, minimumMatchRate: 50, jobType: 'all' }) },
    )
    expect(evaluated.tailoredScore).not.toBeNull()
    expect(evaluated.ok).toBe(true)
    expect(evaluated.resumeVersionName).toMatch(/Tailored/)
  })

  it('does not require C2C when C2C is off and does require it when C2C is on', () => {
    const w2 = job({ id: 'w2', title: 'W2 Java', description: 'W2 only. No C2C.', c2cStatus: 'not_allowed' })
    expect(evaluateJobEligibility(w2, { startInput: start({ jobType: 'all', autoTailorResume: false }) }).ok).toBe(true)
    expect(evaluateJobEligibility(w2, { startInput: start({ jobType: 'c2c', autoTailorResume: false }) }).ok).toBe(false)
  })

  it('does not filter empty keywords, job type all, or remote any', async () => {
    const listed = [
      job({ id: 'onsite', title: 'Java Engineer', location: 'Austin, TX', employmentType: 'Full-time' }),
      job({ id: 'remote', title: 'Java Engineer', location: 'Remote', employmentType: 'Contract' }),
    ]
    const started = await startAutoApply(config, start({ keywords: [], jobType: 'all', remotePreference: 'any', autoTailorResume: false }), undefined, {
      delayMs: 0,
      listJobs: async () => ({ jobs: listed }),
    })
    expect(started.run.counts.found).toBe(2)
    expect(started.run.counts.eligible).toBe(2)
  })

  it('counts unsupported providers as eligible without queuing them', async () => {
    const started = await startAutoApply(
      config,
      start({ autoTailorResume: false, jobType: 'all' }),
      undefined,
      {
        delayMs: 0,
        listJobs: async () => ({
          jobs: [
            job({ id: 'indeed', url: 'https://www.indeed.com/viewjob?jk=1', jobUrl: 'https://www.indeed.com/viewjob?jk=1' }),
            job({ id: 'ready', url: 'https://jobs.example.com/ready' }),
          ],
        }),
      },
    )
    expect(started.run.counts.eligible).toBe(2)
    expect(started.run.counts.autoApplyCapable).toBe(1)
    expect(started.items.map((item) => item.jobId)).toEqual(['ready'])
    expect(
      isEligibleForAutoApply(job({ id: 'indeed', url: 'https://www.indeed.com/viewjob?jk=1' }), {
        minimumMatchRate: 70,
        finalMatchScore: 90,
      }).ok,
    ).toBe(true)
    expect(canEnterAutonomousApply('unsupported')).toBe(false)
  })

  it('does not treat a missing score as 0 or 100', () => {
    const missing = evaluateJobEligibility(
      job({
        id: 'missing',
        description: '',
        matchScore: null,
        match: { ...emptyLiveMatch('resume-1'), score: null },
      }),
      { startInput: start({ autoTailorResume: false }) },
    )
    expect(missing.ok).toBe(false)
    expect(missing.initialScore).toBeNull()
    expect(missing.finalScore).toBeNull()
    expect(missing.code).toBe('MATCH_ERROR')
  })

  it('surfaces DISCOVERY_FAILED instead of zero eligible', async () => {
    await expect(
      startAutoApply(config, start(), undefined, {
        delayMs: 0,
        listJobs: async () => {
          throw new Error('network down')
        },
      }),
    ).rejects.toSatisfy((error) => isApplyError(error) && error.code === 'DISCOVERY_FAILED')
  })

  it('does not stop eligibility counting at maxJobs/day', async () => {
    const listed = Array.from({ length: 8 }, (_, index) => job({ id: `job-${index}`, matchScore: 90 }))
    const started = await startAutoApply(config, start({ maxJobs: 5, autoTailorResume: false }), undefined, {
      delayMs: 0,
      listJobs: async () => ({ jobs: listed }),
    })
    expect(started.run.counts.found).toBe(8)
    expect(started.run.counts.eligible).toBe(8)
    expect(started.items).toHaveLength(5)
  })

  it('uses an 85% threshold without falling back to 70', () => {
    const pass = evaluateJobEligibility(
      job({ id: 'pass-85', matchScore: 85, match: { ...emptyLiveMatch('resume-1'), score: 85 } }),
      { startInput: start({ autoTailorResume: false, minimumMatchRate: 85 }) },
    )
    const fail = evaluateJobEligibility(
      job({ id: 'fail-85', matchScore: 84, match: { ...emptyLiveMatch('resume-1'), score: 84 } }),
      { startInput: start({ autoTailorResume: false, minimumMatchRate: 85 }) },
    )
    expect(pass.ok).toBe(true)
    expect(fail.ok).toBe(false)
    expect(fail.stage).toBe('current_match')
  })

  it('auto-tailors a 68 current score above a 70 threshold', () => {
    const evaluated = evaluateJobEligibility(
      job({
        id: 'borderline',
        title: 'Java Engineer',
        description: 'Java Spring Boot services, REST APIs, SQL, and microservices. C2C.',
        matchScore: 68,
        match: { ...emptyLiveMatch('resume-1'), score: 68, matchedSkills: ['Java'], missingSkills: [] },
      }),
      { startInput: start({ autoTailorResume: true, minimumMatchRate: 70, jobType: 'all' }) },
    )
    expect(evaluated.initialScore).toBe(68)
    expect(evaluated.tailoredScore).not.toBeNull()
    expect(evaluated.resumeVersionName).toMatch(/Tailored/)
    expect(evaluated.ok).toBe(true)
    expect(evaluated.finalScore).toBeGreaterThanOrEqual(70)
  })

  it('keeps eligible counts when capability lookup fails', async () => {
    const started = await startAutoApply(config, start({ autoTailorResume: false, jobType: 'all' }), undefined, {
      delayMs: 0,
      listJobs: async () => ({
        jobs: [job({ id: 'ready', url: 'https://jobs.example.com/ready', matchScore: 90 })],
      }),
      preflightJob: async () => {
        throw new Error('capability probe down')
      },
    })
    expect(started.run.counts.eligible).toBe(1)
    expect(started.run.counts.autoApplyCapable).toBe(0)
    expect(started.items).toHaveLength(0)
    expect(started.funnel.capabilityErrors).toBe(1)
    expect(started.funnel.code).toBe('CAPABILITY_ERROR')
  })

  it('surfaces MATCH_ERROR instead of zero eligible when scores cannot be computed', async () => {
    await expect(
      startAutoApply(config, start({ autoTailorResume: false }), undefined, {
        delayMs: 0,
        listJobs: async () => ({
          jobs: [
            job({
              id: 'unscored',
              description: '',
              matchScore: null,
              match: { ...emptyLiveMatch('resume-1'), score: null },
            }),
          ],
        }),
      }),
    ).rejects.toSatisfy((error) => isApplyError(error) && error.code === 'MATCH_ERROR')
  })

  it('surfaces FILTER_ERROR instead of zero eligible when filtering throws', async () => {
    await expect(
      startAutoApply(config, start(), undefined, {
        delayMs: 0,
        listJobs: async () => ({ jobs: [null as unknown as ListedAutoApplyJob] }),
      }),
    ).rejects.toSatisfy((error) => isApplyError(error) && error.code === 'FILTER_ERROR')
  })

  it('does not use a stale default 85 when 70 is provided as 0.70', async () => {
    const parsed = parseAutoApplyStart({
      userId: 'user-1',
      resumeText: JAVA_RESUME_TEXT,
      config: { minimumMatchRate: 0.7, maxJobs: 5, jobType: 'all', remotePreference: 'any' },
    })
    expect(parsed.config.minimumMatchRate).toBe(70)
    const started = await startAutoApply(
      config,
      start({ minimumMatchRate: 0.7, autoTailorResume: false }),
      undefined,
      {
        delayMs: 0,
        listJobs: async () => ({
          jobs: [
            job({ id: 'mid', matchScore: 72, match: { ...emptyLiveMatch('resume-1'), score: 72 } }),
            job({ id: 'high', matchScore: 90, match: { ...emptyLiveMatch('resume-1'), score: 90 } }),
          ],
        }),
      },
    )
    expect(started.run.config.minimumMatchRate).toBe(70)
    expect(started.run.counts.eligible).toBe(2)
    expect(started.funnel.threshold).toBe(70)
  })

  it('does not treat 7000 as a valid stored threshold', () => {
    expect(normalizeMinimumMatchRate(7000)).toBe(99)
    expect(normalizeMinimumMatchRate(70)).toBe(70)
    expect(normalizeMinimumMatchRate(0.7)).toBe(70)
  })
})
