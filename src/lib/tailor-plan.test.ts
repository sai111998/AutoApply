import { describe, expect, it } from 'vitest'
import { planFromMatch } from './tailor-plan'
import { createSampleWorkspace } from '@/data/sample'

describe('planFromMatch', () => {
  it('keeps Kubernetes as a gap for the Java sample and does not treat it as a skill to add', () => {
    const workspace = createSampleWorkspace()
    const match = workspace.matches.find((item) => item.overallScore === 91 && item.skillsMissing.some((skill) => /kubernetes/i.test(skill.name)))
    const resume = workspace.resumes.find((item) => item.id === match?.resumeId)
    expect(match && resume).toBeTruthy()
    const plan = planFromMatch(match!, resume!.parsedText)
    expect(plan.skillsToEmphasize).toEqual(expect.arrayContaining(['Java', 'Spring Boot']))
    expect(plan.missingSkills).toEqual(expect.arrayContaining(['Kubernetes']))
    expect(plan.skillsToEmphasize.join(' ')).not.toMatch(/Kubernetes/i)
  })

  it('does not crash when the stored match report is missing optional buckets', () => {
    const workspace = createSampleWorkspace()
    const match = workspace.matches.find((item) => item.overallScore === 91 && item.skillsMissing.some((skill) => /kubernetes/i.test(skill.name)))
    const resume = workspace.resumes.find((item) => item.id === match?.resumeId)
    expect(match && resume).toBeTruthy()
    const plan = planFromMatch(
      {
        ...match!,
        report: {
          matchScore: 91,
          recommendation: 'APPLY',
          confidence: 'HIGH',
          requiredSkills: {
            matched: [{ name: 'Java', classification: 'strong', source: 'required', evidence: '' }],
            partial: [],
            missing: [],
          },
        } as never,
      },
      resume!.parsedText,
    )
    expect(plan.skillsToEmphasize).toEqual(expect.arrayContaining(['Java']))
    expect(plan.missingSkills).toEqual(expect.arrayContaining(['Kubernetes']))
  })
})
