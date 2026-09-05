import { describe, expect, it } from 'vitest'
import { extractJobLocal, extractResumeEvidence, extractResumeLocal } from './extract-local'
import { findLexiconTerms } from './lexicon'

const JAVA_RESUME = `Jordan Hale
Summary
Software Engineer with experience in Java development.
Experience
Backend Engineer, Northwind — 2021 to present
- Developed Java and Spring Boot applications for payments APIs.
- Owned PostgreSQL schema changes for billing.
- Worked with Docker in CI.
Backend Engineer, Harbor Software — 2018 to 2021
- Built REST APIs in Java.
- Supported AWS-based services.
Skills
Java, Python, React, AWS, Docker, Spring Boot, PostgreSQL
`

describe('local JD and resume extraction', () => {
  it('extracts required vs preferred skills and does not treat Docker as Kubernetes', () => {
    const job = extractJobLocal(
      'Senior Java Software Engineer to build payment APIs with Java, Spring Boot, and PostgreSQL. Docker experience is preferred. Kubernetes is required for deployment automation. Terraform experience is a plus.',
    )
    expect(job.requiredSkills.map((item) => item.name)).toEqual(
      expect.arrayContaining(['Java', 'Spring Boot', 'PostgreSQL', 'Kubernetes']),
    )
    expect(job.preferredSkills.map((item) => item.name)).toEqual(expect.arrayContaining(['Docker', 'Terraform']))
    expect(job.requiredSkills.some((item) => item.name === 'Docker')).toBe(false)
    expect(job.requiredSkills.some((item) => item.name === 'Terraform')).toBe(false)
  })

  it('extracts REST APIs from experience bullets even when they are absent from Skills', () => {
    const resume = extractResumeLocal(JAVA_RESUME)
    expect(resume.skills.map((item) => item.name)).toEqual(expect.arrayContaining(['Java', 'Spring Boot', 'REST APIs', 'PostgreSQL', 'Docker']))
    const evidence = extractResumeEvidence(JAVA_RESUME)
    expect(evidence.some((item) => item.technology === 'Spring Boot' && /Northwind/.test(item.source))).toBe(true)
  })

  it('does not infer Kubernetes from Docker in the lexicon scanner', () => {
    const terms = findLexiconTerms('Worked with Docker in CI. Built REST APIs in Java.')
    const names = terms.map((item) => item.name)
    expect(names).toEqual(expect.arrayContaining(['Docker', 'REST APIs', 'Java', 'CI/CD']))
    expect(names).not.toContain('Kubernetes')
    expect(names).not.toContain('Terraform')
    expect(names).not.toContain('Go')
  })
})
