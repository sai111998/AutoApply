import type { DimensionMatch, JobMatch, SkillSignal } from '@/types/domain'
import type { AnalyzeJobApiResult, MatchReport, SkillAssessment } from './types'

function toSignals(items: string[] | SkillAssessment[] | undefined, fallbackNote?: string): SkillSignal[] {
  if (!items?.length) return []
  return items.map((item) =>
    typeof item === 'string'
      ? { name: item, note: fallbackNote }
      : { name: item.name, note: item.evidence || `${item.source} · ${item.classification}` },
  )
}

function toDimension(matched: boolean, summary: string): DimensionMatch {
  return {
    score: matched ? 100 : 0,
    matched,
    summary,
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
  | 'confidence'
  | 'report'
> {
  const report: MatchReport | null = result.report ?? null
  const required = result.requiredSkills ?? report?.requiredSkills
  const preferred = result.preferredSkills ?? report?.preferredSkills

  return {
    overallScore: result.matchScore,
    skillsMatched: toSignals(required?.matched ?? result.matchedSkills, 'Strong match'),
    skillsPartial: toSignals(required?.partial?.concat(preferred?.partial ?? []) ?? result.partiallyMatchedSkills, 'Partial match'),
    skillsMissing: toSignals(
      [
        ...(required?.missing ?? []),
        ...(preferred?.missing ?? []),
      ].length
        ? [...(required?.missing ?? []), ...(preferred?.missing ?? [])]
        : result.missingSkills,
      'Missing',
    ),
    experienceMatch: toDimension(
      result.experienceMatch,
      result.experience?.gap || result.experience?.candidateEvidence || (result.experienceMatch
        ? 'The resume states experience that meets the posting.'
        : 'The resume does not state experience that meets the posting.'),
    ),
    educationMatch: toDimension(
      result.educationMatch,
      result.education?.details ||
        (result.educationMatch
          ? 'Education is compatible with the posting, or no education requirement was stated.'
          : 'The resume does not state education that meets the posting.'),
    ),
    locationMatch: toDimension(
      result.locationMatch,
      result.locationFit?.details ||
        (result.locationMatch
          ? 'Location or work arrangement in the resume is compatible with the posting.'
          : 'The resume does not support the posting location or work arrangement.'),
    ),
    workAuthorizationNotes:
      result.missingEvidence?.find((item) => /authorization|sponsor/i.test(item)) ||
      'Work authorization was compared only when the posting and resume stated it.',
    strengths: result.strengths,
    concerns: result.concerns,
    recommendation: result.recommendation,
    summary: result.summary,
    analysisStatus: 'complete',
    analysisSource: 'api',
    provider: 'match-engine',
    errorMessage: null,
    analyzedAt: new Date().toISOString(),
    confidence: result.confidence,
    report,
  }
}
