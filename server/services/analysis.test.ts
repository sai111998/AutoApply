import { describe, expect, it } from 'vitest'
import { parseAnalysisResult } from './parse-result'
import { requireNonEmptyText } from './validate'
import { parseAnalyzeRequest } from './analysis'
import { HttpError } from '../types'
import { SYSTEM_PROMPT, buildUserPrompt } from '../prompt'

const validPayload = {
  matchScore: 81.4,
  recommendation: 'APPLY',
  matchedSkills: ['React', 'TypeScript'],
  partiallyMatchedSkills: ['GraphQL'],
  missingSkills: ['Kotlin'],
  experienceMatch: true,
  educationMatch: true,
  locationMatch: false,
  strengths: ['Resume lists 6 years of React'],
  concerns: ['Resume does not mention on-site Chicago'],
  summary: 'Strong frontend overlap; location is not evidenced.',
}

describe('requireNonEmptyText', () => {
  it('rejects missing, blank, and non-string values', () => {
    expect(() => requireNonEmptyText('', 'jobDescription')).toThrow('jobDescription must not be empty')
    expect(() => requireNonEmptyText('   ', 'resumeText')).toThrow('resumeText must not be empty')
    expect(() => requireNonEmptyText(null, 'jobDescription')).toThrow('jobDescription is required')
  })

  it('trims valid text', () => {
    expect(requireNonEmptyText('  hello  ', 'jobDescription')).toBe('hello')
  })
})

describe('parseAnalyzeRequest', () => {
  it('requires jobDescription and resumeText', () => {
    try {
      parseAnalyzeRequest({ jobDescription: '', resumeText: 'resume' })
      throw new Error('expected failure')
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError)
      expect((error as HttpError).status).toBe(400)
      expect((error as HttpError).message).toContain('jobDescription')
    }

    try {
      parseAnalyzeRequest({ jobDescription: 'role', resumeText: '   ' })
      throw new Error('expected failure')
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError)
      expect((error as HttpError).message).toContain('resumeText')
    }
  })

  it('accepts the required contract plus optional storage fields', () => {
    const parsed = parseAnalyzeRequest({
      jobDescription: 'Senior frontend engineer',
      resumeText: 'Built React apps for 6 years.',
      userId: 'user-1',
      jobId: '3b9f0c2a-7d11-4c3a-9f12-8a1b2c3d4e5f',
      matchId: '4c0e1d3b-8e22-4d4b-a023-9b2c3d4e5f60',
      title: 'Senior Frontend Engineer',
    })
    expect(parsed.jobDescription).toBe('Senior frontend engineer')
    expect(parsed.resumeText).toBe('Built React apps for 6 years.')
    expect(parsed.userId).toBe('user-1')
    expect(parsed.jobId).toBe('3b9f0c2a-7d11-4c3a-9f12-8a1b2c3d4e5f')
    expect(parsed.matchId).toBe('4c0e1d3b-8e22-4d4b-a023-9b2c3d4e5f60')
  })
})

describe('parseAnalysisResult', () => {
  it('normalizes a valid LLM payload', () => {
    const result = parseAnalysisResult(validPayload)
    expect(result.matchScore).toBe(81)
    expect(result.recommendation).toBe('APPLY')
    expect(result.matchedSkills).toEqual(['React', 'TypeScript'])
    expect(result.locationMatch).toBe(false)
  })

  it('fails closed on invented or malformed recommendation values', () => {
    expect(() => parseAnalysisResult({ ...validPayload, recommendation: 'MAYBE' })).toThrow(
      /recommendation/,
    )
  })

  it('does not invent skills when the model omits arrays', () => {
    const result = parseAnalysisResult({
      ...validPayload,
      matchedSkills: undefined,
      partiallyMatchedSkills: ['  '],
      missingSkills: null,
    })
    expect(result.matchedSkills).toEqual([])
    expect(result.partiallyMatchedSkills).toEqual([])
    expect(result.missingSkills).toEqual([])
  })
})

describe('prompt contract', () => {
  it('forbids inventing candidate experience', () => {
    expect(SYSTEM_PROMPT).toMatch(/Do not invent/i)
    expect(SYSTEM_PROMPT).toMatch(/only information explicitly present in the supplied resume/i)
  })

  it('sends job and resume as separate labeled sections', () => {
    const prompt = buildUserPrompt('Need Rust', 'Python intern, 2019')
    expect(prompt).toContain('JOB DESCRIPTION')
    expect(prompt).toContain('Need Rust')
    expect(prompt).toContain('RESUME')
    expect(prompt).toContain('Python intern, 2019')
    expect(prompt).toContain('Use only the resume text as evidence')
  })
})
