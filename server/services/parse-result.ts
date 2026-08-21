import type { AnalysisResult } from '../types'
import { asBoolean, asRecommendation, asScore, asStringArray, asSummary } from './validate'

export function parseAnalysisResult(value: unknown): AnalysisResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Analysis model returned an invalid payload')
  }
  const record = value as Record<string, unknown>
  return {
    matchScore: asScore(record.matchScore),
    recommendation: asRecommendation(record.recommendation),
    matchedSkills: asStringArray(record.matchedSkills),
    partiallyMatchedSkills: asStringArray(record.partiallyMatchedSkills),
    missingSkills: asStringArray(record.missingSkills),
    experienceMatch: asBoolean(record.experienceMatch, 'experienceMatch'),
    educationMatch: asBoolean(record.educationMatch, 'educationMatch'),
    locationMatch: asBoolean(record.locationMatch, 'locationMatch'),
    strengths: asStringArray(record.strengths),
    concerns: asStringArray(record.concerns),
    summary: asSummary(record.summary),
  }
}
