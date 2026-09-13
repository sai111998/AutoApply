import { HttpError } from '../types'
import type { DiscoverRequest, EmploymentFilter, JobProviderName, NormalizedJob, RemoteFilter } from './types'
import { emptyNormalizedJob } from './normalize'

const REMOTE: RemoteFilter[] = ['any', 'remote', 'onsite', 'hybrid']
const EMPLOYMENT: EmploymentFilter[] = ['any', 'full-time', 'part-time', 'contract', 'temporary', 'internship']

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
  const text = asString(value).toLowerCase()
  return (REMOTE as string[]).includes(text) ? (text as RemoteFilter) : 'any'
}

function asEmployment(value: unknown): EmploymentFilter {
  const text = asString(value).toLowerCase()
  return (EMPLOYMENT as string[]).includes(text) ? (text as EmploymentFilter) : 'any'
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
    providerJobId: asString(record.providerJobId) || null,
    title,
    company: asString(record.company),
    location: asString(record.location) || null,
    remote: typeof record.remote === 'boolean' ? record.remote : null,
    workArrangement: asString(record.workArrangement) || null,
    employmentType: asString(record.employmentType) || null,
    description: asString(record.description) || null,
    jobUrl: asString(record.jobUrl) || null,
    postedAt: asString(record.postedAt) || null,
    salaryMin: typeof record.salaryMin === 'number' ? record.salaryMin : null,
    salaryMax: typeof record.salaryMax === 'number' ? record.salaryMax : null,
    salaryCurrency: asString(record.salaryCurrency) || null,
    source: asString(record.source) || asString(record.provider) || 'unknown',
    discoveredAt: asString(record.discoveredAt) || undefined,
    lastVerifiedAt: asString(record.lastVerifiedAt) || undefined,
    identityKey: asString(record.identityKey) || undefined,
    rawMetadata: record.rawMetadata && typeof record.rawMetadata === 'object' ? (record.rawMetadata as Record<string, unknown>) : {},
  })
}
