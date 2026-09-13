import type { ServerConfig } from '../../config'
import { fetchWithPolicy, type FetchLike } from '../http'
import { asIsoDate, asNumber, cleanText, emptyNormalizedJob, inferWorkArrangement, parseSalary } from '../normalize'
import {
  defaultConnectionLabel,
  type JobProvider,
  type ProviderSearchParams,
  type ProviderSearchResult,
  type ProviderWarning,
} from '../types'

export const CRUCIVE_API_BASE_URL = 'https://api.crucive.com'

export interface CruciveClientOptions {
  apiKey: string
  enabled: boolean
  usingDemoKey: boolean
  baseUrl?: string
  fetchImpl?: FetchLike
}

const EMPLOYMENT: Record<string, string> = {
  'full-time': 'full_time',
  'part-time': 'part_time',
  contract: 'contract',
  temporary: 'temporary',
  internship: 'internship',
}

function warning(
  code: ProviderWarning['code'],
  message: string,
  params: ProviderSearchParams,
): ProviderSearchResult {
  return {
    provider: 'crucive',
    jobs: [],
    total: 0,
    page: params.page,
    pageSize: params.pageSize,
    hasMore: false,
    warning: { provider: 'crucive', code, message },
  }
}

function reveal(value: unknown): string | null {
  const text = cleanText(value)
  if (!text || text === '***') return null
  return text
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return reveal(value) ? [reveal(value)!] : []
  return value.map(reveal).filter((item): item is string => Boolean(item))
}

function nationwideUnitedStates(location: string): boolean {
  return /^(united states|usa|us|u\.s\.?)$/i.test(location.trim())
}

function locationFilters(location: string): Record<string, unknown>[] {
  const text = location.trim()
  if (!text) return []
  if (nationwideUnitedStates(text)) {
    return [{ terms: { job_country: ['United States', 'US', 'USA'] } }]
  }
  return [
    {
      bool: {
        should: [
          { term: { job_country: text } },
          { term: { job_city: text } },
          { match: { job_location_verbatim: text } },
        ],
      },
    },
  ]
}

function searchQuery(params: ProviderSearchParams, includeLocation: boolean): Record<string, unknown> {
  const must: Record<string, unknown>[] = [{ match: { job_title: params.keywords } }]
  const filter: Record<string, unknown>[] = []
  if (includeLocation) filter.push(...locationFilters(params.location))
  if (params.datePostedDays > 0) {
    const since = new Date(Date.now() - params.datePostedDays * 86_400_000).toISOString().slice(0, 10)
    filter.push({ range: { first_seen_date: { gte: since } } })
  }
  if (params.remote === 'remote') filter.push({ term: { accepts_remote: true } })
  if (params.remote === 'hybrid') filter.push({ term: { accepts_hybrid: true } })
  if (params.remote === 'onsite') {
    filter.push({ term: { accepts_remote: false } })
    filter.push({ term: { accepts_hybrid: false } })
  }
  const employment = EMPLOYMENT[params.employmentType]
  if (employment) filter.push({ contains: { employment_type: employment } })
  return filter.length ? { bool: { must, filter } } : must[0]
}

function extractJobs(raw: unknown): unknown[] | null {
  if (Array.isArray(raw)) return raw
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  if (Array.isArray(record.results)) return record.results
  if (Array.isArray(record.jobs)) return record.jobs
  if (Array.isArray(record.data)) return record.data
  return null
}

function descriptionFrom(record: Record<string, unknown>): string | null {
  const parts = [
    stringList(record.job_description_responsibilities).join('\n'),
    stringList(record.job_description_requirements).join('\n'),
    reveal(record.description),
  ].filter(Boolean)
  return parts.length ? parts.join('\n\n') : null
}

function locationFrom(record: Record<string, unknown>): string | null {
  const city = reveal(record.job_city)
  const country = reveal(record.job_country)
  const combined = [city, country].filter(Boolean).join(', ')
  return combined || reveal(record.job_location_verbatim) || reveal(record.job_address_full)
}

function employmentFrom(value: unknown): string | null {
  const first = stringList(value)[0]
  if (!first) return null
  return first.replace(/_/g, '-')
}

export function normalizeCruciveJob(raw: unknown, liveDemoProvider = false) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const title = reveal(record.job_title)
  if (!title) return null
  const remote = typeof record.accepts_remote === 'boolean' ? record.accepts_remote : null
  const hybrid = record.accepts_hybrid === true
  const salary = parseSalary(record.salary_text)
  const salaryMin = asNumber(record.salary_min) ?? salary.min
  const salaryMax = asNumber(record.salary_max) ?? salary.max
  const salaryCurrency = reveal(record.salary_currency) ?? (salaryMin != null || salaryMax != null ? salary.currency : null)
  return emptyNormalizedJob({
    provider: 'crucive',
    providerJobId: reveal(record.job_uuid),
    title,
    company: reveal(record.company_name) ?? '',
    location: locationFrom(record),
    remote: hybrid ? null : remote,
    workArrangement: inferWorkArrangement(remote, locationFrom(record), [
      hybrid ? 'hybrid' : '',
      remote === true ? 'remote' : '',
      remote === false && !hybrid ? 'onsite' : '',
    ]),
    employmentType: employmentFrom(record.employment_type),
    description: descriptionFrom(record),
    jobUrl: reveal(record.job_url),
    postedAt: asIsoDate(record.posting_date) ?? asIsoDate(record.first_seen_date),
    salaryMin,
    salaryMax,
    salaryCurrency,
    source: 'Crucive',
    liveDemoProvider,
    rawMetadata: {
      provider: 'crucive',
      liveDemoProvider,
      department: reveal(record.department),
      skills: stringList(record.skill_names),
    },
  })
}

export function createCruciveProvider(options: CruciveClientOptions): JobProvider {
  const baseUrl = (options.baseUrl || CRUCIVE_API_BASE_URL).replace(/\/$/, '')
  const available = options.enabled && Boolean(options.apiKey)

  const requestSearch = async (params: ProviderSearchParams, includeLocation: boolean) => {
    const usingDemo = options.usingDemoKey
    const response = await fetchWithPolicy(
      `${baseUrl}/v1/jobs/search`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': options.apiKey,
        },
        body: JSON.stringify({
          query: searchQuery(params, includeLocation),
          limit: usingDemo ? Math.min(10, params.pageSize) : Math.min(1000, params.pageSize),
          sort: [{ _relevance: 'desc' }],
        }),
      },
      {
        timeoutMs: 12_000,
        retries: 1,
        minIntervalMs: 1_100,
        cacheTtlMs: 5 * 60_000,
        cacheKey: `crucive:${params.keywords}|${includeLocation ? params.location : 'any'}|${params.page}|${params.pageSize}|${params.datePostedDays}|${params.remote}|${params.employmentType}`,
      },
      options.fetchImpl,
    )
    return response
  }

  return {
    providerName: () => 'crucive',
    label: () => 'Crucive',
    isEnabled: () => options.enabled,
    isAvailable: () => available,
    usesDemoKey: () => options.usingDemoKey,
    connectionLabel: () => defaultConnectionLabel(options.enabled, available, options.usingDemoKey),
    async search(params) {
      if (!options.enabled) return warning('disabled', 'Crucive is turned off.', params)
      if (!options.apiKey) {
        return warning('missing_key', 'Crucive is unavailable until CRUCIVE_API_KEY is set.', params)
      }

      try {
        let response = await requestSearch(params, true)
        if (response.status === 401 || response.status === 403) {
          return warning('unauthorized', 'Crucive rejected the API key.', params)
        }
        if (response.status === 429) return warning('rate_limited', 'Crucive rate-limited the search. Try again shortly.', params)
        if (!response.ok) return warning('unavailable', 'Crucive did not return live jobs.', params)

        let items = extractJobs(await response.json())
        if (!items) return warning('malformed', 'Crucive returned an unexpected payload.', params)

        let broadened = false
        if (!items.length && nationwideUnitedStates(params.location)) {
          response = await requestSearch(params, false)
          if (response.ok) {
            const retry = extractJobs(await response.json())
            if (retry) {
              items = retry
              broadened = Boolean(retry.length)
            }
          }
        }

        const jobs = items
          .map((item) => normalizeCruciveJob(item, options.usingDemoKey))
          .filter((job): job is NonNullable<typeof job> => Boolean(job))
        const totalHeader = Number(response.headers.get('x-total-results'))
        const total = Number.isFinite(totalHeader) && totalHeader >= 0 ? totalHeader : jobs.length
        const nextPage = response.headers.get('x-next-page-after')
        return {
          provider: 'crucive',
          jobs,
          total,
          page: params.page,
          pageSize: params.pageSize,
          hasMore: Boolean(nextPage) && !options.usingDemoKey,
          warning: broadened
            ? {
                provider: 'crucive',
                code: 'empty',
                message:
                  'Crucive had no United States listings for this search. Showing live demo roles from other markets.',
              }
            : undefined,
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'TimeoutError') {
          return warning('timeout', 'Crucive timed out.', params)
        }
        return warning('unavailable', 'Crucive could not be reached.', params)
      }
    },
    async getJob(jobId) {
      if (!options.enabled || !options.apiKey || !jobId.trim()) return null
      try {
        const response = await fetchWithPolicy(
          `${baseUrl}/v1/jobs/${encodeURIComponent(jobId)}`,
          {
            method: 'GET',
            headers: { 'X-API-Key': options.apiKey },
          },
          { timeoutMs: 12_000, retries: 1, minIntervalMs: 1_100 },
          options.fetchImpl,
        )
        if (!response.ok) return null
        const raw = await response.json()
        const record = Array.isArray(raw) ? raw[0] : raw
        return normalizeCruciveJob(record, options.usingDemoKey)
      } catch {
        return null
      }
    },
  }
}

export function cruciveFromConfig(config: ServerConfig, fetchImpl?: FetchLike) {
  return createCruciveProvider({
    apiKey: config.cruciveApiKey,
    enabled: config.cruciveEnabled,
    usingDemoKey: config.cruciveUsingDemoKey,
    baseUrl: config.cruciveApiBaseUrl,
    fetchImpl,
  })
}
