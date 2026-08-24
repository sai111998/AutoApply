import { parseJobProfile, parseResumeProfile } from '../match/parse-extract'
import { emptyJobProfile, emptyResumeProfile, groundJobProfile, groundResumeProfile } from '../match/ground'
import type { JobProfile, MatchReport, ResumeProfile } from '../match/types'
import type { LlmClient } from '../services/llm'
import { HttpError } from '../types'
import { buildConservativeResume, buildOriginalResume } from './conservative'
import { parseTailoredResume } from './parse'
import { buildTailoringPlan } from './plan'
import { TAILOR_SYSTEM_PROMPT, tailorUserPrompt } from './prompts'
import { collectSourceFacts, extractContact } from './source'
import type { TailorRequestBody, TailorResponseBody, TailoredResume } from './types'
import { VALIDATION_USER_MESSAGE, validateTailoredResume } from './validate'

function asResumeProfile(value: unknown, resumeText: string): ResumeProfile {
  if (!value || typeof value !== 'object') return emptyResumeProfile()
  try {
    return groundResumeProfile(parseResumeProfile(value), resumeText)
  } catch {
    return emptyResumeProfile()
  }
}

function asJobProfile(value: unknown, jobText: string): JobProfile | null {
  if (!value || typeof value !== 'object') return null
  try {
    return groundJobProfile(parseJobProfile(value), jobText)
  } catch {
    return emptyJobProfile()
  }
}

function asMatchReport(value: unknown): MatchReport | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Partial<MatchReport>
  if (typeof record.matchScore !== 'number') return null
  return record as MatchReport
}

export async function tailorResume(
  llm: LlmClient,
  request: TailorRequestBody,
): Promise<TailorResponseBody> {
  const resumeText = request.resumeText.trim()
  const jobDescription = request.jobDescription.trim()
  if (!resumeText) throw new HttpError(400, 'Upload a resume before tailoring.')
  if (!jobDescription) throw new HttpError(400, 'Analyze a job before tailoring your resume.')

  const profile = request.resumeProfile ? asResumeProfile(request.resumeProfile, resumeText) : emptyResumeProfile()
  const jobProfile = request.jobProfile ? asJobProfile(request.jobProfile, jobDescription) : null
  const report = asMatchReport(request.matchReport)
  const source = collectSourceFacts(resumeText, profile)
  const plan = buildTailoringPlan(report, profile, {
    signals: request.matchSignals,
    source,
    jobDescription,
  })
  const inferred = extractContact(resumeText)
  const contact = {
    name: request.candidateName?.trim() || inferred.name,
    email: request.candidateEmail?.trim() || inferred.email,
    location: request.candidateLocation?.trim() || inferred.location,
  }

  const conservative = buildConservativeResume(source, plan, profile, contact)
  const original = buildOriginalResume(source, contact)

  let raw: unknown
  try {
    raw = await llm.extractJson(
      TAILOR_SYSTEM_PROMPT,
      tailorUserPrompt({
        resumeText,
        jobDescription,
        plan,
        profile,
        jobProfile,
        report,
        source,
        contact,
      }),
    )
  } catch (error) {
    const fallback = () => {
      const validation = validateTailoredResume(conservative, source, plan.missingSkills)
      return {
        status: validation.ok ? 'complete' : 'invalid',
        plan,
        original,
        tailored: validation.ok ? conservative : null,
        validation,
        message: validation.ok
          ? 'Generated a conservative tailored draft because the AI model was unavailable.'
          : VALIDATION_USER_MESSAGE,
      } satisfies TailorResponseBody
    }
    if (error instanceof HttpError && (error.status === 503 || error.status === 504 || error.status === 502)) {
      return fallback()
    }
    if (error instanceof HttpError) throw error
    return fallback()
  }

  let tailored: TailoredResume
  try {
    tailored = parseTailoredResume(raw, contact)
  } catch {
    return {
      status: 'invalid',
      plan,
      original,
      tailored: null,
      validation: { ok: false, errors: ['Invalid AI response'] },
      message: VALIDATION_USER_MESSAGE,
    }
  }

  const validation = validateTailoredResume(tailored, source, plan.missingSkills)
  if (!validation.ok) {
    return {
      status: 'invalid',
      plan,
      original,
      tailored: null,
      validation,
      message: VALIDATION_USER_MESSAGE,
    }
  }

  if (!tailored.omissions.length) tailored.omissions = plan.missingSkills
  if (!tailored.changes.length) tailored.changes = conservative.changes

  return {
    status: 'complete',
    plan,
    original,
    tailored,
    validation,
  }
}

export function validateSubmittedResume(request: TailorRequestBody, tailored: TailoredResume) {
  const profile = request.resumeProfile ? asResumeProfile(request.resumeProfile, request.resumeText) : emptyResumeProfile()
  const report = asMatchReport(request.matchReport)
  const source = collectSourceFacts(request.resumeText, profile)
  const plan = buildTailoringPlan(report, profile, {
    signals: request.matchSignals,
    source,
    jobDescription: request.jobDescription,
  })
  return { plan, validation: validateTailoredResume(tailored, source, plan.missingSkills) }
}

export function conservativeTailor(request: TailorRequestBody): TailorResponseBody {
  const profile = request.resumeProfile ? asResumeProfile(request.resumeProfile, request.resumeText) : emptyResumeProfile()
  const report = asMatchReport(request.matchReport)
  const source = collectSourceFacts(request.resumeText, profile)
  const plan = buildTailoringPlan(report, profile, {
    signals: request.matchSignals,
    source,
    jobDescription: request.jobDescription,
  })
  const inferred = extractContact(request.resumeText)
  const contact = {
    name: request.candidateName?.trim() || inferred.name,
    email: request.candidateEmail?.trim() || inferred.email,
    location: request.candidateLocation?.trim() || inferred.location,
  }
  const tailored = buildConservativeResume(source, plan, profile, contact)
  return {
    status: 'complete',
    plan,
    original: buildOriginalResume(source, contact),
    tailored,
    validation: validateTailoredResume(tailored, source, plan.missingSkills),
  }
}
