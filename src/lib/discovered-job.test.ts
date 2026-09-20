import { describe, expect, it } from 'vitest'
import { applyUrl, discoveredToJob, formatSalary, listingSource, mergeLiveJob, providerLabel } from './discovered-job'
import type { DiscoveredJobResult } from './ai/client'

const sample: DiscoveredJobResult = {
  id: 'aaaaaaaa-aaaa-5aaa-8aaa-aaaaaaaaaaaa',
  provider: 'jooble',
  providerJobId: '111',
  title: 'Senior Java Engineer',
  company: 'Company A',
  location: 'Austin, TX',
  remote: true,
  workArrangement: 'remote',
  employmentType: 'Full-time',
  description: 'Java Spring Boot AWS PostgreSQL',
  jobUrl: 'https://jooble.org/jdp/111',
  postedAt: '2026-09-01T00:00:00.000Z',
  salaryMin: 120000,
  salaryMax: 150000,
  salaryCurrency: 'USD',
  source: 'Jooble',
  discoveredAt: '2026-09-13T00:00:00.000Z',
  lastVerifiedAt: '2026-09-13T00:00:00.000Z',
  identityKey: 'jooble:111',
  matchScore: 94,
  matchedSkills: ['Java', 'Spring Boot', 'AWS', 'PostgreSQL'],
  demo: false,
}

describe('discovered job mapping', () => {
  it('maps a live provider job into the workspace Job model', () => {
    const job = discoveredToJob(sample, 'user-1')
    expect(job.userId).toBe('user-1')
    expect(job.title).toBe('Senior Java Engineer')
    expect(job.provider).toBe('jooble')
    expect(job.description).toMatch(/Java/)
    expect(job.source).toBe('Jooble')
    expect(job.matchScore).toBe(94)
    expect(job.jobUrl).toContain('jooble.org')
  })

  it('labels providers for the UI', () => {
    expect(providerLabel('job-opportunities')).toBe('Job Opportunities API')
    expect(providerLabel('jooble')).toBe('Jooble')
    expect(providerLabel('usajobs')).toBe('USAJOBS')
    expect(providerLabel('greenhouse')).toBe('Greenhouse')
    expect(providerLabel('lever')).toBe('Lever')
    expect(providerLabel('ashby')).toBe('Ashby')
    expect(formatSalary(sample)).toMatch(/120,000/)
    expect(formatSalary({ salaryMin: null, salaryMax: null, salaryCurrency: null })).toBeNull()
  })

  it('preserves the underlying listing source and merges a hydrated live job', () => {
    const live: DiscoveredJobResult = {
      ...sample,
      provider: 'job-opportunities',
      providerJobId: 'ffd759ce-b1fa-4ace-a823-bb0d0595e4ae',
      source: 'Job Opportunities API',
      description: '',
      seniority: 'Senior',
      rawMetadata: { listingSource: 'workday' },
    }
    expect(listingSource(live)).toBe('workday')
    const merged = mergeLiveJob(live, {
      ...live,
      description: 'Full Java posting from the detail endpoint.',
      jobUrl: 'https://flir.wd1.myworkdayjobs.com/flircareers/job/java-engineer',
    })
    expect(merged.description).toMatch(/Full Java posting/)
    expect(merged.jobUrl).toContain('myworkdayjobs.com')
    expect(merged.source).toBe('Job Opportunities API')
    expect(applyUrl(merged)).toContain('myworkdayjobs.com')
    expect(discoveredToJob(merged, 'user-1').seniority).toBe('Senior')
  })
})
