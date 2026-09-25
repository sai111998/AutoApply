import { extractJobLocal, extractResumeLocal } from '../match/extract-local'
import { scoreMatch } from '../match/engine'
import { extractRequirementEvidence } from '../tailor/evidence'
import { extractJdIntelligence } from '../tailor/jd-intel'
import { buildConservativeResume } from '../tailor/conservative'
import { cannotReachEightyReason, scoreTailoredResume, tailoredResumeToText } from '../tailor/match-optimize'
import { buildTailoringPlan } from '../tailor/plan'
import { collectSourceFacts, extractContact } from '../tailor/source'
import {
  emptyLiveMatch,
  jobContentHash,
  liveScoreCacheKey,
  resumeContentHash,
  resumeIdentity,
  type LiveJobMatch,
} from './score'
import type { NormalizedJob } from './types'

export interface LiveTailorPreview {
  current: LiveJobMatch
  tailored: LiveJobMatch
  improvement: number
  matchedSkills: string[]
  missingSkills: string[]
  stillMissing: string[]
  cannotReachTargetReason: string | null
  previewText: string
  cached: boolean
}

const previewCache = new Map<string, Omit<LiveTailorPreview, 'cached'>>()

function toMatch(score: number, matched: string[], missing: string[], resumeVersionId: string | null): LiveJobMatch {
  return {
    score,
    matchedSkills: matched.slice(0, 8),
    missingSkills: missing.slice(0, 8),
    resumeVersionId,
    scoreUpdatedAt: new Date().toISOString(),
    cached: false,
  }
}

export function previewLiveJobTailor(input: {
  resumeText: string
  job: Pick<NormalizedJob, 'id' | 'providerJobId' | 'title' | 'company' | 'description'>
  resumeVersionId?: string | null
}): LiveTailorPreview {
  const resumeText = input.resumeText.trim()
  const description = input.job.description?.trim() ?? ''
  const resumeVersionId = input.resumeVersionId?.trim() || null
  if (!resumeText || !description) {
    const empty = emptyLiveMatch(resumeVersionId)
    return {
      current: empty,
      tailored: empty,
      improvement: 0,
      matchedSkills: [],
      missingSkills: [],
      stillMissing: [],
      cannotReachTargetReason: null,
      previewText: resumeText,
      cached: false,
    }
  }

  const versionId = resumeIdentity(resumeText, resumeVersionId)
  const key = `preview:${liveScoreCacheKey(
    input.job.providerJobId || input.job.id,
    versionId,
    jobContentHash(input.job),
  )}|${resumeContentHash(resumeText)}`
  const hit = previewCache.get(key)
  if (hit) return { ...hit, cached: true }

  const resumeProfile = extractResumeLocal(resumeText)
  const jobProfile = extractJobLocal(description)
  const currentReport = scoreMatch(resumeProfile, jobProfile, resumeText)
  const source = collectSourceFacts(resumeText, resumeProfile)
  const jd = extractJdIntelligence(description, jobProfile)
  const evidence = extractRequirementEvidence(jd, source)
  const plan = buildTailoringPlan(currentReport, resumeProfile, {
    source,
    jobDescription: description,
    jobProfile,
    jd,
    evidence,
  })
  const tailored = buildConservativeResume(
    source,
    plan,
    resumeProfile,
    extractContact(resumeText),
    description,
    evidence,
  )
  const tailoredReport = scoreTailoredResume(tailored, jobProfile, resumeProfile)
  const currentMatched = [
    ...currentReport.requiredSkills.matched.map((item) => item.name),
    ...currentReport.preferredSkills.matched.map((item) => item.name),
  ]
  const tailoredMatched = [
    ...tailoredReport.requiredSkills.matched.map((item) => item.name),
    ...tailoredReport.preferredSkills.matched.map((item) => item.name),
  ]
  const stillMissing = [
    ...tailoredReport.requiredSkills.missing.map((item) => item.name),
    ...tailoredReport.preferredSkills.missing.map((item) => item.name),
  ]
  const result: Omit<LiveTailorPreview, 'cached'> = {
    current: toMatch(currentReport.matchScore, currentMatched, [
      ...currentReport.requiredSkills.missing.map((item) => item.name),
      ...currentReport.preferredSkills.missing.map((item) => item.name),
    ], resumeVersionId),
    tailored: toMatch(tailoredReport.matchScore, tailoredMatched, stillMissing, resumeVersionId),
    improvement: tailoredReport.matchScore - currentReport.matchScore,
    matchedSkills: tailoredMatched.slice(0, 8),
    missingSkills: stillMissing.slice(0, 8),
    stillMissing: stillMissing.slice(0, 8),
    cannotReachTargetReason: cannotReachEightyReason(tailoredReport) ?? null,
    previewText: tailoredResumeToText(tailored),
  }
  previewCache.set(key, result)
  return { ...result, cached: false }
}

export function clearLivePreviewCache() {
  previewCache.clear()
}
