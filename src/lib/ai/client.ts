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

export async function extractResumeTextRequest(file: File): Promise<string> {
  const response = await fetch(apiUrl('/api/resumes/extract'), {
    method: 'POST',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
      'X-File-Name': file.name,
    },
    body: await file.arrayBuffer(),
  })
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body && typeof (body as { error: unknown }).error === 'string'
        ? (body as { error: string }).error
        : `Resume extraction returned ${response.status}.`
    throw new Error(message)
  }
  if (!body || typeof body !== 'object' || typeof (body as { text?: unknown }).text !== 'string') {
    throw new Error('Resume extraction returned an unexpected payload.')
  }
  const text = (body as { text: string }).text.trim()
  if (!text) {
    throw new Error('No text could be extracted from this resume. Upload a text-based PDF or a .txt file.')
  }
  return text
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
        jobId: payload.jobId,
        matchId: payload.matchId,
        applicationId: payload.applicationId,
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

export async function tailorResumeRequest(payload: Record<string, unknown>) {
  const response = await fetch(apiUrl('/api/resumes/tailor'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) throw new Error('Resume tailoring returned an unexpected payload.')
  if (!response.ok && response.status !== 422) {
    const message = typeof body.error === 'string' ? body.error : 'Resume tailoring failed.'
    throw new Error(message)
  }
  return body
}

export async function validateTailoredResumeRequest(payload: Record<string, unknown>) {
  const response = await fetch(apiUrl('/api/resumes/validate-tailor'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) throw new Error('Could not validate the tailored resume.')
  return { ok: response.ok, body }
}

export async function downloadResumePdfRequest(tailored: unknown, contact: { name?: string; email?: string; location?: string }) {
  const response = await fetch(apiUrl('/api/resumes/pdf'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tailored, contact }),
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error || 'Could not generate the PDF.')
  }
  return response.blob()
}
