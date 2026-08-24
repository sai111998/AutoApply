import { hashResumeText, loadResumeProfile, saveResumeProfile } from '../match/cache'
import { scoreMatch, toLegacyArrays } from '../match/engine'
import { publicErrorMessage } from '../match/errors'
import { groundJobProfile, groundResumeProfile } from '../match/ground'
import { parseJobProfile, parseResumeProfile } from '../match/parse-extract'
import type { MatchReport } from '../match/types'
import type { LlmClient } from './llm'
import { persistAnalysis, type PersistResult } from './persist'
import { optionalText, requireNonEmptyText } from './validate'
import type { ServerConfig } from '../config'
import type { AnalysisResult, AnalyzeJobRequestBody, AnalyzeJobResponseBody } from '../types'
import { HttpError } from '../types'

export function parseAnalyzeRequest(body: unknown): AnalyzeJobRequestBody {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'Request body must be a JSON object')
  }
  const record = body as Record<string, unknown>
  try {
    return {
      jobDescription: requireNonEmptyText(record.jobDescription, 'jobDescription'),
      resumeText: requireNonEmptyText(record.resumeText, 'resumeText'),
      userId: optionalText(record.userId),
      resumeId: optionalText(record.resumeId),
      jobId: optionalText(record.jobId),
      matchId: optionalText(record.matchId),
      applicationId: optionalText(record.applicationId),
      title: optionalText(record.title),
      company: optionalText(record.company),
      location: optionalText(record.location),
      jobUrl: optionalText(record.jobUrl),
      resumeProfile: record.resumeProfile,
      jobProfile: record.jobProfile,
      persistResults: record.persistResults === false ? false : undefined,
    }
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : 'Invalid request')
  }
}

export type PersistFn = typeof persistAnalysis

function toAnalysisResult(report: MatchReport): AnalysisResult {
  const legacy = toLegacyArrays(report)
  return {
    matchScore: report.matchScore,
    recommendation: report.recommendation,
    confidence: report.confidence,
    ...legacy,
    strengths: report.strengths,
    concerns: report.concerns,
    summary: report.summary,
    requiredSkills: report.requiredSkills,
    preferredSkills: report.preferredSkills,
    experience: report.experience,
    responsibilities: report.responsibilities,
    education: report.education,
    certifications: report.certifications,
    locationFit: report.location,
    missingEvidence: report.missingEvidence,
    report,
  }
}

export async function analyzeJobDescription(
  config: ServerConfig,
  llm: LlmClient,
  request: AnalyzeJobRequestBody,
  persist: PersistFn = persistAnalysis,
): Promise<{ result: AnalysisResult; persist: PersistResult }> {
  const resumeHash = hashResumeText(request.resumeText)
  let resumeProfile = request.resumeProfile
    ? groundResumeProfile(parseResumeProfile(request.resumeProfile), request.resumeText)
    : await loadResumeProfile(config, request.resumeId, resumeHash)

  if (!resumeProfile) {
    let rawResume: unknown
    try {
      rawResume = await llm.extractResume(request.resumeText)
    } catch (error) {
      if (error instanceof HttpError) throw error
      throw new HttpError(502, publicErrorMessage(error, 'Resume extraction failed.'))
    }
    try {
      resumeProfile = groundResumeProfile(parseResumeProfile(rawResume), request.resumeText)
    } catch (error) {
      throw new HttpError(502, error instanceof Error ? error.message : 'Invalid resume extraction payload')
    }
    await saveResumeProfile(config, request.resumeId, resumeHash, resumeProfile)
  }

  let jobProfile
  if (request.jobProfile) {
    try {
      jobProfile = groundJobProfile(parseJobProfile(request.jobProfile), request.jobDescription)
    } catch (error) {
      throw new HttpError(502, error instanceof Error ? error.message : 'Invalid job profile payload')
    }
  } else {
    let rawJob: unknown
    try {
      rawJob = await llm.extractJob(request.jobDescription)
    } catch (error) {
      if (error instanceof HttpError) throw error
      throw new HttpError(502, publicErrorMessage(error, 'Job extraction failed.'))
    }

    try {
      jobProfile = groundJobProfile(parseJobProfile(rawJob), request.jobDescription)
    } catch (error) {
      throw new HttpError(502, error instanceof Error ? error.message : 'Invalid job extraction payload')
    }
  }

  const report = scoreMatch(resumeProfile, jobProfile, request.resumeText)
  const result = toAnalysisResult(report)

  if (request.persistResults === false) {
    return {
      result,
      persist: { persisted: false, jobId: request.jobId ?? null, matchId: request.matchId ?? null },
    }
  }

  let persistResult: PersistResult
  try {
    persistResult = await persist(config, request, result)
  } catch {
    persistResult = { persisted: false, jobId: null, matchId: null }
  }

  return { result, persist: persistResult }
}

export function toResponseBody(result: AnalysisResult, persist: PersistResult): AnalyzeJobResponseBody {
  return {
    ...result,
    persisted: persist.persisted,
    jobId: persist.jobId,
    matchId: persist.matchId,
  }
}
