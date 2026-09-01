import { describe, expect, it } from 'vitest'
import { scoreMatch } from '../match/engine'
import { extractJobLocal, extractResumeLocal } from '../match/extract-local'
import { conservativeTailor } from './engine'
import type { TailoredResume } from './types'

const JAVA_RESUME_TEXT = `Jordan Hale
Austin, TX
jordan.hale@example.com

Summary
Software Engineer with experience in Java development.

Experience
Backend Engineer, Northwind — 2021 to present
- Developed Java and Spring Boot applications for payments APIs.
- Owned PostgreSQL schema changes for billing.
- Worked with Docker in CI.
- Reduced checkout errors by adding contract tests.

Backend Engineer, Harbor Software — 2018 to 2021
- Built REST APIs in Java.
- Supported AWS-based services.

Skills
Java, Python, React, AWS, Docker, Spring Boot, PostgreSQL

Education
B.S., Computer Science, State University

Certifications
AWS Certified Developer

Projects
Billing API
`

export const JAVA_BACKEND_JD = `Senior Java Software Engineer

Required qualifications:
- 3+ years of experience
- Java
- Spring Boot and Spring framework
- Build and maintain RESTful APIs
- PostgreSQL or a relational database
- Cloud-native AWS applications
- Docker
- CI/CD
- Bachelor's degree in Computer Science

Preferred:
- Kubernetes
- Terraform
- Go
- React
- TypeScript
- JUnit and Mockito
- Microservices

Responsibilities:
- Develop scalable Java/Spring Boot backend services
- Design REST APIs for payment platforms
- Own PostgreSQL schema and data access
- Deploy AWS services
- Containerize applications with Docker
- Maintain CI/CD pipelines
`

const MISSING_STACK_JD = `${JAVA_BACKEND_JD}

Also required:
- Kubernetes administration
- Terraform
- Go
`

function tailoredResumeToText(resume: TailoredResume): string {
  const lines: string[] = [resume.summary, `Skills\n${resume.skills.join(', ')}`, 'Experience']
  for (const role of resume.experience) {
    lines.push(`${role.title}, ${role.company} — ${role.dates}`)
    for (const bullet of role.bullets) lines.push(`- ${bullet}`)
  }
  return lines.join('\n')
}

describe('Java backend tailoring alignment', () => {
  it('makes supported JD requirements prominent without inventing missing stack items', () => {
    const originalProfile = extractResumeLocal(JAVA_RESUME_TEXT)
    const jobProfile = extractJobLocal(JAVA_BACKEND_JD)
    const before = scoreMatch(originalProfile, jobProfile, JAVA_RESUME_TEXT)

    const result = conservativeTailor({
      resumeText: JAVA_RESUME_TEXT,
      jobDescription: JAVA_BACKEND_JD,
      resumeProfile: originalProfile,
      jobProfile,
      matchReport: before,
    })

    expect(result.status).toBe('complete')
    expect(result.validation.ok).toBe(true)
    expect(result.validation.factualValidation).toBe(true)
    expect(result.validation.qualityScore).toBeGreaterThan(0)
    expect(result.plan.coverage?.requiredTotal).toBeGreaterThan(0)

    const tailored = result.tailored!
    const blob = [tailored.summary, tailored.skills.join(' '), ...tailored.experience.flatMap((role) => role.bullets)].join('\n')

    expect(tailored.skills.slice(0, 8).join(' ')).toMatch(/Java/)
    expect(blob).toMatch(/Spring Boot/)
    expect(blob).toMatch(/REST API/)
    expect(blob).toMatch(/PostgreSQL/)
    expect(blob).toMatch(/AWS/)
    expect(blob).toMatch(/Docker/)
    expect(blob).toMatch(/CI\/CD|CI/)
    expect(tailored.skills).toEqual(expect.arrayContaining(['React']))
    expect(tailored.skills.join(' ')).not.toMatch(/Kubernetes|Terraform|\bGo\b|JUnit|Mockito|TypeScript|Microservices/)
    expect(tailored.summary).toMatch(/Java/)
    expect(tailored.summary).toMatch(/Spring Boot/)
    expect(result.plan.missingSkills.join(' ')).toMatch(/Kubernetes/)
    expect(result.plan.missingSkills.join(' ')).toMatch(/Terraform/)

    const rewritten = tailored.experience.flatMap((role) => role.bullets)
    expect(rewritten.some((bullet) => /Java/i.test(bullet) && /Spring Boot/i.test(bullet))).toBe(true)
    expect(rewritten.some((bullet) => /Docker/i.test(bullet))).toBe(true)

    const after = scoreMatch(extractResumeLocal(tailoredResumeToText(tailored)), jobProfile, tailoredResumeToText(tailored))
    const beforeSupported =
      before.requiredSkills.matched.length + before.preferredSkills.matched.length
    const afterSupported =
      after.requiredSkills.matched.length + after.preferredSkills.matched.length
    expect(afterSupported).toBeGreaterThanOrEqual(beforeSupported)
  })

  it('keeps Kubernetes, Terraform, and Go missing when the resume does not support them', () => {
    const originalProfile = extractResumeLocal(JAVA_RESUME_TEXT)
    const jobProfile = extractJobLocal(MISSING_STACK_JD)
    const before = scoreMatch(originalProfile, jobProfile, JAVA_RESUME_TEXT)
    const result = conservativeTailor({
      resumeText: JAVA_RESUME_TEXT,
      jobDescription: MISSING_STACK_JD,
      resumeProfile: originalProfile,
      jobProfile,
      matchReport: before,
    })

    expect(result.tailored?.skills.join(' ')).not.toMatch(/Kubernetes|Terraform|\bGo\b/)
    expect(result.tailored?.summary).not.toMatch(/Kubernetes|Terraform|\bGo\b/)
    expect(result.plan.missingSkills).toEqual(expect.arrayContaining(['Kubernetes', 'Terraform']))
    expect(result.plan.missingSkills.join(' ')).toMatch(/\bGo\b/)
    expect(before.requiredSkills.missing.some((item) => /kubernetes/i.test(item.name))).toBe(true)
  })
})
