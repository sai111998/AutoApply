import { scoreMatch } from '../match/engine'
import { enrichJobWithLocal, enrichResumeWithLocal } from '../match/extract-local'
import { emptyJobProfile, emptyResumeProfile, groundJobProfile, groundResumeProfile } from '../match/ground'
import { parseJobProfile, parseResumeProfile } from '../match/parse-extract'
import type { JobProfile, MatchReport, ResumeProfile } from '../match/types'
import type { LlmClient } from '../services/llm'
import { HttpError } from '../types'
import { evaluateAtsAlignment } from './ats-score'
import { buildConservativeResume, buildOriginalResume } from './conservative'
import { buildCoverageMatrix, extractRequirementEvidence, formatCoverageMatrix } from './evidence'
import { extractJdIntelligence } from './jd-intel'
import {
  classifyMatchGaps,
  cannotReachEightyReason,
  coverageFromMatch,
  formatOptimizationReport,
  lostSupportedNames,
  matchRetryNote,
  preferredCandidate,
  restoreLostEvidence,
  scoreTailoredResume,
} from './match-optimize'
import { parseTailoredResume } from './parse'
import { applyAlignmentToPlan, buildTailoringPlan } from './plan'
import { TAILOR_SYSTEM_PROMPT, tailorUserPrompt } from './prompts'
import { assessTailoredResume } from './quality'
import { groupSkills } from './skills-format'
import { collectSourceFacts, extractContact } from './source'
import type { TailorRequestBody, TailorResponseBody, TailoredResume, TailoringPlan } from './types'
import { VALIDATION_USER_MESSAGE } from './validate'

const MAX_OPTIMIZATION_ATTEMPTS = 2

function asResumeProfile(value: unknown, resumeText: string): ResumeProfile {
  if (!value || typeof value !== 'object') return enrichResumeWithLocal(emptyResumeProfile(), resumeText)
  try {
    return enrichResumeWithLocal(groundResumeProfile(parseResumeProfile(value), resumeText), resumeText)
  } catch {
    return enrichResumeWithLocal(emptyResumeProfile(), resumeText)
  }
}

function asJobProfile(value: unknown, jobText: string): JobProfile {
  if (!value || typeof value !== 'object') return enrichJobWithLocal(emptyJobProfile(), jobText)
  try {
    return enrichJobWithLocal(groundJobProfile(parseJobProfile(value), jobText), jobText)
  } catch {
    return enrichJobWithLocal(emptyJobProfile(), jobText)
  }
}

function asMatchReport(value: unknown): MatchReport | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Partial<MatchReport>
  if (typeof record.matchScore !== 'number') return null
  return record as MatchReport
}

function prepare(request: TailorRequestBody) {
  const resumeText = request.resumeText.trim()
  const jobDescription = request.jobDescription.trim()
  const profile = asResumeProfile(request.resumeProfile, resumeText)
  const jobProfile = asJobProfile(request.jobProfile, jobDescription)
  const incoming = asMatchReport(request.matchReport)
  const scored = scoreMatch(profile, jobProfile, resumeText)
  const report = scored
  const source = collectSourceFacts(resumeText, profile)
  const jd = extractJdIntelligence(jobDescription, jobProfile)
  const evidence = extractRequirementEvidence(jd, source)
  const coverageMatrix = buildCoverageMatrix(evidence)
  const plan = buildTailoringPlan(scored, profile, {
    signals: {
      matched: [
        ...(request.matchSignals?.matched ?? []),
        ...(incoming?.requiredSkills?.matched ?? []).map((item) => item.name),
        ...(incoming?.preferredSkills?.matched ?? []).map((item) => item.name),
      ],
      partial: [
        ...(request.matchSignals?.partial ?? []),
        ...(incoming?.requiredSkills?.partial ?? []).map((item) => item.name),
        ...(incoming?.preferredSkills?.partial ?? []).map((item) => item.name),
      ],
      missing: [
        ...(request.matchSignals?.missing ?? []),
        ...(incoming?.requiredSkills?.missing ?? []).map((item) => item.name),
        ...(incoming?.preferredSkills?.missing ?? []).map((item) => item.name),
        ...(incoming?.certifications?.missing ?? []).map((item) => item.name),
      ],
      strengths: request.matchSignals?.strengths,
      experienceThemes: request.matchSignals?.experienceThemes,
    },
    source,
    jobDescription,
    jobProfile,
    jd,
    evidence,
  })
  const inferred = extractContact(resumeText)
  const contact = {
    name: request.candidateName?.trim() || inferred.name,
    email: request.candidateEmail?.trim() || inferred.email,
    location: request.candidateLocation?.trim() || inferred.location,
  }
  return { resumeText, jobDescription, profile, jobProfile, report, source, plan, contact, jd, evidence, coverageMatrix }
}

function yearsSupported(prepared: ReturnType<typeof prepare>): boolean {
  const requiredYears = prepared.jobProfile.yearsOfExperience
  if (!requiredYears) return true
  const candidateYears = prepared.profile.yearsOfExperience
  return candidateYears != null && candidateYears >= requiredYears
}

function finalizeResume(tailored: TailoredResume, plan: TailoringPlan): TailoredResume {
  if (!tailored.skillGroups?.length && tailored.skills.length) {
    tailored.skillGroups = groupSkills(tailored.skills, plan.roleType)
  }
  if (!tailored.omissions.length) tailored.omissions = plan.missingSkills
  return tailored
}

function withAlignment(
  prepared: ReturnType<typeof prepare>,
  original: TailoredResume,
  tailored: TailoredResume | null,
  validation: ReturnType<typeof assessTailoredResume>,
  status: TailorResponseBody['status'],
  message?: string,
  iterations = 1,
): TailorResponseBody {
  const scoredResume = tailored ?? original
  const alignment = evaluateAtsAlignment({
    jd: prepared.jd,
    records: prepared.evidence,
    original,
    tailored: scoredResume,
    yearsSupported: yearsSupported(prepared),
  })
  const matchAfterReport = scoreTailoredResume(scoredResume, prepared.jobProfile, prepared.profile)
  const matchBefore = coverageFromMatch(prepared.report)
  const matchAfter = coverageFromMatch(matchAfterReport)
  const ceiling = cannotReachEightyReason(matchAfterReport)
  const plan = applyAlignmentToPlan(
    { ...prepared.plan, unsupportedRequirements: prepared.plan.missingSkills },
    alignment,
    matchBefore,
    matchAfter,
    iterations,
  )
  return {
    status,
    plan,
    original,
    tailored,
    tailoredResume: tailored,
    validation,
    factualValidation: {
      passed: Boolean(validation.factualValidation ?? validation.ok),
      issues: validation.ok ? [] : validation.errors,
    },
    atsAlignmentScore: alignment.atsAlignmentScore,
    supportedCoverageBefore: matchBefore.supportedCount,
    supportedCoverageAfter: matchAfter.supportedCount,
    requiredCoverage: alignment.requiredCoverage,
    preferredCoverage: alignment.preferredCoverage,
    responsibilityCoverage: matchAfter.responsibilityCoverage,
    experienceAlignment: alignment.experienceAlignment,
    keywordAlignment: alignment.keywordAlignment,
    educationAlignment: alignment.educationAlignment,
    unsupportedRequirements: plan.missingSkills,
    summary: plan.alignmentSummary,
    message,
    originalMatchScore: matchBefore.matchScore,
    tailoredMatchScore: matchAfter.matchScore,
    matchScoreDelta: matchAfter.matchScore - matchBefore.matchScore,
    optimizationIterations: iterations,
    requiredMatchedBefore: matchBefore.requiredMatched,
    requiredMatchedAfter: matchAfter.requiredMatched,
    preferredMatchedBefore: matchBefore.preferredMatched,
    preferredMatchedAfter: matchAfter.preferredMatched,
    responsibilityCoverageBefore: matchBefore.responsibilityCoverage,
    responsibilityCoverageAfter: matchAfter.responsibilityCoverage,
    cannotReachEightyReason: ceiling,
  }
}

function conservativeResult(
  prepared: ReturnType<typeof prepare>,
  message?: string,
  iterations = 1,
): TailorResponseBody {
  const original = buildOriginalResume(prepared.source, prepared.contact)
  const tailored = finalizeResume(
    buildConservativeResume(
      prepared.source,
      prepared.plan,
      prepared.profile,
      prepared.contact,
      prepared.jobDescription,
      prepared.evidence,
    ),
    prepared.plan,
  )
  const validation = assessTailoredResume(tailored, prepared.source, prepared.plan)
  return withAlignment(
    prepared,
    original,
    validation.ok ? tailored : null,
    validation,
    validation.ok ? 'complete' : 'invalid',
    validation.ok ? message : VALIDATION_USER_MESSAGE,
    iterations,
  )
}

async function generateWithLlm(
  llm: LlmClient,
  prepared: ReturnType<typeof prepare>,
  optimizationReport: string,
  retryNote?: string,
): Promise<TailoredResume> {
  const raw = await llm.extractJson(
    TAILOR_SYSTEM_PROMPT,
    tailorUserPrompt({
      resumeText: prepared.resumeText,
      jobDescription: prepared.jobDescription,
      plan: prepared.plan,
      profile: prepared.profile,
      jobProfile: prepared.jobProfile,
      report: prepared.report,
      source: prepared.source,
      contact: prepared.contact,
      jd: prepared.jd,
      coverageMatrix: formatCoverageMatrix(prepared.coverageMatrix),
      optimizationReport,
      retryNote,
    }),
  )
  return parseTailoredResume(raw, prepared.contact)
}

function evaluateCandidate(
  prepared: ReturnType<typeof prepare>,
  original: TailoredResume,
  resume: TailoredResume,
) {
  const restored = restoreLostEvidence(
    resume,
    prepared.source,
    lostSupportedNames(
      prepared.report,
      scoreTailoredResume(resume, prepared.jobProfile, prepared.profile),
    ),
  )
  const finalized = finalizeResume(restored, prepared.plan)
  const validation = assessTailoredResume(finalized, prepared.source, prepared.plan)
  const match = scoreTailoredResume(finalized, prepared.jobProfile, prepared.profile)
  const alignment = evaluateAtsAlignment({
    jd: prepared.jd,
    records: prepared.evidence,
    original,
    tailored: finalized,
    yearsSupported: yearsSupported(prepared),
  })
  return { resume: finalized, validation, match, coverageAfter: alignment.supportedCoverageAfter }
}

export async function tailorResume(
  llm: LlmClient,
  request: TailorRequestBody,
): Promise<TailorResponseBody> {
  const resumeText = request.resumeText.trim()
  const jobDescription = request.jobDescription.trim()
  if (!resumeText) throw new HttpError(400, 'Upload a resume before tailoring.')
  if (!jobDescription) throw new HttpError(400, 'Analyze a job before tailoring your resume.')

  const prepared = prepare(request)
  const original = buildOriginalResume(prepared.source, prepared.contact)
  const gaps = classifyMatchGaps(prepared.report, prepared.source, prepared.evidence)
  const optimizationReport = formatOptimizationReport(prepared.report, gaps)
  const conservative = evaluateCandidate(
    prepared,
    original,
    buildConservativeResume(
      prepared.source,
      prepared.plan,
      prepared.profile,
      prepared.contact,
      prepared.jobDescription,
      prepared.evidence,
    ),
  )

  let lastError: string | undefined
  let best = conservative.validation.ok ? conservative : null
  let iterations = 1

  for (let attempt = 0; attempt < MAX_OPTIMIZATION_ATTEMPTS; attempt += 1) {
    try {
      const retryNote =
        attempt === 0
          ? undefined
          : best
            ? matchRetryNote(prepared.report, best.match, gaps)
            : `Represent supported Match Engine requirements more clearly without inventing facts: ${prepared.plan.skillsToEmphasize.join(', ')}.`
      const generated = await generateWithLlm(llm, prepared, optimizationReport, retryNote)
      const candidate = evaluateCandidate(prepared, original, generated)
      iterations = attempt + 1
      if (!candidate.validation.ok) {
        lastError = 'Generated a conservative tailored draft because generated content could not be verified.'
        continue
      }
      best = best ? (preferredCandidate(prepared.report, best, candidate).resume === candidate.resume ? candidate : best) : candidate
      const lost = lostSupportedNames(prepared.report, candidate.match)
      const moreLegitimateWork =
        gaps.some((gap) => gap.action === 'optimize' && (gap.kind === 'hidden' || gap.kind === 'partial')) &&
        candidate.match.matchScore < 80
      if (lost.length === 0 && (candidate.match.matchScore >= 80 || !moreLegitimateWork || attempt === MAX_OPTIMIZATION_ATTEMPTS - 1)) {
        break
      }
    } catch (error) {
      if (error instanceof HttpError && error.status !== 503 && error.status !== 504 && error.status !== 502) {
        throw error
      }
      lastError =
        error instanceof HttpError
          ? 'Generated a conservative tailored draft because the AI model was unavailable.'
          : 'Generated a conservative tailored draft because the AI response was invalid.'
      if (!(error instanceof HttpError)) continue
      break
    }
  }

  if (!best || !best.validation.ok) {
    return conservativeResult(prepared, lastError, iterations)
  }

  if (!best.resume.omissions.length) best.resume.omissions = prepared.plan.missingSkills
  if (!best.resume.changes.length) best.resume.changes = conservative.resume.changes

  return withAlignment(
    prepared,
    original,
    best.resume,
    best.validation,
    'complete',
    lastError && best.resume === conservative.resume ? lastError : undefined,
    iterations,
  )
}

export function validateSubmittedResume(request: TailorRequestBody, tailored: TailoredResume) {
  const prepared = prepare(request)
  return { plan: prepared.plan, validation: assessTailoredResume(tailored, prepared.source, prepared.plan) }
}

export function conservativeTailor(request: TailorRequestBody): TailorResponseBody {
  return conservativeResult(prepare(request))
}
