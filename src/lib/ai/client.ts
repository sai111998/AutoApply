import type { AnalyzeJobApiRequest, AnalyzeJobApiResult, AnalyzeJobClientResponse } from './types'
import type { Job } from '@/types/domain'

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
  jobProviders: Array<{
    name: string
    label: string
    enabled: boolean
    available: boolean
    connectionLabel: string
  }>
}> {
  try {
    const response = await fetch(apiUrl('/api/health'))
    if (!response.ok) {
      return { ok: false, llmConfigured: false, databaseConfigured: false, jobProviders: [] }
    }
    const body = (await response.json()) as {
      ok?: boolean
      llmConfigured?: boolean
      databaseConfigured?: boolean
      jobProviders?: Array<{
        name: string
        label: string
        enabled: boolean
        available: boolean
        connectionLabel: string
      }>
    }
    return {
      ok: Boolean(body.ok),
      llmConfigured: Boolean(body.llmConfigured),
      databaseConfigured: Boolean(body.databaseConfigured),
      jobProviders: Array.isArray(body.jobProviders) ? body.jobProviders : [],
    }
  } catch {
    return { ok: false, llmConfigured: false, databaseConfigured: false, jobProviders: [] }
  }
}

export interface DiscoverJobsRequest {
  roles?: string[]
  location?: string
  remote?: string
  employmentType?: string
  experienceLevel?: string
  keywords?: string[]
  datePostedDays?: number
  page?: number
  pageSize?: number
  minMatchScore?: number | null
  providers?: string[]
  resumeText?: string
  userId?: string
}

export interface DiscoveredJobResult {
  id: string
  provider: string
  providerJobId: string | null
  title: string
  company: string
  location: string | null
  remote: boolean | null
  workArrangement: string | null
  employmentType: string | null
  seniority?: string | null
  description: string | null
  jobUrl: string | null
  url?: string | null
  postedAt: string | null
  salaryMin: number | null
  salaryMax: number | null
  salaryCurrency: string | null
  source: string
  sourceJobId?: string | null
  discoveredAt: string
  fetchedAt?: string
  lastVerifiedAt: string
  identityKey: string
  matchScore: number | null
  matchedSkills: string[]
  demo: boolean
  liveDemoProvider?: boolean
  rawMetadata?: Record<string, unknown>
}

export interface DiscoverJobsResponse {
  jobs: DiscoveredJobResult[]
  page: number
  pageSize: number
  total: number
  providers: Array<{
    name: string
    label: string
    enabled: boolean
    available: boolean
    connectionLabel: string
  }>
  warnings: Array<{ provider: string; code: string; message: string }>
  hasMore: boolean
  demo: boolean
}

export async function discoverJobsRequest(payload: DiscoverJobsRequest): Promise<DiscoverJobsResponse> {
  const response = await fetch(apiUrl('/api/jobs/discover'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = (await response.json().catch(() => null)) as DiscoverJobsResponse | { error?: string } | null
  if (!response.ok || !body || !('jobs' in body)) {
    const message = body && 'error' in body && typeof body.error === 'string' ? body.error : 'Job discovery failed.'
    throw new Error(/key|secret|service.role/i.test(message) ? 'Job discovery failed.' : message)
  }
  return body
}

export interface LiveJobsQuery {
  q?: string
  country?: string
  state?: string
  remote?: string
  employment_type?: string
  seniority?: string
  page?: number
  limit?: number
}

export interface LiveJobsResponse {
  jobs: DiscoveredJobResult[]
  page: number
  limit: number
  total: number
  hasMore: boolean
  source: string
  warning?: { provider: string; code: string; message: string }
}

export async function listLiveJobsRequest(query: LiveJobsQuery = {}): Promise<LiveJobsResponse> {
  const params = new URLSearchParams()
  if (query.q?.trim()) params.set('q', query.q.trim())
  if (query.country?.trim()) params.set('country', query.country.trim())
  if (query.state?.trim()) params.set('state', query.state.trim())
  if (query.remote && query.remote !== 'any') params.set('remote', query.remote)
  if (query.employment_type && query.employment_type !== 'any') params.set('employment_type', query.employment_type)
  if (query.seniority && query.seniority !== 'any') params.set('seniority', query.seniority)
  if (query.page) params.set('page', String(query.page))
  if (query.limit) params.set('limit', String(query.limit))
  const response = await fetch(apiUrl(`/api/jobs?${params.toString()}`))
  const body = (await response.json().catch(() => null)) as LiveJobsResponse | { error?: string } | null
  if (!response.ok || !body || !('jobs' in body)) {
    const message = body && 'error' in body && typeof body.error === 'string' ? body.error : 'Live job source temporarily unavailable.'
    throw new Error(/key|secret|service.role/i.test(message) ? 'Live job source temporarily unavailable.' : message)
  }
  return body
}

export async function getLiveJobRequest(provider: string, jobId: string): Promise<DiscoveredJobResult> {
  const response = await fetch(apiUrl(`/api/jobs/live/${encodeURIComponent(provider)}/${encodeURIComponent(jobId)}`))
  const body = (await response.json().catch(() => null)) as DiscoveredJobResult | { error?: string } | null
  if (!response.ok || !body || !('title' in body)) {
    const message = body && 'error' in body && typeof body.error === 'string' ? body.error : 'Live job source temporarily unavailable.'
    throw new Error(/key|secret|service.role/i.test(message) ? 'Live job source temporarily unavailable.' : message)
  }
  return body
}

export async function saveDiscoveredJobRequest(payload: { userId: string; job: Job }) {
  const response = await fetch(apiUrl('/api/jobs/save'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: payload.userId,
      job: {
        id: payload.job.id,
        provider: payload.job.provider,
        providerJobId: payload.job.providerJobId,
        title: payload.job.title,
        company: payload.job.company,
        location: payload.job.location,
        remote: payload.job.remote,
        workArrangement: payload.job.workArrangement,
        employmentType: payload.job.employmentType,
        seniority: payload.job.seniority,
        description: payload.job.description,
        jobUrl: payload.job.jobUrl,
        postedAt: payload.job.postedAt,
        salaryMin: payload.job.salaryMin,
        salaryMax: payload.job.salaryMax,
        salaryCurrency: payload.job.salaryCurrency,
        source: payload.job.source,
        identityKey: payload.job.identityKey,
        discoveredAt: payload.job.discoveredAt,
        lastVerifiedAt: payload.job.lastVerifiedAt,
      },
    }),
  })
  const body = (await response.json().catch(() => null)) as { error?: string; jobId?: string } | null
  if (!response.ok) {
    throw new Error(body?.error && !/key|secret|service.role/i.test(body.error) ? body.error : 'Could not save the job.')
  }
  return body
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
        resumeProfile: payload.resumeProfile,
        jobProfile: payload.jobProfile,
        persistResults: payload.persistResults,
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
  const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 70_000)
    try {
      const response = await fetch(apiUrl('/api/resumes/tailor'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
      const body = (await response.json().catch(() => null)) as Record<string, unknown> | null
      if (!body) throw new Error('Your resume could not be tailored right now. Please try again.')
      if (!response.ok && response.status !== 422) {
        const raw = typeof body.error === 'string' ? body.error : ''
        if (/key|secret|service.role|stack/i.test(raw) || !raw.trim()) {
          throw new Error('Your resume could not be tailored right now. Please try again.')
        }
        throw new Error(raw)
      }
      return body
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Your resume could not be tailored right now. Please try again.')
      }
      throw error
    } finally {
      clearTimeout(timeout)
    }
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
