import type { AnalyzeJobApiRequest, AnalyzeJobApiResult, AnalyzeJobClientResponse } from './types'

function apiUrl(path: string): string {
  const base = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/$/, '') ?? ''
  return `${base}${path}`
}

function isAnalysisResult(value: unknown): value is AnalyzeJobApiResult {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.matchScore === 'number' &&
    (record.recommendation === 'APPLY' ||
      record.recommendation === 'REVIEW' ||
      record.recommendation === 'SKIP') &&
    Array.isArray(record.matchedSkills) &&
    Array.isArray(record.partiallyMatchedSkills) &&
    Array.isArray(record.missingSkills) &&
    typeof record.experienceMatch === 'boolean' &&
    typeof record.educationMatch === 'boolean' &&
    typeof record.locationMatch === 'boolean' &&
    Array.isArray(record.strengths) &&
    Array.isArray(record.concerns) &&
    typeof record.summary === 'string' &&
    (record.confidence === undefined ||
      record.confidence === 'HIGH' ||
      record.confidence === 'MEDIUM' ||
      record.confidence === 'LOW')
  )
}

export async function getAnalysisHealth(): Promise<{
  ok: boolean
  llmConfigured: boolean
  databaseConfigured: boolean
}> {
  try {
    const response = await fetch(apiUrl('/api/health'))
    if (!response.ok) {
      return { ok: false, llmConfigured: false, databaseConfigured: false }
    }
    const body = (await response.json()) as {
      ok?: boolean
      llmConfigured?: boolean
      databaseConfigured?: boolean
    }
    return {
      ok: Boolean(body.ok),
      llmConfigured: Boolean(body.llmConfigured),
      databaseConfigured: Boolean(body.databaseConfigured),
    }
  } catch {
    return { ok: false, llmConfigured: false, databaseConfigured: false }
  }
}

export async function analyzeJobRequest(payload: AnalyzeJobApiRequest): Promise<AnalyzeJobClientResponse> {
  try {
    const response = await fetch(apiUrl('/api/jobs/analyze'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jobDescription: payload.jobDescription,
        resumeText: payload.resumeText,
        userId: payload.userId,
        resumeId: payload.resumeId,
        title: payload.title,
        company: payload.company,
        location: payload.location,
        jobUrl: payload.jobUrl,
      }),
    })

    const body: unknown = await response.json().catch(() => null)

    if (!response.ok) {
      const message =
        body && typeof body === 'object' && 'error' in body && typeof (body as { error: unknown }).error === 'string'
          ? (body as { error: string }).error
          : `Analysis API returned ${response.status}.`
      return { status: 'failed', message }
    }

    if (!isAnalysisResult(body)) {
      return { status: 'failed', message: 'Analysis API returned an unexpected payload.' }
    }

    return { status: 'complete', result: body }
  } catch (error) {
    return {
      status: 'failed',
      message: error instanceof Error ? error.message : 'Could not reach the analysis API.',
    }
  }
}
