import { scoreMatch } from '../match/engine'
import { enrichJobWithLocal, enrichResumeWithLocal } from '../match/extract-local'
import { emptyJobProfile, emptyResumeProfile, groundJobProfile, groundResumeProfile } from '../match/ground'
import { parseJobProfile, parseResumeProfile } from '../match/parse-extract'
import type { JobProfile, MatchReport, ResumeProfile } from '../match/types'
import type { LlmClient } from '../services/llm'
import { HttpError } from '../types'
import { buildConservativeResume, buildOriginalResume } from './conservative'
import { parseTailoredResume } from './parse'
import { buildTailoringPlan } from './plan'
import { TAILOR_SYSTEM_PROMPT, tailorUserPrompt } from './prompts'
import { assessTailoredResume } from './quality'
import { collectSourceFacts, extractContact } from './source'
import type { TailorRequestBody, TailorResponseBody, TailoredResume } from './types'
import { VALIDATION_USER_MESSAGE } from './validate'

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
  const report = incoming ?? scored
  const source = collectSourceFacts(resumeText, profile)
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
  })
  const inferred = extractContact(resumeText)
  const contact = {
    name: request.candidateName?.trim() || inferred.name,
    email: request.candidateEmail?.trim() || inferred.email,
    location: request.candidateLocation?.trim() || inferred.location,
  }
  return { resumeText, jobDescription, profile, jobProfile, report, source, plan, contact }
}

function conservativeResult(
  prepared: ReturnType<typeof prepare>,
  message?: string,
): TailorResponseBody {
  const tailored = buildConservativeResume(
    prepared.source,
    prepared.plan,
    prepared.profile,
    prepared.contact,
    prepared.jobDescription,
  )
  const validation = assessTailoredResume(tailored, prepared.source, prepared.plan)
  return {
    status: validation.ok ? 'complete' : 'invalid',
    plan: prepared.plan,
    original: buildOriginalResume(prepared.source, prepared.contact),
    tailored: validation.ok ? tailored : null,
    validation,
    message: validation.ok ? message : VALIDATION_USER_MESSAGE,
  }
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
  const conservative = buildConservativeResume(
    prepared.source,
    prepared.plan,
    prepared.profile,
    prepared.contact,
    prepared.jobDescription,
  )

  let raw: unknown
  try {
    raw = await llm.extractJson(
      TAILOR_SYSTEM_PROMPT,
      tailorUserPrompt({
        resumeText,
        jobDescription,
        plan: prepared.plan,
        profile: prepared.profile,
        jobProfile: prepared.jobProfile,
        report: prepared.report,
        source: prepared.source,
        contact: prepared.contact,
      }),
    )
  } catch (error) {
    const fallback = () =>
      conservativeResult(prepared, 'Generated a conservative tailored draft because the AI model was unavailable.')
    if (error instanceof HttpError && (error.status === 503 || error.status === 504 || error.status === 502)) {
      return fallback()
    }
    if (error instanceof HttpError) throw error
    return fallback()
  }

  let tailored: TailoredResume
  try {
    tailored = parseTailoredResume(raw, prepared.contact)
  } catch {
    return conservativeResult(prepared, 'Generated a conservative tailored draft because the AI response was invalid.')
  }

  const validation = assessTailoredResume(tailored, prepared.source, prepared.plan)
  if (!validation.ok) {
    return conservativeResult(prepared, 'Generated a conservative tailored draft because generated content could not be verified.')
  }

  if (!tailored.omissions.length) tailored.omissions = prepared.plan.missingSkills
  if (!tailored.changes.length) tailored.changes = conservative.changes

  return {
    status: 'complete',
    plan: prepared.plan,
    original,
    tailored,
    validation,
  }
}

export function validateSubmittedResume(request: TailorRequestBody, tailored: TailoredResume) {
  const prepared = prepare(request)
  return { plan: prepared.plan, validation: assessTailoredResume(tailored, prepared.source, prepared.plan) }
}

export function conservativeTailor(request: TailorRequestBody): TailorResponseBody {
  return conservativeResult(prepare(request))
}
