import { describe, expect, it } from 'vitest'
import { scoreMatch } from '../../server/match/engine'
import { emptyJobProfile } from '../../server/match/ground'
import { jobProfileFromMatch, resumeProfileFromTailored } from './evidence-profiles'
import { emptyTailoredContent, tailoredResumeToText } from './tailored-text'
import type { JobMatch, TailoredResumeContent } from '@/types/domain'

function sample(overrides: Partial<TailoredResumeContent> = {}): TailoredResumeContent {
  return {
    ...emptyTailoredContent(),
    summary: 'Software Engineer with experience developing Java and Spring Boot.',
    skills: ['Java', 'Spring Boot', 'PostgreSQL'],
    experience: [
      {
        company: 'Northwind',
        title: 'Backend Engineer',
        dates: '2021 to present',
        bullets: ['Developed Java and Spring Boot applications for payments APIs.'],
      },
    ],
    contact: { name: 'Jordan Hale', email: 'jordan.hale@example.com', location: 'Austin, TX' },
    ...overrides,
  }
}

const jobProfile = {
  ...emptyJobProfile(),
  requiredSkills: [{ name: 'Java' }, { name: 'Spring Boot' }, { name: 'PostgreSQL' }],
  preferredSkills: [{ name: 'Kubernetes' }],
}

describe('tailored resume match recalculation', () => {
  it('increases the score when missing required evidence is restored from the source resume', () => {
    const weak = sample({
      skills: ['Java'],
      summary: 'Software engineer.',
      experience: [
        {
          company: 'Northwind',
          title: 'Backend Engineer',
          dates: '2021 to present',
          bullets: ['Worked on internal tools.'],
        },
      ],
    })
    const strong = sample()
    const weakScore = scoreMatch(resumeProfileFromTailored(weak), jobProfile, tailoredResumeToText(weak)).matchScore
    const strongScore = scoreMatch(resumeProfileFromTailored(strong), jobProfile, tailoredResumeToText(strong)).matchScore
    expect(strongScore).toBeGreaterThan(weakScore)
  })

  it('decreases the score when the user removes required skills from the tailored resume', () => {
    const strong = sample()
    const edited = sample({
      skills: ['Python'],
      summary: 'Generalist.',
      experience: [
        {
          company: 'Northwind',
          title: 'Backend Engineer',
          dates: '2021 to present',
          bullets: ['Worked on internal tools.'],
        },
      ],
    })
    const before = scoreMatch(resumeProfileFromTailored(strong), jobProfile, tailoredResumeToText(strong)).matchScore
    const after = scoreMatch(resumeProfileFromTailored(edited), jobProfile, tailoredResumeToText(edited)).matchScore
    expect(after).toBeLessThan(before)
  })

  it('reuses required skills from the original match report instead of inventing a new job parse', () => {
    const match = {
      report: {
        requiredSkills: {
          matched: [{ name: 'Java', classification: 'strong', source: 'required', evidence: 'Java' }],
          partial: [],
          missing: [{ name: 'Kubernetes', classification: 'missing', source: 'required', evidence: '' }],
        },
        preferredSkills: { matched: [], partial: [], missing: [] },
        responsibilities: { strongMatches: [], partialMatches: [], gaps: [] },
        education: { status: 'not_applicable', details: '' },
        certifications: { matched: [], missing: [] },
      },
      skillsMatched: [],
      skillsPartial: [],
      skillsMissing: [],
    } as unknown as JobMatch
    const profile = jobProfileFromMatch(match, { location: 'Austin, TX' })
    expect(profile.requiredSkills.map((item) => item.name)).toEqual(['Java', 'Kubernetes'])
  })

  it('infers years of experience from role dates so the engine does not invent them', () => {
    const profile = resumeProfileFromTailored(sample())
    expect(profile.yearsOfExperience).toBeGreaterThanOrEqual(4)
    expect(profile.jobTitles).toContain('Backend Engineer')
    expect(profile.employers).toContain('Northwind')
  })
})
