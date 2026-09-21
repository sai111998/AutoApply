import { describe, expect, it } from 'vitest'
import {
  canEnterAutonomousApply,
  classifyApplicationCapability,
} from './capability'
import { isEligibleForAutoApply } from './eligibility'
import { emptyLiveMatch } from '../jobs/score'
import type { ListedAutoApplyJob } from './types'

function job(partial: Partial<ListedAutoApplyJob> & { id: string; url: string }): ListedAutoApplyJob {
  return {
    title: 'Java Engineer',
    company: 'Acme',
    description: 'Java Spring Boot C2C corp to corp',
    jobUrl: partial.url,
    identityKey: `job-opportunities:${partial.id}`,
    provider: 'jooble',
    providerJobId: partial.id,
    location: 'Austin, TX',
    employmentType: 'Contract',
    postedAt: '2026-09-17T00:00:00.000Z',
    fetchedAt: '2026-09-17T00:00:00.000Z',
    c2cStatus: 'confirmed',
    c2cEvidence: [],
    match: { ...emptyLiveMatch('resume-1'), score: 90 },
    matchScore: 90,
    ...partial,
  }
}

describe('application capability', () => {
  it('does not mark known ATS hosts as auto_apply_supported without workflow preflight', () => {
    const greenhouse = classifyApplicationCapability({ url: 'https://boards.greenhouse.io/acme/jobs/1' })
    expect(greenhouse.capability).toBe('unknown')
    expect(greenhouse.provider).toBe('greenhouse')
    expect(canEnterAutonomousApply(greenhouse.capability)).toBe(false)
    expect(classifyApplicationCapability({ url: 'https://jobs.lever.co/acme/abc' }).provider).toBe('lever')
    expect(classifyApplicationCapability({ url: 'https://jobs.ashbyhq.com/acme/x' }).provider).toBe('ashby')
    expect(classifyApplicationCapability({ url: 'https://acme.wd1.myworkdayjobs.com/en-US/careers' }).provider).toBe(
      'workday',
    )
    expect(classifyApplicationCapability({ url: 'https://acme.icims.com/jobs/1' }).provider).toBe('icims')
  })

  it('keeps job-board listings discovery-only', () => {
    const indeed = classifyApplicationCapability({
      url: 'https://www.indeed.com/viewjob?jk=1',
      discoveryProvider: 'jooble',
    })
    expect(indeed.capability).toBe('unsupported')
    expect(indeed.sourceKind).toBe('discovery_only')
    expect(canEnterAutonomousApply(indeed.capability)).toBe(false)
  })

  it('marks unknown career hosts as unknown rather than auto-apply ready', () => {
    const unknown = classifyApplicationCapability({ url: 'https://careers.unknown-corp.example/apply' })
    expect(unknown.capability).toBe('unknown')
    expect(canEnterAutonomousApply(unknown.capability)).toBe(false)
  })

  it('rejects invalid URLs', () => {
    expect(classifyApplicationCapability({ url: 'javascript:alert(1)' }).capability).toBe('unsupported')
    expect(classifyApplicationCapability({ url: '' }).capability).toBe('unsupported')
  })

  it('allows the synthetic employer and test fixture host', () => {
    expect(classifyApplicationCapability({ url: 'http://127.0.0.1:4173/test-employer' }).capability).toBe(
      'auto_apply_supported',
    )
    expect(classifyApplicationCapability({ url: 'https://jobs.example.com/java' }).capability).toBe('auto_apply_supported')
  })

  it('does not treat a capable discovery source as automatically applicable', () => {
    const listed = job({ id: 'board', url: 'https://www.linkedin.com/jobs/view/1' })
    expect(isEligibleForAutoApply(listed, { minimumMatchRate: 80, finalMatchScore: 90 }).ok).toBe(true)
    expect(canEnterAutonomousApply(classifyApplicationCapability({ url: listed.url }).capability)).toBe(false)
    const greenhouse = job({ id: 'gh', url: 'https://boards.greenhouse.io/acme/jobs/1' })
    expect(isEligibleForAutoApply(greenhouse, { minimumMatchRate: 80, finalMatchScore: 90 }).ok).toBe(true)
  })
})
