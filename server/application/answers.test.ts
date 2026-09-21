import { afterEach, describe, expect, it } from 'vitest'
import {
  lookupApprovedAnswer,
  normalizeQuestion,
  questionFingerprint,
  rememberApprovedAnswer,
  resetAnswerLibraryForTests,
} from './answers'

afterEach(() => {
  resetAnswerLibraryForTests()
})

describe('application answer library', () => {
  it('normalizes equivalent questions to the same key', () => {
    expect(normalizeQuestion('Are you legally authorized to work in the United States?')).toBe(
      normalizeQuestion('Are you legally authorized to work in the United States'),
    )
  })

  it('reuses a user-approved answer on a later similar question', () => {
    rememberApprovedAnswer({
      userId: 'user-1',
      prompt: 'Are you legally authorized to work in the United States?',
      answer: 'Yes',
    })
    const found = lookupApprovedAnswer('user-1', 'Are you legally authorized to work in the United States')
    expect(found?.answer).toBe('Yes')
    expect(found?.userApproved).toBe(true)
    expect(lookupApprovedAnswer('user-2', 'Are you legally authorized to work in the United States?')).toBeNull()
    expect(found?.questionFingerprint).toBe(questionFingerprint('Are you legally authorized to work in the United States?'))
    expect(found?.questionText).toBe('Are you legally authorized to work in the United States?')
    expect(found?.answerType).toBe('boolean')
    expect(found?.source).toBe('user')
  })

  it('does not reuse an unapproved or empty answer', () => {
    expect(rememberApprovedAnswer({ userId: 'user-1', prompt: 'Salary?', answer: '' })).toBeNull()
    expect(lookupApprovedAnswer('user-1', 'Salary?')).toBeNull()
  })
})
