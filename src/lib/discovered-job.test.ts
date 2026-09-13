import { describe, expect, it } from 'vitest'
import { discoveredToJob, formatSalary, providerLabel } from './discovered-job'
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
  })

  it('labels providers for the UI', () => {
    expect(providerLabel('crucive')).toBe('Crucive')
    expect(providerLabel('jooble')).toBe('Jooble')
    expect(providerLabel('usajobs')).toBe('USAJOBS')
    expect(formatSalary(sample)).toMatch(/120,000/)
    expect(formatSalary({ salaryMin: null, salaryMax: null, salaryCurrency: null })).toBeNull()
  })
})
