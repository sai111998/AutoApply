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

export interface LiveJobMatchResult {
  score: number | null
  matchedSkills: string[]
  missingSkills: string[]
  resumeVersionId: string | null
  scoreUpdatedAt: string | null
  cached?: boolean
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
  match?: LiveJobMatchResult
  matchScore: number | null
  matchedSkills: string[]
  missingSkills?: string[]
  demo: boolean
  liveDemoProvider?: boolean
  rawMetadata?: Record<string, unknown>
  c2cStatus?: 'confirmed' | 'not_allowed' | 'unknown'
  c2cEvidence?: Array<{
    matchedPhrase: string
    sourceField: string
    confidence: string
    detectedAt: string
  }>
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
  location?: string
  remote?: string
  employment_type?: string
  seniority?: string
  page?: number
  limit?: number
  sort?: 'match' | 'recent' | 'relevance'
  resumeText?: string
  resumeVersionId?: string
  jobType?: 'all' | 'c2c' | 'contract' | 'w2'
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
  const payload = {
    q: query.q?.trim() || undefined,
    country: query.country?.trim() || undefined,
    state: query.state?.trim() || undefined,
    location: query.location?.trim() || undefined,
    remote: query.remote && query.remote !== 'any' ? query.remote : undefined,
    employment_type: query.employment_type && query.employment_type !== 'any' ? query.employment_type : undefined,
    seniority: query.seniority && query.seniority !== 'any' ? query.seniority : undefined,
    page: query.page,
    limit: query.limit,
    sort: query.sort || 'match',
    resumeText: query.resumeText?.trim() || undefined,
    resumeVersionId: query.resumeVersionId?.trim() || undefined,
    jobType: query.jobType && query.jobType !== 'all' ? query.jobType : undefined,
  }
  const params = new URLSearchParams()
  if (payload.q) params.set('q', payload.q)
  if (payload.country) params.set('country', payload.country)
  if (payload.state) params.set('state', payload.state)
  if (payload.location) params.set('location', payload.location)
  if (payload.remote) params.set('remote', payload.remote)
  if (payload.employment_type) params.set('employment_type', payload.employment_type)
  if (payload.seniority) params.set('seniority', payload.seniority)
  if (payload.page) params.set('page', String(payload.page))
  if (payload.limit) params.set('limit', String(payload.limit))
  if (payload.sort) params.set('sort', payload.sort)
  if (payload.jobType) params.set('jobType', payload.jobType)

  const response = payload.resumeText
    ? await fetch(apiUrl('/api/jobs'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    : await fetch(apiUrl(`/api/jobs?${params.toString()}`))
  const body = (await response.json().catch(() => null)) as LiveJobsResponse | { error?: string } | null
  if (!response.ok || !body || !('jobs' in body)) {
    const message = body && 'error' in body && typeof body.error === 'string' ? body.error : 'Live job source temporarily unavailable.'
    throw new Error(/key|secret|service.role/i.test(message) ? 'Live job source temporarily unavailable.' : message)
  }
  return body
}

export interface LiveTailorPreviewResult {
  current: LiveJobMatchResult
  tailored: LiveJobMatchResult
  improvement: number
  matchedSkills: string[]
  missingSkills: string[]
  stillMissing: string[]
  cannotReachTargetReason: string | null
  previewText: string
  cached?: boolean
}

export async function previewLiveJobRequest(payload: {
  resumeText: string
  resumeVersionId?: string
  job: Pick<
    DiscoveredJobResult,
    'id' | 'providerJobId' | 'title' | 'company' | 'description' | 'sourceJobId'
  >
}): Promise<LiveTailorPreviewResult> {
  const response = await fetch(apiUrl('/api/jobs/preview'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = (await response.json().catch(() => null)) as LiveTailorPreviewResult | { error?: string } | null
  if (!response.ok || !body || !('current' in body) || !('tailored' in body)) {
    const message =
      body && 'error' in body && typeof body.error === 'string' ? body.error : 'Could not preview the tailored resume match.'
    throw new Error(/key|secret|service.role/i.test(message) ? 'Could not preview the tailored resume match.' : message)
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

export async function saveDiscoveredJobRequest(payload: {
  userId: string
  job: Job
  resumeVersionId?: string | null
}) {
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
        matchScore: payload.job.matchScore ?? null,
        resumeVersionId: payload.resumeVersionId ?? null,
        createdAt: payload.job.createdAt,
        rawMetadata: {
          matchScore: payload.job.matchScore ?? null,
          resumeVersionId: payload.resumeVersionId ?? null,
          createdAt: payload.job.createdAt,
        },
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

export type AutoApplyJobType = 'all' | 'c2c' | 'contract' | 'w2'
export type AutoApplyQueueStatus =
  | 'queued'
  | 'preparing'
  | 'tailoring'
  | 'ready'
  | 'opening'
  | 'filling'
  | 'needs_user_input'
  | 'captcha_required'
  | 'mfa_required'
  | 'login_required'
  | 'blocked'
  | 'automation_blocked'
  | 'ready_for_submission'
  | 'submitting'
  | 'needs_user_confirmation'
  | 'submitted'
  | 'failed'
  | 'skipped'
  | 'cancelled'

export interface AutoApplyConfigPayload {
  maxJobs: number
  minimumMatchRate: number
  autoTailorResume: boolean
  jobType: AutoApplyJobType
  remotePreference: string
  keywords: string[]
  q?: string
  country?: string
  state?: string
  location?: string
}

export interface AutoApplyProfilePayload {
  fullName: string
  email: string
  location: string
  yearsOfExperience: number | null
  workAuthorization: string | null
  sponsorshipRequired: boolean
  preferredWorkArrangement: string | null
  targetSalaryMin: number | null
  targetSalaryMax: number | null
}

export interface AutoApplyQuestion {
  id: string
  prompt: string
  answer: string | null
  source: 'profile' | 'user'
}

export interface AutoApplyQueueItem {
  id: string
  runId: string
  jobId: string
  identityKey: string
  applicationId: string | null
  resumeVersionId: string | null
  resumeVersionName: string
  title: string
  company: string
  applicationUrl: string | null
  initialMatchScore: number | null
  finalMatchScore: number | null
  c2cStatus: 'confirmed' | 'not_allowed' | 'unknown'
  applicationStatus: AutoApplyQueueStatus
  failureReason: string | null
  questions: AutoApplyQuestion[]
  tailoredResumeText?: string | null
  createdAt?: string
  updatedAt?: string
}

export interface AutoApplyCounts {
  found: number
  eligible: number
  tailored: number
  ready: number
  needsInput: number
  submitted: number
  skipped: number
  failed: number
}

export interface AutoApplyRun {
  id: string
  userId: string
  status: 'running' | 'paused' | 'completed' | 'cancelled'
  config: AutoApplyConfigPayload
  counts: AutoApplyCounts
  createdAt: string
  updatedAt: string
}

export interface AutoApplyRunResult {
  run: AutoApplyRun
  items: AutoApplyQueueItem[]
}

export const PREPARE_ERROR_MESSAGES: Record<string, string> = {
  JOB_NOT_FOUND: 'This job is no longer available.',
  APPLICATION_NOT_FOUND: 'This Auto Apply job is no longer in the queue.',
  APPLICATION_URL_MISSING: 'This listing does not include a valid application URL.',
  RESUME_VERSION_NOT_FOUND: 'The selected resume version could not be found.',
  RESUME_VERSION_NOT_READY: 'Resume is still being prepared. Please wait until the version is ready.',
  RESUME_FILE_MISSING: 'The selected resume is missing text for this application.',
  INVALID_APPLICATION_URL: 'This listing does not include a valid application URL.',
  UNSUPPORTED_PROVIDER: 'This job source cannot be prepared automatically.',
  DATABASE_ERROR: 'Could not prepare the application.',
  BROWSER_AUTOMATION_ERROR: 'Could not open the employer application.',
  APPLICATION_AUTOMATION_UNSUPPORTED: 'This employer site cannot be prepared automatically.',
  AUTHENTICATION_FAILURE: 'Sign in to prepare this application.',
}

export function normalizeAutoApplyResult(body: unknown): AutoApplyRunResult | null {
  if (!body || typeof body !== 'object') return null
  const record = body as Record<string, unknown>
  if (!record.run || typeof record.run !== 'object') return null
  if (Array.isArray(record.items)) {
    return { run: record.run as AutoApplyRun, items: record.items as AutoApplyQueueItem[] }
  }
  if (record.item && typeof record.item === 'object') {
    return { run: record.run as AutoApplyRun, items: [record.item as AutoApplyQueueItem] }
  }
  return null
}

export function prepareErrorMessage(body: unknown, fallback = 'Could not prepare the application.'): string {
  if (!body || typeof body !== 'object') return fallback
  const record = body as { code?: unknown; message?: unknown; error?: unknown }
  if (typeof record.code === 'string' && PREPARE_ERROR_MESSAGES[record.code]) {
    return PREPARE_ERROR_MESSAGES[record.code]
  }
  const raw = typeof record.message === 'string' ? record.message : typeof record.error === 'string' ? record.error : ''
  if (raw && !/key|secret|service.role/i.test(raw)) return raw
  return fallback
}

async function readAutoApplyResult(response: Response, fallback: string): Promise<AutoApplyRunResult> {
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null
  const normalized = normalizeAutoApplyResult(body)
  if (normalized && response.ok) return normalized
  const message = prepareErrorMessage(body, fallback)
  throw new Error(/key|secret|service.role/i.test(message) ? fallback : message)
}

export async function startAutoApplyRequest(payload: {
  userId: string
  resumeId?: string | null
  resumeVersionId?: string | null
  resumeText: string
  masterResumeText?: string
  profile: AutoApplyProfilePayload
  config: AutoApplyConfigPayload
  existingApplications?: Array<{
    jobId?: string | null
    identityKey?: string | null
    applicationUrl?: string | null
    status?: string | null
  }>
  existingQueueIdentities?: string[]
}): Promise<AutoApplyRunResult> {
  const response = await fetch(apiUrl('/api/jobs/auto-apply/start'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return readAutoApplyResult(response, 'Could not start Auto Apply.')
}

export async function listAutoApplyRunsRequest(userId: string): Promise<AutoApplyRunResult[]> {
  const response = await fetch(apiUrl(`/api/jobs/auto-apply?userId=${encodeURIComponent(userId)}`))
  const body = (await response.json().catch(() => null)) as { runs?: AutoApplyRunResult[]; error?: string } | null
  if (!response.ok || !body) {
    throw new Error(body?.error && !/key|secret|service.role/i.test(body.error) ? body.error : 'Could not load Auto Apply.')
  }
  return Array.isArray(body.runs) ? body.runs : []
}

export async function getAutoApplyRunRequest(runId: string): Promise<AutoApplyRunResult> {
  const response = await fetch(apiUrl(`/api/jobs/auto-apply/${encodeURIComponent(runId)}`))
  return readAutoApplyResult(response, 'Could not load Auto Apply.')
}

export async function prepareAutoApplyItemRequest(
  runId: string,
  itemId: string,
  profile: AutoApplyProfilePayload,
  userId?: string | null,
): Promise<AutoApplyRunResult> {
  const response = await fetch(
    apiUrl(`/api/jobs/auto-apply/${encodeURIComponent(runId)}/items/${encodeURIComponent(itemId)}/apply`),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile, userId: userId ?? null }),
    },
  )
  return readAutoApplyResult(response, 'Could not prepare the application.')
}

export async function submitAutoApplyItemRequest(runId: string, itemId: string): Promise<AutoApplyRunResult> {
  const response = await fetch(
    apiUrl(`/api/jobs/auto-apply/${encodeURIComponent(runId)}/items/${encodeURIComponent(itemId)}/submit`),
    { method: 'POST', headers: { 'Content-Type': 'application/json' } },
  )
  return readAutoApplyResult(response, 'Could not submit the application.')
}

export async function skipAutoApplyItemRequest(runId: string, itemId: string): Promise<AutoApplyRunResult> {
  const response = await fetch(
    apiUrl(`/api/jobs/auto-apply/${encodeURIComponent(runId)}/items/${encodeURIComponent(itemId)}/skip`),
    { method: 'POST', headers: { 'Content-Type': 'application/json' } },
  )
  return readAutoApplyResult(response, 'Could not skip the application.')
}

export async function cancelAutoApplyItemRequest(runId: string, itemId: string): Promise<AutoApplyRunResult> {
  const response = await fetch(
    apiUrl(`/api/jobs/auto-apply/${encodeURIComponent(runId)}/items/${encodeURIComponent(itemId)}/cancel`),
    { method: 'POST', headers: { 'Content-Type': 'application/json' } },
  )
  return readAutoApplyResult(response, 'Could not cancel the application.')
}

export async function answerAutoApplyItemRequest(
  runId: string,
  itemId: string,
  answers: Array<{ id: string; answer: string }>,
): Promise<AutoApplyRunResult> {
  const response = await fetch(
    apiUrl(`/api/jobs/auto-apply/${encodeURIComponent(runId)}/items/${encodeURIComponent(itemId)}/answer`),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers }),
    },
  )
  return readAutoApplyResult(response, 'Could not save the answer.')
}

export async function cancelAutoApplyRunRequest(runId: string): Promise<AutoApplyRunResult> {
  const response = await fetch(apiUrl(`/api/jobs/auto-apply/${encodeURIComponent(runId)}/cancel`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
  return readAutoApplyResult(response, 'Could not cancel Auto Apply.')
}
