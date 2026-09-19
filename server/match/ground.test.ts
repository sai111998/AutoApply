import { describe, expect, it } from 'vitest'
import { scoreMatch } from './engine'
import { emptyJobProfile, emptyResumeProfile, mergeJobSkills } from './ground'
import type { ResumeProfile } from './types'

const alignedResume: ResumeProfile = {
  ...emptyResumeProfile(),
  skills: [
    { name: 'Java', evidence: 'Java services', years: 5 },
    { name: 'Spring Boot', evidence: 'Spring Boot APIs' },
    { name: 'REST APIs', evidence: 'REST APIs' },
    { name: 'AWS', evidence: 'AWS deployments' },
    { name: 'PostgreSQL', evidence: 'PostgreSQL' },
    { name: 'Docker', evidence: 'Docker' },
    { name: 'Jenkins', evidence: 'Jenkins' },
    { name: 'JUnit', evidence: 'JUnit' },
    { name: 'Mockito', evidence: 'Mockito' },
  ],
  yearsOfExperience: 5,
  education: [{ degree: 'B.S.', field: 'Computer Science', evidence: 'B.S., Computer Science' }],
  location: 'Remote',
  workArrangement: 'remote',
}

describe('mergeJobSkills', () => {
  it('does not promote preferred category extras into required skills', () => {
    const job = {
      ...emptyJobProfile(),
      requiredSkills: [
        { name: 'Java' },
        { name: 'Spring Boot' },
        { name: 'REST APIs' },
        { name: 'AWS' },
        { name: 'PostgreSQL' },
        { name: 'Docker' },
        { name: 'Jenkins' },
        { name: 'JUnit' },
        { name: 'Mockito' },
      ],
      preferredSkills: [{ name: 'Kubernetes' }],
      tools: [{ name: 'Kubernetes' }, { name: 'Terraform' }, { name: 'Docker' }],
      languages: [{ name: 'Java' }],
      frameworks: [{ name: 'Spring Boot' }],
      cloud: [{ name: 'AWS' }],
      databases: [{ name: 'PostgreSQL' }],
    }
    const merged = mergeJobSkills(job)
    expect(merged.required.map((item) => item.name)).not.toContain('Kubernetes')
    expect(merged.required.map((item) => item.name)).not.toContain('Terraform')
    expect(merged.preferred.map((item) => item.name)).toEqual(expect.arrayContaining(['Kubernetes', 'Terraform']))

    const report = scoreMatch(
      alignedResume,
      job,
      '5+ years software engineering. Java, Spring Boot, REST APIs, AWS, PostgreSQL, Docker, Jenkins, JUnit, Mockito. B.S., Computer Science.',
    )
    expect(report.requiredSkills.missing).toHaveLength(0)
    expect(report.matchScore).toBeGreaterThanOrEqual(80)
    expect(report.matchScore).not.toBe(49)
    expect(report.preferredSkills.missing.some((item) => /kubernetes|terraform/i.test(item.name))).toBe(true)
  })

  it('uses category extras as required only when no required list was extracted', () => {
    const job = {
      ...emptyJobProfile(),
      requiredSkills: [],
      preferredSkills: [{ name: 'Kubernetes' }],
      languages: [{ name: 'Java' }],
      frameworks: [{ name: 'Spring Boot' }],
    }
    const merged = mergeJobSkills(job)
    expect(merged.required.map((item) => item.name)).toEqual(expect.arrayContaining(['Java', 'Spring Boot']))
    expect(merged.required.map((item) => item.name)).not.toContain('Kubernetes')
    expect(merged.preferred.map((item) => item.name)).toContain('Kubernetes')
  })
})
