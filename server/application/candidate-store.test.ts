import { afterEach, describe, expect, it } from 'vitest'
import { resolveApplicationQuestions } from '../apply/questions'
import { rememberApprovedAnswer, resetAnswerLibraryForTests } from './answers'
import {
  candidateRequiredFieldsExist,
  getCandidateProfile,
  resetCandidateStoreForTests,
  saveCandidateProfile,
} from './candidate-store'
import type { AutoApplyProfile } from '../apply/types'

const profile: AutoApplyProfile = {
  fullName: 'Jordan Hale',
  email: 'jordan.hale@example.com',
  location: 'Austin, TX',
  yearsOfExperience: 6,
  workAuthorization: 'us_citizen',
  sponsorshipRequired: false,
  preferredWorkArrangement: 'hybrid',
  targetSalaryMin: null,
  targetSalaryMax: null,
}

afterEach(() => {
  resetCandidateStoreForTests()
  resetAnswerLibraryForTests()
})

describe('JobPilot candidate profile store', () => {
  it('stores the campaign profile and reports required fields without values', () => {
    saveCandidateProfile({ userId: 'user-1', profile, resumeText: 'Java engineer', resumeVersionId: 'resume-1' })
    expect(getCandidateProfile('user-1')?.profile.email).toBeTruthy()
    expect(candidateRequiredFieldsExist(profile)).toEqual({
      firstName: 'yes',
      lastName: 'yes',
      email: 'yes',
      phone: 'no',
    })
  })
})

describe('application answer bank', () => {
  it('uses an approved library answer and leaves unknown required questions unanswered', () => {
    rememberApprovedAnswer({
      userId: 'user-1',
      prompt: 'Are you willing to relocate?',
      answer: 'Yes',
      source: 'user',
    })
    const resolved = resolveApplicationQuestions(
      ['Are you willing to relocate?', 'What is your favorite color?'],
      profile,
      'user-1',
    )
    expect(resolved.answered[0]?.source).toBe('library')
    expect(resolved.answered[0]?.answer).toBe('Yes')
    expect(resolved.unknown.map((item) => item.prompt)).toContain('What is your favorite color?')
  })
})
