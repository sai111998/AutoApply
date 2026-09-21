import { describe, expect, it } from 'vitest'
import { classifyC2c } from '../jobs/c2c'
import { emptyLiveMatch } from '../jobs/score'
import { JAVA_RESUME_TEXT } from '../tailor/fixtures'
import { defaultAutoApplyConfig } from '../apply/engine'
import type { AutoApplyProfile, AutoApplyStartInput, ListedAutoApplyJob } from '../apply/types'
import { ELIGIBILITY_STAGES, evaluateJobEligibility } from './pipeline'

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
    location: 'Austin, TX',
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

const startInput: AutoApplyStartInput = {
  userId: 'user-1',
  resumeId: 'resume-1',
  resumeVersionId: 'resume-1',
  resumeText: JAVA_RESUME_TEXT,
  masterResumeText: JAVA_RESUME_TEXT,
  profile,
  config: defaultAutoApplyConfig({ maxJobs: 2, minimumMatchRate: 85, autoTailorResume: false, q: 'Java', jobType: 'c2c' }),
}

describe('job eligibility pipeline', () => {
  it('uses the required stage order', () => {
    expect(ELIGIBILITY_STAGES).toEqual([
      'discover',
      'normalize',
      'deduplicate',
      'validate',
      'current_match',
      'c2c',
      'application_capability',
      'auto_tailor',
      're_score',
      'final_eligibility',
      'queue',
    ])
  })

  it('queues only auto-apply capable jobs that meet match and C2C rules', () => {
    const ready = evaluateJobEligibility(job({ id: 'ready', title: 'Java Engineer' }), { startInput })
    expect(ready.ok).toBe(true)
    expect(ready.stage).toBe('queue')
    const board = evaluateJobEligibility(
      job({ id: 'indeed', title: 'Java Engineer', url: 'https://www.indeed.com/viewjob?jk=1', jobUrl: 'https://www.indeed.com/viewjob?jk=1' }),
      { startInput },
    )
    expect(board.ok).toBe(false)
    expect(board.stage).toBe('application_capability')
    const w2 = evaluateJobEligibility(job({ id: 'w2', title: 'W2 Java', description: 'W2 only. No C2C.' }), { startInput })
    expect(w2.ok).toBe(false)
    expect(w2.stage).toBe('c2c')
    const low = evaluateJobEligibility(
      job({
        id: 'low',
        title: 'Java Engineer',
        matchScore: 70,
        match: { ...emptyLiveMatch('resume-1'), score: 70, matchedSkills: ['Java'], missingSkills: [] },
      }),
      { startInput },
    )
    expect(low.ok).toBe(false)
    expect(low.stage).toBe('current_match')
  })

  it('deduplicates existing applications and queue identities', () => {
    const listed = job({ id: 'same', title: 'Java Engineer' })
    const duplicate = evaluateJobEligibility(listed, {
      startInput: {
        ...startInput,
        existingApplications: [{ jobId: 'same', status: 'applied' }],
      },
    })
    expect(duplicate.ok).toBe(false)
    expect(duplicate.stage).toBe('deduplicate')
    const queued = evaluateJobEligibility(listed, {
      startInput,
      existingIdentities: [listed.identityKey],
    })
    expect(queued.ok).toBe(false)
    expect(queued.stage).toBe('deduplicate')
  })

  it('auto-tailors from the master resume and skips when the re-score stays below threshold', () => {
    const tailored = evaluateJobEligibility(job({ id: 'ready', title: 'Java Engineer' }), {
      startInput: {
        ...startInput,
        config: { ...startInput.config, autoTailorResume: true, jobType: 'all', minimumMatchRate: 50 },
      },
    })
    expect(tailored.ok).toBe(true)
    expect(tailored.resumeVersionName).toMatch(/Tailored/)
    expect(tailored.tailoredText).toBeTruthy()
    expect(tailored.tailoredText).not.toMatch(/invented-certification/i)
    const skipped = evaluateJobEligibility(
      job({
        id: 'gap',
        title: 'Go Kubernetes Engineer',
        description: 'Required: Kubernetes Terraform Go only. No Java.',
        matchScore: 40,
        match: { ...emptyLiveMatch('resume-1'), score: 40, matchedSkills: [], missingSkills: ['Kubernetes'] },
      }),
      {
        startInput: {
          ...startInput,
          config: { ...startInput.config, autoTailorResume: true, jobType: 'all', minimumMatchRate: 95 },
        },
      },
    )
    expect(skipped.ok).toBe(false)
    expect(['auto_tailor', 're_score', 'final_eligibility']).toContain(skipped.stage)
  })
})
