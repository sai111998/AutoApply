import { HttpError } from '../types'
import type { DiscoverRequest, EmploymentFilter, JobProviderName, NormalizedJob, RemoteFilter } from './types'
import { emptyNormalizedJob } from './normalize'
import type { LiveJobsRequest } from './list'
import type { LiveJobMatch } from './score'

const REMOTE: RemoteFilter[] = ['any', 'remote', 'onsite', 'hybrid']
const EMPLOYMENT: EmploymentFilter[] = ['any', 'full-time', 'part-time', 'contract', 'temporary', 'internship']
const SORTS = ['match', 'recent', 'relevance'] as const

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return asString(value) ? [asString(value)] : []
  return value.map(asString).filter(Boolean)
}

function asBoundedInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.round(parsed)))
}

function asRemote(value: unknown): RemoteFilter {
  const text = asString(value).toLowerCase().replace(/-/g, '_')
  if (text === 'on_site' || text === 'onsite') return 'onsite'
  return (REMOTE as string[]).includes(text) ? (text as RemoteFilter) : 'any'
}

function asEmployment(value: unknown): EmploymentFilter {
  const text = asString(value).toLowerCase().replace(/_/g, '-')
  return (EMPLOYMENT as string[]).includes(text) ? (text as EmploymentFilter) : 'any'
}

function asSort(value: unknown): LiveJobsRequest['sort'] {
  const text = asString(value).toLowerCase()
  return (SORTS as readonly string[]).includes(text) ? (text as LiveJobsRequest['sort']) : 'match'
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key) && record[key] != null && record[key] !== ''
}

function queryString(value: unknown): string {
  if (Array.isArray(value)) return asString(value[0])
  return asString(value)
}

export function parseLiveJobsQuery(query: unknown): LiveJobsRequest {
  const record = query && typeof query === 'object' && !Array.isArray(query) ? (query as Record<string, unknown>) : {}
  const country = queryString(record.country).toUpperCase() || 'US'
  const state = queryString(record.state).toUpperCase()
  return {
    q: queryString(record.q) || queryString(record.keywords) || queryString(record.title),
    country,
    state: /^[A-Z]{2}$/.test(state) ? state : '',
    remote: asRemote(record.remote),
    employmentType: asEmployment(record.employment_type ?? record.employmentType),
    seniority: queryString(record.seniority),
    page: asBoundedInt(record.page, 1, 1, 50),
    limit: asBoundedInt(record.limit ?? record.pageSize, 25, 1, 50),
    location: queryString(record.location),
    resumeText: queryString(record.resumeText) || undefined,
    resumeVersionId: queryString(record.resumeVersionId) || undefined,
    sort: asSort(record.sort),
  }
}

export function parseLiveJobsRequest(query: unknown, body?: unknown): LiveJobsRequest {
  const fromQuery = parseLiveJobsQuery(query)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fromQuery
  const record = body as Record<string, unknown>
  const fromBody = parseLiveJobsQuery(body)
  return {
    q: hasOwn(record, 'q') || hasOwn(record, 'keywords') || hasOwn(record, 'title') ? fromBody.q : fromQuery.q,
    country: hasOwn(record, 'country') ? fromBody.country : fromQuery.country,
    state: hasOwn(record, 'state') ? fromBody.state : fromQuery.state,
    remote: hasOwn(record, 'remote') ? fromBody.remote : fromQuery.remote,
    employmentType:
      hasOwn(record, 'employment_type') || hasOwn(record, 'employmentType')
        ? fromBody.employmentType
        : fromQuery.employmentType,
    seniority: hasOwn(record, 'seniority') ? fromBody.seniority : fromQuery.seniority,
    page: hasOwn(record, 'page') ? fromBody.page : fromQuery.page,
    limit: hasOwn(record, 'limit') || hasOwn(record, 'pageSize') ? fromBody.limit : fromQuery.limit,
    location: hasOwn(record, 'location') ? fromBody.location : fromQuery.location,
    resumeText: fromBody.resumeText || fromQuery.resumeText,
    resumeVersionId: fromBody.resumeVersionId || fromQuery.resumeVersionId,
    sort: hasOwn(record, 'sort') ? fromBody.sort : fromQuery.sort,
  }
}

export function parseLiveJobPreviewRequest(body: unknown): {
  resumeText: string
  resumeVersionId: string | null
  job: NormalizedJob
} {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'Request body must be a JSON object')
  }
  const record = body as Record<string, unknown>
  const resumeText = asString(record.resumeText)
  if (!resumeText) throw new HttpError(400, 'resumeText is required')
  return {
    resumeText,
    resumeVersionId: asString(record.resumeVersionId) || null,
    job: parseNormalizedJob(record.job),
  }
}

export function parseDiscoverRequest(body: unknown): DiscoverRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'Request body must be a JSON object')
  }
  const record = body as Record<string, unknown>
  const minMatch =
    record.minMatchScore == null || record.minMatchScore === ''
      ? null
      : asBoundedInt(record.minMatchScore, 0, 0, 100)
  return {
    roles: asStringList(record.roles),
    location: asString(record.location),
    remote: asRemote(record.remote),
    employmentType: asEmployment(record.employmentType),
    experienceLevel: asString(record.experienceLevel) || 'any',
    keywords: asStringList(record.keywords),
    datePostedDays: asBoundedInt(record.datePostedDays, 30, 1, 60),
    page: asBoundedInt(record.page, 1, 1, 50),
    pageSize: asBoundedInt(record.pageSize, 25, 1, 50),
    minMatchScore: minMatch,
    providers: asStringList(record.providers) as JobProviderName[],
    resumeText: asString(record.resumeText) || undefined,
    userId: asString(record.userId) || undefined,
    persist: record.persist === false ? false : true,
  }
}

export function parseNormalizedJob(body: unknown): NormalizedJob {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'job must be an object')
  }
  const record = body as Record<string, unknown>
  const title = asString(record.title)
  if (!title) throw new HttpError(400, 'job.title is required')
  return emptyNormalizedJob({
    id: asString(record.id) || undefined,
    provider: asString(record.provider) || 'unknown',
    providerJobId: asString(record.providerJobId) || asString(record.sourceJobId) || null,
    title,
    company: asString(record.company),
    location: asString(record.location) || null,
    remote: typeof record.remote === 'boolean' ? record.remote : null,
    workArrangement: asString(record.workArrangement) || null,
    employmentType: asString(record.employmentType) || null,
    seniority: asString(record.seniority) || null,
    description: asString(record.description) || null,
    jobUrl: asString(record.jobUrl) || asString(record.url) || null,
    postedAt: asString(record.postedAt) || null,
    salaryMin: typeof record.salaryMin === 'number' ? record.salaryMin : null,
    salaryMax: typeof record.salaryMax === 'number' ? record.salaryMax : null,
    salaryCurrency: asString(record.salaryCurrency) || null,
    source: asString(record.source) || asString(record.provider) || 'unknown',
    discoveredAt: asString(record.discoveredAt) || asString(record.fetchedAt) || undefined,
    lastVerifiedAt: asString(record.lastVerifiedAt) || undefined,
    identityKey: asString(record.identityKey) || undefined,
    rawMetadata: savedJobMetadata(record),
  })
}

function savedJobMetadata(record: Record<string, unknown>): Record<string, unknown> {
  const raw =
    record.rawMetadata && typeof record.rawMetadata === 'object' && !Array.isArray(record.rawMetadata)
      ? { ...(record.rawMetadata as Record<string, unknown>) }
      : {}
  const match = record.match && typeof record.match === 'object' && !Array.isArray(record.match)
    ? (record.match as Partial<LiveJobMatch>)
    : null
  const matchScore =
    typeof record.matchScore === 'number'
      ? record.matchScore
      : typeof match?.score === 'number'
        ? match.score
        : typeof raw.matchScore === 'number'
          ? raw.matchScore
          : null
  const resumeVersionId =
    asString(record.resumeVersionId) ||
    asString(match?.resumeVersionId) ||
    asString(raw.resumeVersionId) ||
    null
  if (matchScore != null) raw.matchScore = matchScore
  if (resumeVersionId) raw.resumeVersionId = resumeVersionId
  if (typeof record.createdAt === 'string' && record.createdAt.trim()) raw.createdAt = record.createdAt.trim()
  return raw
}
