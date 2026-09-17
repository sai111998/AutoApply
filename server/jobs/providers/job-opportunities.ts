import type { ServerConfig } from '../../config'
import { fetchWithPolicy, type FetchLike } from '../http'
import { asIsoDate, asNumber, cleanText, emptyNormalizedJob, inferWorkArrangement } from '../normalize'
import {
  defaultConnectionLabel,
  type EmploymentFilter,
  type JobProvider,
  type ProviderSearchParams,
  type ProviderSearchResult,
  type ProviderWarning,
  type RemoteFilter,
} from '../types'

export const JOB_OPPORTUNITIES_API_BASE_URL = 'https://api.jobopportunitiesapi.org'
export const JOB_OPPORTUNITIES_MAX_LIMIT = 50

const EMPLOYMENT_QUERY: Record<Exclude<EmploymentFilter, 'any'>, string> = {
  'full-time': 'Full-time',
  'part-time': 'Part-time',
  contract: 'Contract',
  temporary: 'Temporary',
  internship: 'Internship',
}

const REMOTE_QUERY: Record<Exclude<RemoteFilter, 'any'>, string> = {
  remote: 'remote',
  hybrid: 'hybrid',
  onsite: 'on_site',
}

const SENIORITY_QUERY: Record<string, string> = {
  entry: 'Entry',
  junior: 'Entry',
  intern: 'Intern',
  internship: 'Intern',
  mid: 'Mid',
  senior: 'Senior',
  lead: 'Lead',
  manager: 'Manager',
  director: 'Director',
  executive: 'Executive',
}

const OFFICIAL_SENIORITY = new Set(['Entry', 'Mid', 'Senior', 'Lead', 'Manager', 'Director', 'Intern', 'Executive', 'not_stated'])

export interface LocationQuery {
  country: string
  city?: string
  state?: string
}

export function parseJobOpportunitiesLocation(location: string): LocationQuery {
  const text = location.trim()
  if (!text || /^(united states|usa|us|u\.s\.?|remote|nationwide|anywhere)$/i.test(text)) {
    return { country: 'US' }
  }
  const cityState = text.match(/^(.+?),\s*([A-Za-z]{2})$/)
  if (cityState) {
    return { country: 'US', city: cityState[1].trim(), state: cityState[2].toUpperCase() }
  }
  if (/^[A-Za-z]{2}$/.test(text)) {
    return { country: 'US', state: text.toUpperCase() }
  }
  return { country: 'US', city: text }
}

export function buildPublicJobsSearchParams(params: ProviderSearchParams): URLSearchParams {
  const query = new URLSearchParams()
  const location = parseJobOpportunitiesLocation(params.location)
  const country = params.country?.trim().toUpperCase() || location.country || 'US'
  query.set('country', country)
  const state = params.state?.trim().toUpperCase() || location.state
  if (state) query.set('state', state)
  if (!params.state?.trim() && location.city) query.set('city', location.city)
  const q = params.q?.trim()
  if (q) query.set('q', q)
  else if (params.keywords.trim()) query.set('title', params.keywords.trim())
  if (params.remote !== 'any') query.set('remote', REMOTE_QUERY[params.remote])
  if (params.employmentType !== 'any') query.set('employment_type', EMPLOYMENT_QUERY[params.employmentType])
  const seniorityRaw = params.experienceLevel?.trim() ?? ''
  const seniority = SENIORITY_QUERY[seniorityRaw.toLowerCase()] || (OFFICIAL_SENIORITY.has(seniorityRaw) ? seniorityRaw : '')
  if (seniority) query.set('seniority', seniority)
  if (params.datePostedDays > 0) {
    const postedAfter = new Date(Date.now() - params.datePostedDays * 86_400_000).toISOString().slice(0, 10)
    query.set('posted_after', postedAfter)
  }
  query.set('limit', String(Math.min(JOB_OPPORTUNITIES_MAX_LIMIT, Math.max(1, params.pageSize))))
  query.set('include_description', 'true')
  return query
}

function warning(code: ProviderWarning['code'], params: ProviderSearchParams, message?: string): ProviderSearchResult {
  return {
    provider: 'job-opportunities',
    jobs: [],
    total: 0,
    page: params.page,
    pageSize: params.pageSize,
    hasMore: false,
    warning: {
      provider: 'job-opportunities',
      code,
      message: message || 'Live job source temporarily unavailable.',
    },
  }
}

function workArrangementFrom(remote: unknown): string | null {
  if (remote === 'remote') return 'remote'
  if (remote === 'hybrid') return 'hybrid'
  if (remote === 'on_site') return 'onsite'
  return null
}

function descriptionFrom(raw: unknown, record: Record<string, unknown>): string | null {
  if (typeof raw === 'string' && raw.trim()) return cleanText(raw)
  return cleanText(record.description)
}

export function normalizeJobOpportunitiesJob(raw: unknown, descriptionOverride?: string | null) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const title = cleanText(record.title)
  if (!title) return null
  const remoteValue = cleanText(record.remote)
  const arrangement = workArrangementFrom(remoteValue)
  const location =
    cleanText(record.location) ||
    [cleanText(record.city), cleanText(record.region) || cleanText(record.country)].filter(Boolean).join(', ') ||
    null
  const listingSource = cleanText(record.source)
  return emptyNormalizedJob({
    provider: 'job-opportunities',
    providerJobId: cleanText(record.id) ?? cleanText(record.slug),
    title,
    company: cleanText(record.company) ?? '',
    location,
    remote: arrangement === 'remote' ? true : arrangement === 'onsite' ? false : arrangement === 'hybrid' ? null : null,
    workArrangement: inferWorkArrangement(
      arrangement === 'remote' ? true : arrangement === 'onsite' ? false : null,
      location,
      [arrangement ?? '', remoteValue ?? ''],
    ),
    employmentType: cleanText(record.employment_type),
    seniority: cleanText(record.seniority),
    description: descriptionOverride !== undefined ? cleanText(descriptionOverride) : descriptionFrom(null, record),
    jobUrl: cleanText(record.apply_url),
    postedAt: asIsoDate(record.posted_at),
    salaryMin: asNumber(record.salary_min),
    salaryMax: asNumber(record.salary_max),
    salaryCurrency: cleanText(record.salary_currency),
    source: 'Job Opportunities API',
    lastVerifiedAt: asIsoDate(record.last_verified_at) ?? undefined,
    liveDemoProvider: false,
    rawMetadata: {
      provider: 'job-opportunities',
      slug: cleanText(record.slug),
      country: cleanText(record.country),
      city: cleanText(record.city),
      region: cleanText(record.region),
      status: cleanText(record.status),
      firstSeenAt: asIsoDate(record.first_seen_at),
      listingSource,
      fieldSources: record.field_sources && typeof record.field_sources === 'object' ? record.field_sources : null,
      hasDescription: record.has_description === true,
    },
  })
}

function extractList(raw: unknown): unknown[] | null {
  if (Array.isArray(raw)) return raw
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  if (Array.isArray(record.data)) return record.data
  if (Array.isArray(record.jobs)) return record.jobs
  return null
}

export function createJobOpportunitiesProvider(options: {
  enabled: boolean
  baseUrl?: string
  fetchImpl?: FetchLike
}): JobProvider {
  const baseUrl = (options.baseUrl || JOB_OPPORTUNITIES_API_BASE_URL).replace(/\/$/, '')
  const available = options.enabled

  return {
    providerName: () => 'job-opportunities',
    label: () => 'Job Opportunities API',
    isEnabled: () => options.enabled,
    isAvailable: () => available,
    connectionLabel: () => defaultConnectionLabel(options.enabled, available),
    async search(params) {
      if (!options.enabled) return warning('disabled', params, 'Job Opportunities API is turned off.')
      if (params.page > 1) {
        return {
          provider: 'job-opportunities',
          jobs: [],
          total: 0,
          page: params.page,
          pageSize: params.pageSize,
          hasMore: false,
        }
      }

      const query = buildPublicJobsSearchParams(params)
      try {
        const response = await fetchWithPolicy(
          `${baseUrl}/public/jobs?${query.toString()}`,
          { method: 'GET' },
          {
            timeoutMs: 12_000,
            retries: 1,
            minIntervalMs: 250,
            cacheTtlMs: 5 * 60_000,
            cacheKey: `joa:${query.toString()}`,
          },
          options.fetchImpl,
        )
        if (response.status === 429) return warning('rate_limited', params)
        if (!response.ok) return warning('unavailable', params)
        const raw = await response.json()
        const items = extractList(raw)
        if (!items) return warning('malformed', params)
        const jobs = items
          .map((item) => normalizeJobOpportunitiesJob(item))
          .filter((job): job is NonNullable<typeof job> => Boolean(job))
        return {
          provider: 'job-opportunities',
          jobs,
          total: jobs.length,
          page: params.page,
          pageSize: params.pageSize,
          hasMore: false,
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'TimeoutError') return warning('timeout', params)
        return warning('unavailable', params)
      }
    },
    async getJob(jobId) {
      if (!options.enabled || !jobId.trim()) return null
      try {
        const response = await fetchWithPolicy(
          `${baseUrl}/public/jobs/${encodeURIComponent(jobId)}`,
          { method: 'GET' },
          { timeoutMs: 12_000, retries: 1, minIntervalMs: 250, cacheTtlMs: 10 * 60_000, cacheKey: `joa-job:${jobId}` },
          options.fetchImpl,
        )
        if (!response.ok) return null
        const raw = await response.json()
        if (!raw || typeof raw !== 'object') return null
        const envelope = raw as Record<string, unknown>
        const record = envelope.data && typeof envelope.data === 'object' && !Array.isArray(envelope.data) ? envelope.data : raw
        const description = typeof envelope.description === 'string' ? envelope.description : undefined
        return normalizeJobOpportunitiesJob(record, description)
      } catch {
        return null
      }
    },
  }
}

export function jobOpportunitiesFromConfig(config: ServerConfig, fetchImpl?: FetchLike) {
  return createJobOpportunitiesProvider({
    enabled: config.jobOpportunitiesEnabled,
    baseUrl: config.jobOpportunitiesApiBaseUrl,
    fetchImpl,
  })
}
