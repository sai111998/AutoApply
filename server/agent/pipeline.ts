import { conservativeTailor } from '../tailor/engine'
import { tailoredResumeToText } from '../tailor/match-optimize'
import { canEnterAutonomousApply, classifyApplicationCapability } from '../apply/capability'
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
import { preflightApplication } from '../apply/preflight'
import type { AutoApplyQueueItem, AutoApplyStartInput, ListedAutoApplyJob } from '../apply/types'
import type { GreenhouseQuestion } from '../jobs/providers/greenhouse'
import { c2cOnly } from './policy'

export const ELIGIBILITY_STAGES = [
  'discover',
  'normalize',
  'deduplicate',
  'validate',
  'current_match',
  'c2c',
  'application_capability',
  'auto_tailor',
  're_score',
  'final_eligibility',
  'queue',
] as const

export type EligibilityStage = (typeof ELIGIBILITY_STAGES)[number]

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
  tailoredText: string | null
  resumeVersionName: string
  capability: ReturnType<typeof classifyApplicationCapability>['capability']
  questions: AutoApplyQueueItem['questions']
}

function tailorForJob(resumeText: string, job: ListedAutoApplyJob) {
  const result = conservativeTailor({
    resumeText,
    jobDescription: job.description ?? '',
  })
  const tailored = result.tailored ?? result.original
  return {
    score: result.tailoredMatchScore ?? result.originalMatchScore ?? 0,
    text: tailoredResumeToText(tailored),
  }
}

export function evaluateJobEligibility(job: ListedAutoApplyJob, context: EligibilityContext): EligibilityResult {
  const { startInput } = context
  const identity = applicationIdentity(job)
  const applicationUrl = jobApplicationUrl(job)
  const initialScore = job.match?.score ?? job.matchScore ?? null
  const fail = (stage: EligibilityStage, reason: string): EligibilityResult => ({
    ok: false,
    stage,
    reason,
    identity,
    applicationUrl,
    initialScore,
    finalScore: initialScore,
    tailoredText: null,
    resumeVersionName: 'Master',
    capability: classifyApplicationCapability({
      url: job.url,
      applicationUrl,
      discoveryProvider: job.discoveryProvider || job.provider,
    }).capability,
    questions: [],
  })

  if (hasDuplicateApplication(job, startInput.existingApplications) || hasDuplicateQueueEntry(job, context.existingIdentities)) {
    return fail('deduplicate', 'This job is already in Applications or the Auto Apply queue.')
  }
  if (isExcludedCompany(job.company, startInput.config.excludedCompanies)) {
    return fail('validate', 'This company is excluded from Auto Apply.')
  }
  if (!applicationUrl || !isJobLive(job) || isJobExpired(job)) {
    return fail('validate', 'This listing is missing a live application URL.')
  }
  if (!hasRequiredCandidateInformation(startInput.profile)) {
    return fail('validate', 'Required candidate information is missing.')
  }
  if (!startInput.config.autoTailorResume && !meetsMatchThreshold(initialScore, startInput.config.minimumMatchRate)) {
    return fail('current_match', 'Match score is below the selected threshold.')
  }
  if (c2cOnly({ jobType: startInput.config.jobType }) && job.c2cStatus !== 'confirmed') {
    return fail('c2c', 'C2C-only mode requires a confirmed C2C job.')
  }

  const capability = classifyApplicationCapability({
    url: job.url,
    applicationUrl,
    discoveryProvider: job.discoveryProvider || job.provider,
  })
  const staticPreflight = preflightApplication({
    url: job.url,
    applicationUrl,
    provider: job.provider,
  })
  if (!canEnterAutonomousApply(capability.capability) || !canEnterAutonomousApply(staticPreflight.capability)) {
    return fail('application_capability', 'This listing is not Auto-Apply capable.')
  }

  let finalScore = initialScore
  let tailoredText: string | null = null
  let resumeVersionName = 'Master'
  if (startInput.config.autoTailorResume) {
    const reused = (context.previousItems ?? []).find(
      (item) => item.identityKey === identity && Boolean(item.tailoredResumeText?.trim()) && /tailored/i.test(item.resumeVersionName),
    )
    if (reused?.tailoredResumeText) {
      finalScore = reused.finalMatchScore ?? initialScore
      tailoredText = reused.tailoredResumeText
      resumeVersionName = reused.resumeVersionName
    } else {
      const tailored = tailorForJob(startInput.resumeText, job)
      finalScore = tailored.score
      tailoredText = tailored.text
      resumeVersionName = `Tailored v1 — ${job.title}`
    }
  }

  if (!meetsMatchThreshold(finalScore, startInput.config.minimumMatchRate)) {
    return fail('final_eligibility', 'Match score is below the selected threshold.')
  }

  const structured = Array.isArray(job.rawMetadata?.applicationQuestions)
    ? resolveGreenhouseQuestions(
        job.rawMetadata.applicationQuestions as GreenhouseQuestion[],
        startInput.profile,
        startInput.userId,
      )
    : { answered: [] as AutoApplyQueueItem['questions'], unknown: [] as AutoApplyQueueItem['questions'] }
  if (structured.unknown.length) {
    return fail('final_eligibility', 'Unknown required application questions need user input.')
  }

  return {
    ok: true,
    stage: 'queue',
    reason: null,
    identity,
    applicationUrl,
    initialScore,
    finalScore,
    tailoredText,
    resumeVersionName,
    capability: capability.capability,
    questions: structured.answered,
  }
}
