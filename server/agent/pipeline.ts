import { conservativeTailor } from '../tailor/engine'
import { tailoredResumeToText } from '../tailor/match-optimize'
import { classifyApplicationCapability } from '../apply/capability'
import { inspectApplicationUrl } from '../apply/validate'
import {
  applicationIdentity,
  hasDuplicateApplication,
  hasDuplicateQueueEntry,
  hasRequiredCandidateInformation,
  isExcludedCompany,
  isJobExpired,
  isJobLive,
  jobApplicationUrl,
  meetsMatchThreshold,
} from '../apply/eligibility'
import { resolveGreenhouseQuestions } from '../apply/greenhouse-questions'
import type { AutoApplyQueueItem, AutoApplyStartInput, ListedAutoApplyJob } from '../apply/types'
import type { GreenhouseQuestion } from '../jobs/providers/greenhouse'
import { scoreJobAgainstResume } from '../jobs/score'
import type { NormalizedJob } from '../jobs/types'
import { c2cOnly } from './policy'

export const ELIGIBILITY_STAGES = [
  'discover',
  'normalize',
  'deduplicate',
  'validate',
  'current_match',
  'auto_tailor',
  're_score',
  'final_eligibility',
  'c2c',
  'application_capability',
  'queue',
] as const

export type EligibilityStage = (typeof ELIGIBILITY_STAGES)[number]

export const PIPELINE_ERROR_CODES = ['DISCOVERY_FAILED', 'FILTER_ERROR', 'MATCH_ERROR', 'CAPABILITY_ERROR'] as const
export type PipelineErrorCode = (typeof PIPELINE_ERROR_CODES)[number]

export interface EligibilityContext {
  startInput: AutoApplyStartInput
  existingIdentities?: string[]
  previousItems?: AutoApplyQueueItem[]
}

export interface EligibilityResult {
  ok: boolean
  stage: EligibilityStage
  reason: string | null
  identity: string
  applicationUrl: string | null
  initialScore: number | null
  finalScore: number | null
  tailoredScore: number | null
  tailoredText: string | null
  resumeVersionId: string | null
  resumeVersionName: string
  capability: ReturnType<typeof classifyApplicationCapability>['capability']
  questions: AutoApplyQueueItem['questions']
  code?: PipelineErrorCode | null
}

export interface EligibilityFunnel {
  discovered: number
  afterKeywords: number
  afterLocation: number
  afterRemote: number
  afterEmploymentType: number
  afterDuplicates: number
  afterMatch: number
  afterC2c: number
  eligible: number
  autoApplyCapable: number
  threshold: number
  autoTailor: boolean
  jobType: string
  remote: string
  keywords: string[]
  code: 'OK' | PipelineErrorCode
  lastDiscoveryAt: string | null
  lastEligibilityAt: string | null
  schedulerRunning: boolean
  matchErrors: number
  capabilityErrors: number
}

export function emptyEligibilityFunnel(partial: Partial<EligibilityFunnel> = {}): EligibilityFunnel {
  return {
    discovered: 0,
    afterKeywords: 0,
    afterLocation: 0,
    afterRemote: 0,
    afterEmploymentType: 0,
    afterDuplicates: 0,
    afterMatch: 0,
    afterC2c: 0,
    eligible: 0,
    autoApplyCapable: 0,
    threshold: 70,
    autoTailor: true,
    jobType: 'all',
    remote: 'any',
    keywords: [],
    code: 'OK',
    lastDiscoveryAt: null,
    lastEligibilityAt: null,
    schedulerRunning: false,
    matchErrors: 0,
    capabilityErrors: 0,
    ...partial,
  }
}

function finiteScore(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readListedScore(job: ListedAutoApplyJob): number | null {
  const fromMatch = finiteScore(job.match?.score)
  if (fromMatch != null) return fromMatch
  return finiteScore(job.matchScore)
}

function scoreWithMatchEngine(
  job: ListedAutoApplyJob,
  resumeText: string,
  resumeVersionId?: string | null,
): number | null {
  const match = scoreJobAgainstResume(job as unknown as NormalizedJob, resumeText, resumeVersionId)
  return finiteScore(match.score)
}

function bestScore(scores: Array<number | null>): number | null {
  return scores.reduce<number | null>((best, score) => {
    if (score == null) return best
    if (best == null) return score
    return Math.max(best, score)
  }, null)
}

function tailorResumeText(input: { resumeText: string; job: ListedAutoApplyJob }): string {
  const result = conservativeTailor({
    resumeText: input.resumeText,
    jobDescription: input.job.description ?? '',
  })
  const tailored = result.tailored ?? result.original
  return tailoredResumeToText(tailored)
}

export function evaluateJobEligibility(job: ListedAutoApplyJob, context: EligibilityContext): EligibilityResult {
  const { startInput } = context
  const identity = applicationIdentity(job)
  const applicationUrl = jobApplicationUrl(job)
  const currentResumeVersionId = startInput.resumeVersionId ?? startInput.resumeId ?? null
  let initialScore = readListedScore(job)
  const classified = () =>
    classifyApplicationCapability({
      url: job.url,
      applicationUrl,
      discoveryProvider: job.discoveryProvider || job.provider,
    })
  const fail = (stage: EligibilityStage, reason: string, code?: PipelineErrorCode | null): EligibilityResult => ({
    ok: false,
    stage,
    reason,
    identity,
    applicationUrl,
    initialScore,
    finalScore: initialScore,
    tailoredScore: null,
    tailoredText: null,
    resumeVersionId: currentResumeVersionId,
    resumeVersionName: 'Master',
    capability: classified().capability,
    questions: [],
    code: code ?? null,
  })

  if (hasDuplicateApplication(job, startInput.existingApplications) || hasDuplicateQueueEntry(job, context.existingIdentities)) {
    return fail('deduplicate', 'This job is already in Applications or the Auto Apply queue.')
  }
  if (isExcludedCompany(job.company, startInput.config.excludedCompanies)) {
    return fail('validate', 'This company is excluded from Auto Apply.')
  }
  if (!applicationUrl || !isJobLive(job) || isJobExpired(job) || !inspectApplicationUrl(applicationUrl).ok) {
    return fail('validate', 'This listing is missing a live application URL.')
  }
  if (!hasRequiredCandidateInformation(startInput.profile)) {
    return fail('validate', 'Required candidate information is missing.')
  }

  if (initialScore == null) {
    try {
      initialScore = scoreWithMatchEngine(job, startInput.resumeText, currentResumeVersionId)
    } catch {
      if (!startInput.config.autoTailorResume) {
        return fail('current_match', 'MATCH_ERROR', 'MATCH_ERROR')
      }
    }
  }

  if (!startInput.config.autoTailorResume) {
    if (initialScore == null) return fail('current_match', 'Match score is missing.', 'MATCH_ERROR')
    if (!meetsMatchThreshold(initialScore, startInput.config.minimumMatchRate)) {
      return fail('current_match', 'Match score is below the selected threshold.')
    }
  }

  let tailoredScore: number | null = null
  let tailoredText: string | null = null
  let resumeVersionName = 'Master'
  let resumeVersionId = currentResumeVersionId
  if (startInput.config.autoTailorResume) {
    const reused = (context.previousItems ?? []).find(
      (item) => item.identityKey === identity && Boolean(item.tailoredResumeText?.trim()) && /tailored/i.test(item.resumeVersionName),
    )
    const tailoredVersionId = reused?.resumeVersionId || `tailored:${identity}`
    try {
      tailoredText = reused?.tailoredResumeText?.trim()
        ? reused.tailoredResumeText
        : tailorResumeText({ resumeText: startInput.resumeText, job })
      resumeVersionName = reused?.resumeVersionName || `Tailored v1 — ${job.title}`
      resumeVersionId = tailoredVersionId
      tailoredScore = scoreWithMatchEngine(job, tailoredText, tailoredVersionId)
    } catch {
      return fail('re_score', 'MATCH_ERROR', 'MATCH_ERROR')
    }
  }

  const qualifyingScore = startInput.config.autoTailorResume ? bestScore([initialScore, tailoredScore]) : initialScore
  if (qualifyingScore == null) return fail('final_eligibility', 'Match score is missing.', 'MATCH_ERROR')
  if (!meetsMatchThreshold(qualifyingScore, startInput.config.minimumMatchRate)) {
    return fail('final_eligibility', 'Match score is below the selected threshold.')
  }
  if (c2cOnly({ jobType: startInput.config.jobType }) && job.c2cStatus !== 'confirmed') {
    return fail('c2c', 'C2C-only mode requires a confirmed C2C job.')
  }

  const structured = Array.isArray(job.rawMetadata?.applicationQuestions)
    ? resolveGreenhouseQuestions(
        job.rawMetadata.applicationQuestions as GreenhouseQuestion[],
        startInput.profile,
        startInput.userId,
      )
    : { answered: [] as AutoApplyQueueItem['questions'], unknown: [] as AutoApplyQueueItem['questions'] }

  return {
    ok: true,
    stage: 'final_eligibility',
    reason: null,
    identity,
    applicationUrl,
    initialScore,
    finalScore: qualifyingScore,
    tailoredScore,
    tailoredText,
    resumeVersionId,
    resumeVersionName,
    capability: classified().capability,
    questions: structured.answered,
    code: null,
  }
}
