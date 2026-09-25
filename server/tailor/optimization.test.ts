import { describe, expect, it } from 'vitest'
import { extractJobLocal, extractResumeLocal } from '../match/extract-local'
import { scoreMatch } from '../match/engine'
import { conservativeTailor } from './engine'
import { extractJdIntelligence } from './jd-intel'
import { buildCoverageMatrix, extractRequirementEvidence } from './evidence'
import { collectSourceFacts } from './source'
import { restoreLostEvidence, scoreTailoredResume } from './match-optimize'
import { JAVA_BACKEND_JD, JAVA_RESUME_TEXT, MISSING_STACK_JD, HIDDEN_REST_RESUME, REST_ONLY_JD, DOCKER_ONLY_RESUME, KUBERNETES_JD } from './fixtures'

describe('ATS resume optimization', () => {
  it('extracts structured JD intelligence and a coverage matrix from the Java sample', () => {
    const jd = extractJdIntelligence(JAVA_BACKEND_JD, extractJobLocal(JAVA_BACKEND_JD))
    expect(jd.required.languages).toEqual(expect.arrayContaining(['Java']))
    expect(jd.required.frameworks.join(' ')).toMatch(/Spring Boot/)
    expect(jd.preferred.devops.join(' ') + jd.preferred.technicalSkills.join(' ')).toMatch(/Kubernetes/)
    expect(jd.recruiterPhrases.length).toBeGreaterThan(0)

    const source = collectSourceFacts(JAVA_RESUME_TEXT, extractResumeLocal(JAVA_RESUME_TEXT))
    const evidence = extractRequirementEvidence(jd, source)
    const matrix = buildCoverageMatrix(evidence)
    const java = matrix.find((row) => /java/i.test(row.requirement))
    const kubernetes = matrix.find((row) => /kubernetes/i.test(row.requirement))
    expect(java?.supported).toBe(true)
    expect(kubernetes?.coverage).toBe('missing')
  })

  it('rewrites at least five experience bullets using only source-supported facts', () => {
    const result = conservativeTailor({
      resumeText: JAVA_RESUME_TEXT,
      jobDescription: JAVA_BACKEND_JD,
      resumeProfile: extractResumeLocal(JAVA_RESUME_TEXT),
      jobProfile: extractJobLocal(JAVA_BACKEND_JD),
    })

    const rewrites = (result.tailored?.changes ?? []).filter((item) => item.kind === 'rewritten' && item.before && item.after)
    expect(rewrites.length).toBeGreaterThanOrEqual(5)

    for (const change of rewrites.slice(0, 5)) {
      expect(change.after).not.toEqual(change.before)
      const invented = ['Kubernetes', 'Terraform', 'Go', 'JUnit', 'Mockito', 'Maven', 'microservices']
      for (const term of invented) {
        const appeared = new RegExp(term, 'i').test(change.after ?? '')
        const existed = new RegExp(term, 'i').test(JAVA_RESUME_TEXT)
        if (appeared) expect(existed).toBe(true)
      }
    }
  })

  it('improves supported coverage on the strong Java JD without inventing gaps', () => {
    const resumeProfile = extractResumeLocal(JAVA_RESUME_TEXT)
    const jobProfile = extractJobLocal(JAVA_BACKEND_JD)
    const before = scoreMatch(resumeProfile, jobProfile, JAVA_RESUME_TEXT)
    const result = conservativeTailor({
      resumeText: JAVA_RESUME_TEXT,
      jobDescription: JAVA_BACKEND_JD,
      resumeProfile,
      jobProfile,
      matchReport: before,
    })

    expect(result.supportedCoverageAfter ?? 0).toBeGreaterThanOrEqual(result.supportedCoverageBefore ?? 0)
    expect(result.requiredCoverage).toBeGreaterThan(50)
    expect(result.tailored?.skills).toEqual(expect.arrayContaining(['Java', 'Spring Boot', 'PostgreSQL', 'AWS', 'Docker']))
    expect(result.tailored?.skills.join(' ')).toMatch(/REST/)
    expect(result.tailored?.skills.join(' ')).not.toMatch(/Kubernetes|Terraform|\bGo\b/)
  })

  it('keeps a lower alignment score when the JD adds unsupported Kubernetes, Terraform, and Go', () => {
    const resumeProfile = extractResumeLocal(JAVA_RESUME_TEXT)
    const strong = conservativeTailor({
      resumeText: JAVA_RESUME_TEXT,
      jobDescription: JAVA_BACKEND_JD,
      resumeProfile,
      jobProfile: extractJobLocal(JAVA_BACKEND_JD),
    })
    const weaker = conservativeTailor({
      resumeText: JAVA_RESUME_TEXT,
      jobDescription: MISSING_STACK_JD,
      resumeProfile,
      jobProfile: extractJobLocal(MISSING_STACK_JD),
    })

    expect(weaker.tailored?.skills.join(' ')).not.toMatch(/Kubernetes|Terraform|\bGo\b/)
    expect(weaker.unsupportedRequirements?.join(' ')).toMatch(/Kubernetes/)
    expect(weaker.unsupportedRequirements?.join(' ')).toMatch(/Terraform/)
    expect(weaker.unsupportedRequirements?.join(' ')).toMatch(/\bGo\b/)
    expect(weaker.atsAlignmentScore ?? 100).toBeLessThanOrEqual(strong.atsAlignmentScore ?? 0)
  })

  it('surfaces hidden REST evidence from HTTP-based services without adding Kubernetes', () => {
    const resumeProfile = extractResumeLocal(HIDDEN_REST_RESUME)
    const jobProfile = extractJobLocal(REST_ONLY_JD)
    const before = scoreMatch(resumeProfile, jobProfile, HIDDEN_REST_RESUME)
    const result = conservativeTailor({
      resumeText: HIDDEN_REST_RESUME,
      jobDescription: REST_ONLY_JD,
      resumeProfile,
      jobProfile,
      matchReport: before,
    })
    const blob = [result.tailored?.summary, result.tailored?.skills.join(' '), ...(result.tailored?.experience.flatMap((role) => role.bullets) ?? [])].join('\n')
    expect(blob).toMatch(/REST API/i)
    expect(result.tailoredMatchScore ?? 0).toBeGreaterThanOrEqual(result.originalMatchScore ?? 0)
    expect(result.tailored?.skills.join(' ')).not.toMatch(/Kubernetes/)
  })

  it('does not turn Docker evidence into Kubernetes', () => {
    const resumeProfile = extractResumeLocal(DOCKER_ONLY_RESUME)
    const jobProfile = extractJobLocal(KUBERNETES_JD)
    const before = scoreMatch(resumeProfile, jobProfile, DOCKER_ONLY_RESUME)
    const result = conservativeTailor({
      resumeText: DOCKER_ONLY_RESUME,
      jobDescription: KUBERNETES_JD,
      resumeProfile,
      jobProfile,
      matchReport: before,
    })
    const blob = [result.tailored?.summary, result.tailored?.skills.join(' '), ...(result.tailored?.experience.flatMap((role) => role.bullets) ?? [])].join('\n')
    expect(blob).toMatch(/Docker/)
    expect(blob).not.toMatch(/Kubernetes/)
    expect(result.plan.missingSkills.join(' ')).toMatch(/Kubernetes/)
    expect(before.requiredSkills.missing.some((item) => /kubernetes/i.test(item.name))).toBe(true)
  })

  it('explains when 80+ cannot be reached because required qualifications are missing', () => {
    const jd = `Platform Engineer

Required:
- Kubernetes
- Helm
- Istio
- Terraform
`
    const resumeProfile = extractResumeLocal(DOCKER_ONLY_RESUME)
    const jobProfile = extractJobLocal(jd)
    const before = scoreMatch(resumeProfile, jobProfile, DOCKER_ONLY_RESUME)
    const result = conservativeTailor({
      resumeText: DOCKER_ONLY_RESUME,
      jobDescription: jd,
      resumeProfile,
      jobProfile,
      matchReport: before,
    })
    expect(result.tailored?.skills.join(' ')).not.toMatch(/Kubernetes|Helm|Istio|Terraform/)
    expect(result.tailoredMatchScore ?? 100).toBeLessThan(80)
    expect(result.cannotReachEightyReason ?? result.plan.cannotReachEightyReason ?? '').toMatch(
      /80–85% alignment could not be achieved/,
    )
    expect(result.cannotReachEightyReason ?? result.plan.cannotReachEightyReason ?? '').toMatch(/Kubernetes/)
  })

  it('keeps the Java sample Match Engine score from dropping and reports coverage', () => {
    const resumeProfile = extractResumeLocal(JAVA_RESUME_TEXT)
    const jobProfile = extractJobLocal(JAVA_BACKEND_JD)
    const before = scoreMatch(resumeProfile, jobProfile, JAVA_RESUME_TEXT)
    const result = conservativeTailor({
      resumeText: JAVA_RESUME_TEXT,
      jobDescription: JAVA_BACKEND_JD,
      resumeProfile,
      jobProfile,
      matchReport: before,
    })
    expect(result.originalMatchScore).toBe(before.matchScore)
    expect(result.tailoredMatchScore ?? 0).toBeGreaterThanOrEqual(before.matchScore)
    expect(result.requiredMatchedAfter ?? 0).toBeGreaterThanOrEqual(result.requiredMatchedBefore ?? 0)
    expect(result.supportedCoverageAfter ?? 0).toBeGreaterThanOrEqual(result.supportedCoverageBefore ?? 0)
    expect(result.optimizationIterations).toBeGreaterThanOrEqual(1)
    expect(result.factualValidation?.passed).toBe(true)
  })

  it('restores supported Java evidence if tailoring accidentally dropped it', () => {
    const resumeProfile = extractResumeLocal(JAVA_RESUME_TEXT)
    const jobProfile = extractJobLocal(JAVA_BACKEND_JD)
    const result = conservativeTailor({
      resumeText: JAVA_RESUME_TEXT,
      jobDescription: JAVA_BACKEND_JD,
      resumeProfile,
      jobProfile,
    })
    const weakened = {
      ...result.tailored!,
      skills: result.tailored!.skills.filter((skill) => !/java/i.test(skill)),
      summary: 'Software engineer.',
      experience: result.tailored!.experience.map((role) => ({
        ...role,
        bullets: role.bullets.map((bullet) => bullet.replace(/Java/gi, 'backend')),
      })),
    }
    const source = collectSourceFacts(JAVA_RESUME_TEXT, resumeProfile)
    const restored = restoreLostEvidence(weakened, source, ['Java'])
    expect(restored.skills.join(' ')).toMatch(/Java/)
    const after = scoreTailoredResume(restored, jobProfile, resumeProfile)
    expect(after.requiredSkills.matched.some((item) => /java/i.test(item.name))).toBe(true)
  })
})
