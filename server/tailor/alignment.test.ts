import { describe, expect, it } from 'vitest'
import { scoreMatch } from '../match/engine'
import { extractJobLocal, extractResumeLocal } from '../match/extract-local'
import { conservativeTailor } from './engine'
import type { TailoredResume } from './types'
import { JAVA_BACKEND_JD, JAVA_RESUME_TEXT, MISSING_STACK_JD } from './fixtures'

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
    expect(result.atsAlignmentScore).toBeGreaterThan(0)
    expect(result.supportedCoverageAfter).toBeGreaterThanOrEqual(result.supportedCoverageBefore ?? 0)
    expect(result.factualValidation?.passed).toBe(true)
    expect(result.unsupportedRequirements?.join(' ')).toMatch(/Kubernetes|Terraform|Go/)
    expect(tailored.summary.split('\n').length).toBeGreaterThanOrEqual(2)

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
