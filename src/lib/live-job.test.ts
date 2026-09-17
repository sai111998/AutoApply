import { describe, expect, it } from 'vitest'
import type { DiscoveredJobResult } from './ai/client'
import { jobMetaLine, sortDiscoveredJobs, topSkills, workArrangementLabel } from './live-job'

function job(partial: Partial<DiscoveredJobResult> & Pick<DiscoveredJobResult, 'id' | 'title'>): DiscoveredJobResult {
  return {
    provider: 'job-opportunities',
    providerJobId: partial.id,
    company: 'Example',
    location: 'Chicago, IL',
    remote: false,
    workArrangement: 'hybrid',
    employmentType: 'Full-time',
    description: 'Java Spring Boot',
    jobUrl: 'https://jobs.example.com/apply',
    postedAt: '2026-09-01T00:00:00.000Z',
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    source: 'Job Opportunities API',
    discoveredAt: '2026-09-01T00:00:00.000Z',
    lastVerifiedAt: '2026-09-01T00:00:00.000Z',
    identityKey: `job-opportunities:${partial.id}`,
    matchScore: null,
    matchedSkills: [],
    missingSkills: [],
    demo: false,
    ...partial,
  }
}

describe('live job presentation', () => {
  it('keeps cards compact and hides technical provider fields', () => {
    const listing = job({
      id: '1',
      title: 'Senior Java Software Engineer',
      match: {
        score: 82,
        matchedSkills: ['Java', 'Spring Boot', 'AWS', 'REST'],
        missingSkills: ['Kubernetes', 'Kafka', 'Terraform'],
        resumeVersionId: 'resume-1',
        scoreUpdatedAt: '2026-09-17T00:00:00.000Z',
      },
    })
    expect(jobMetaLine(listing)).toBe('Chicago, IL • Hybrid • Full-time')
    expect(workArrangementLabel(listing)).toBe('Hybrid')
    expect(topSkills(listing.match?.matchedSkills)).toEqual(['Java', 'Spring Boot', 'AWS'])
    expect(topSkills(listing.match?.missingSkills)).toEqual(['Kubernetes', 'Kafka', 'Terraform'])
  })

  it('sorts by match score high to low by default', () => {
    const jobs = [
      job({ id: 'low', title: 'A', matchScore: 40, postedAt: '2026-09-10T00:00:00.000Z' }),
      job({ id: 'high', title: 'B', matchScore: 88, postedAt: '2026-09-01T00:00:00.000Z' }),
      job({ id: 'mid', title: 'C', matchScore: 71, postedAt: '2026-09-05T00:00:00.000Z' }),
    ]
    expect(sortDiscoveredJobs(jobs, 'match').map((item) => item.id)).toEqual(['high', 'mid', 'low'])
    expect(sortDiscoveredJobs(jobs, 'recent').map((item) => item.id)).toEqual(['low', 'mid', 'high'])
  })
})
