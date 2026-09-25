import { afterEach, describe, expect, it } from 'vitest'
import { JAVA_RESUME_TEXT } from '../tailor/fixtures'
import type { AutoApplyProfile } from '../apply/types'
import { applicationQuestionMapper, mapApplicationQuestions } from './mapper'
import { buildCandidateApplicationProfile } from './profile'
import { rememberApprovedAnswer, resetAnswerLibraryForTests } from './answers'

const profile: AutoApplyProfile = {
  fullName: 'Jordan Hale',
  email: 'jordan.hale@example.com',
  location: 'Austin, TX',
  yearsOfExperience: 6,
  workAuthorization: 'us_citizen',
  sponsorshipRequired: false,
  preferredWorkArrangement: 'hybrid',
  targetSalaryMin: 120000,
  targetSalaryMax: 150000,
}

afterEach(() => {
  resetAnswerLibraryForTests()
})

describe('application question mapper', () => {
  const candidate = buildCandidateApplicationProfile({
    profile: { ...profile, phone: '512-555-0100', linkedin: 'https://linkedin.com/in/jordanhale' },
    resumeText: JAVA_RESUME_TEXT,
  })

  it('maps work authorization and sponsorship from the candidate profile', () => {
    expect(applicationQuestionMapper('Are you legally authorized to work in the US?', candidate).answer).toBe('Yes')
    expect(applicationQuestionMapper('Will you now or in the future require sponsorship?', candidate).answer).toBe('No')
  })

  it('reuses an approved answer bank entry and never guesses unknown required questions', () => {
    rememberApprovedAnswer({ userId: 'user-1', prompt: 'Are you willing to relocate?', answer: 'No' })
    const reused = applicationQuestionMapper('Are you willing to relocate?', candidate, 'user-1')
    expect(reused.source).toBe('library')
    expect(reused.answer).toBe('No')
    expect(reused.needsUserInput).toBe(false)
    const unknown = applicationQuestionMapper('What is your favorite color?', candidate, 'user-1')
    expect(unknown.needsUserInput).toBe(true)
    expect(unknown.answer).toBeNull()
    expect(applicationQuestionMapper('When can you start?', candidate).needsUserInput).toBe(true)
    expect(applicationQuestionMapper('Are you willing to travel?', candidate).needsUserInput).toBe(true)
  })

  it('does not invent Java years when the resume does not state them', () => {
    const mapped = applicationQuestionMapper('How many years of Java experience do you have?', candidate)
    expect(mapped.field).toBe('skillYears')
    expect(mapped.answer).toBeNull()
    expect(mapped.needsUserInput).toBe(true)
  })

  it('answers generic years only from verified overall experience', () => {
    const mapped = applicationQuestionMapper('How many years of experience do you have?', candidate)
    expect(mapped.field).toBe('yearsExperience')
    expect(mapped.answer).toBe('6')
  })

  it('answers a skill-year question only when verified skill years exist', () => {
    const withYears = {
      ...candidate,
      skills: {
        ...candidate.skills,
        languages: candidate.skills.languages.map((item) =>
          item.name.toLowerCase() === 'java' ? { ...item, years: 5 } : item,
        ),
      },
    }
    const mapped = applicationQuestionMapper('How many years of Java experience do you have?', withYears)
    expect(mapped.answer).toBe('5')
    expect(mapped.needsUserInput).toBe(false)
  })

  it('maps identity and contact fields from the profile', () => {
    const mapped = mapApplicationQuestions(
      ['First name', 'Email', 'Phone', 'LinkedIn profile'],
      candidate,
    )
    expect(mapped.unknown).toEqual([])
    expect(mapped.answered.map((item) => item.answer)).toEqual([
      'Jordan',
      'jordan.hale@example.com',
      '512-555-0100',
      'https://linkedin.com/in/jordanhale',
    ])
  })
})
