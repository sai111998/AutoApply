import type { DimensionMatch, JobMatch, SkillSignal } from '@/types/domain'
import type { AnalyzeJobApiResult } from './types'

function toSignals(names: string[]): SkillSignal[] {
  return names.map((name) => ({ name }))
}

function toDimension(matched: boolean, yes: string, no: string): DimensionMatch {
  return {
    score: matched ? 100 : 0,
    matched,
    summary: matched ? yes : no,
  }
}

export function mapApiResultToMatchFields(result: AnalyzeJobApiResult): Pick<
  JobMatch,
  | 'overallScore'
  | 'skillsMatched'
  | 'skillsPartial'
  | 'skillsMissing'
  | 'experienceMatch'
  | 'educationMatch'
  | 'locationMatch'
  | 'workAuthorizationNotes'
  | 'strengths'
  | 'concerns'
  | 'recommendation'
  | 'summary'
  | 'analysisStatus'
  | 'analysisSource'
  | 'provider'
  | 'errorMessage'
  | 'analyzedAt'
> {
  return {
    overallScore: result.matchScore,
    skillsMatched: toSignals(result.matchedSkills),
    skillsPartial: toSignals(result.partiallyMatchedSkills),
    skillsMissing: toSignals(result.missingSkills),
    experienceMatch: toDimension(
      result.experienceMatch,
      'The resume states experience that meets the posting.',
      'The resume does not state experience that meets the posting.',
    ),
    educationMatch: toDimension(
      result.educationMatch,
      'Education is compatible with the posting, or no education requirement was stated.',
      'The resume does not state education that meets the posting.',
    ),
    locationMatch: toDimension(
      result.locationMatch,
      'Location or work arrangement in the resume is compatible with the posting.',
      'The resume does not support the posting location or work arrangement.',
    ),
    workAuthorizationNotes: 'Work authorization was not included in this analysis contract.',
    strengths: result.strengths,
    concerns: result.concerns,
    recommendation: result.recommendation,
    summary: result.summary,
    analysisStatus: 'complete',
    analysisSource: 'api',
    provider: 'llm',
    errorMessage: null,
    analyzedAt: new Date().toISOString(),
  }
}
