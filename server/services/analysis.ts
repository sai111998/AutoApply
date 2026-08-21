import type { LlmClient } from './llm'
import { persistAnalysis, type PersistResult } from './persist'
import { parseAnalysisResult } from './parse-result'
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
      title: optionalText(record.title),
      company: optionalText(record.company),
      location: optionalText(record.location),
      jobUrl: optionalText(record.jobUrl),
    }
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : 'Invalid request')
  }
}

export type PersistFn = typeof persistAnalysis

export async function analyzeJobDescription(
  config: ServerConfig,
  llm: LlmClient,
  request: AnalyzeJobRequestBody,
  persist: PersistFn = persistAnalysis,
): Promise<{ result: AnalysisResult; persist: PersistResult }> {
  const raw = await llm.complete(request.jobDescription, request.resumeText)
  let result: AnalysisResult
  try {
    result = parseAnalysisResult(raw)
  } catch (error) {
    throw new HttpError(502, error instanceof Error ? error.message : 'Invalid analysis payload')
  }
  const persistResult = await persist(config, request, result)
  return { result, persist: persistResult }
}

export function toResponseBody(
  result: AnalysisResult,
  persist: PersistResult,
): AnalyzeJobResponseBody {
  return {
    ...result,
    persisted: persist.persisted,
    jobId: persist.jobId,
    matchId: persist.matchId,
  }
}
