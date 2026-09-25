import type { ServerConfig } from '../../config'
import { fetchWithPolicy, type FetchLike } from '../http'
import { asIsoDate, asNumber, canonicalUrl, cleanMultilineText, cleanText, emptyNormalizedJob, inferWorkArrangement } from '../normalize'
import type {
  EmploymentFilter,
  JobProvider,
  NormalizedJob,
  ProviderConnectionLabel,
  ProviderSearchParams,
  ProviderSearchResult,
  ProviderWarning,
} from '../types'

export const JSEARCH_API_BASE_URL = 'https://jsearch.p.rapidapi.com'
export const JSEARCH_MAX_PAGES = 3
export const JSEARCH_RESULTS_PER_PAGE = 10
const JSEARCH_CACHE_TTL_MS = 15 * 60_000
const JSEARCH_MIN_INTERVAL_MS = 1_100

const EMPLOYMENT_QUERY: Partial<Record<Exclude<EmploymentFilter, 'any'>, string>> = {
  'full-time': 'FULLTIME',
  'part-time': 'PARTTIME',
  contract: 'CONTRACTOR',
  internship: 'INTERN',
}

const EMPLOYMENT_LABEL: Record<string, string> = {
  FULLTIME: 'Full-time',
  PARTTIME: 'Part-time',
  CONTRACTOR: 'Contract',
  INTERN: 'Internship',
  TEMPORARY: 'Temporary',
  PERDIEM: 'Per diem',
}

const LOCATION_WITHOUT_PLACE = /^(remote|anywhere|nationwide|united states|usa|us|u\.s\.?)$/i

export interface JsearchApplyOption {
  publisher: string | null
  applyLink: string
  isDirect: boolean
}

export interface JsearchProviderOptions {
  apiKey: string
  enabled: boolean
  baseUrl?: string
  maxPages?: number
  minIntervalMs?: number
  fetchImpl?: FetchLike
}

function httpUrl(value: unknown): string | null {
  const text = cleanText(value)
  if (!text) return null
  try {
    const parsed = new URL(text)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return canonicalUrl(parsed.toString())
  } catch {
    return null
  }
}

export function jsearchDatePosted(days: number): string {
  if (!Number.isFinite(days) || days <= 0) return 'all'
  if (days <= 1) return 'today'
  if (days <= 3) return '3days'
  if (days <= 7) return 'week'
  if (days <= 31) return 'month'
  return 'all'
}

export function jsearchPageCount(maxPages: number | undefined): number {
  const pages = Math.floor(Number(maxPages ?? 1))
  if (!Number.isFinite(pages) || pages < 1) return 1
  return Math.min(pages, JSEARCH_MAX_PAGES)
}

export function buildJsearchSearchParams(params: ProviderSearchParams, maxPages = 1): URLSearchParams | null {
  const keywords = params.q?.trim() || params.keywords.trim()
  if (!keywords) return null
  const location = params.location.trim()
  const query = new URLSearchParams()
  query.set('query', location && !LOCATION_WITHOUT_PLACE.test(location) ? `${keywords} in ${location}` : keywords)
  query.set('page', String(Math.max(1, Math.floor(params.page) || 1)))
  query.set('num_pages', String(jsearchPageCount(maxPages)))
  query.set('country', (params.country?.trim() || 'US').toLowerCase())
  query.set('date_posted', jsearchDatePosted(params.datePostedDays))
  if (params.remote === 'remote' || /^remote$/i.test(location)) query.set('work_from_home', 'true')
  const employment = params.employmentType === 'any' ? undefined : EMPLOYMENT_QUERY[params.employmentType]
  if (employment) query.set('employment_types', employment)
  return query
}

export function jsearchApplyOptions(record: Record<string, unknown>): JsearchApplyOption[] {
  const options = Array.isArray(record.apply_options) ? record.apply_options : []
  return options.flatMap((option) => {
    if (!option || typeof option !== 'object') return []
    const entry = option as Record<string, unknown>
    const applyLink = httpUrl(entry.apply_link)
    return applyLink ? [{ publisher: cleanText(entry.publisher), applyLink, isDirect: entry.is_direct === true }] : []
  })
}

export function resolveJsearchApplicationUrl(record: Record<string, unknown>): string | null {
  const primary = httpUrl(record.job_apply_link)
  if (primary && record.job_apply_is_direct === true) return primary
  const options = jsearchApplyOptions(record)
  return options.find((option) => option.isDirect)?.applyLink ?? primary ?? options[0]?.applyLink ?? null
}

export function resolveJsearchSourceUrl(record: Record<string, unknown>): string | null {
  return httpUrl(record.job_apply_link) ?? jsearchApplyOptions(record).find((option) => !option.isDirect)?.applyLink ?? null
}

function postedAtFrom(record: Record<string, unknown>): string | null {
  const iso = asIsoDate(record.job_posted_at_datetime_utc)
  if (iso) return iso
  const seconds = asNumber(record.job_posted_at_timestamp)
  return seconds && seconds > 0 ? new Date(seconds * 1000).toISOString() : null
}

function employmentTypeFrom(record: Record<string, unknown>): string | null {
  const values = [
    record.job_employment_type,
    ...(Array.isArray(record.job_employment_types) ? record.job_employment_types : []),
  ]
  for (const value of values) {
    const text = cleanText(value)
    if (!text) continue
    return EMPLOYMENT_LABEL[text.toUpperCase().replace(/[^A-Z]/g, '')] ?? text
  }
  return null
}

export function normalizeJsearchJob(raw: unknown): NormalizedJob | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const providerJobId = cleanText(record.job_id)
  const title = cleanText(record.job_title)
  if (!providerJobId || !title) return null
  const city = cleanText(record.job_city)
  const state = cleanText(record.job_state)
  const country = cleanText(record.job_country)
  const location = cleanText(record.job_location) || [city, state, country].filter(Boolean).join(', ') || null
  const remote = record.job_is_remote === true ? true : record.job_is_remote === false ? false : null
  const applicationUrl = resolveJsearchApplicationUrl(record)
  const sourceUrl = resolveJsearchSourceUrl(record) ?? applicationUrl
  const job = emptyNormalizedJob({
    provider: 'jsearch',
    providerJobId,
    title,
    company: cleanText(record.employer_name) ?? '',
    location,
    remote,
    workArrangement: inferWorkArrangement(remote, location),
    employmentType: employmentTypeFrom(record),
    description: cleanMultilineText(record.job_description),
    jobUrl: sourceUrl,
    sourceUrl,
    applicationUrl,
    postedAt: postedAtFrom(record),
    salaryMin: asNumber(record.job_min_salary),
    salaryMax: asNumber(record.job_max_salary),
    salaryCurrency: cleanText(record.job_salary_currency),
    source: 'JSearch',
    discoveryProvider: 'jsearch',
    rawMetadata: {
      provider: 'jsearch',
      publisher: cleanText(record.job_publisher),
      applyIsDirect: record.job_apply_is_direct === true,
      applyOptions: jsearchApplyOptions(record),
      employerWebsite: httpUrl(record.employer_website),
      city,
      state,
      country,
      salaryPeriod: cleanText(record.job_salary_period),
    },
  })
  return { ...job, applicationUrl }
}

export function extractJsearchData(body: unknown): unknown[] | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const envelope = body as Record<string, unknown>
  if (typeof envelope.status === 'string' && envelope.status.toUpperCase() !== 'OK') return null
  return Array.isArray(envelope.data) ? envelope.data : null
}

function jsearchConnectionLabel(enabled: boolean, configured: boolean): ProviderConnectionLabel {
  if (!enabled) return 'Disabled'
  return configured ? 'Connected' : 'Not configured'
}

export function createJsearchProvider(options: JsearchProviderOptions): JobProvider {
  const baseUrl = (options.baseUrl || JSEARCH_API_BASE_URL).replace(/\/$/, '')
  const configured = options.enabled && Boolean(options.apiKey)
  const pages = jsearchPageCount(options.maxPages)
  const minIntervalMs = options.minIntervalMs ?? JSEARCH_MIN_INTERVAL_MS

  const result = (params: ProviderSearchParams, patch: Partial<ProviderSearchResult> = {}): ProviderSearchResult => ({
    provider: 'jsearch',
    jobs: [],
    total: 0,
    page: params.page,
    pageSize: params.pageSize,
    hasMore: false,
    ...patch,
  })
  const warning = (params: ProviderSearchParams, code: ProviderWarning['code'], message: string) =>
    result(params, { warning: { provider: 'jsearch', code, message } })

  async function request(path: string, query: URLSearchParams, cacheKey: string) {
    return fetchWithPolicy(
      `${baseUrl}${path}?${query.toString()}`,
      {
        method: 'GET',
        headers: {
          accept: 'application/json',
          'x-rapidapi-key': options.apiKey,
          'x-rapidapi-host': new URL(baseUrl).host,
        },
      },
      { timeoutMs: 15_000, retries: 1, minIntervalMs, cacheTtlMs: JSEARCH_CACHE_TTL_MS, cacheKey },
      options.fetchImpl,
    )
  }

  const provider: JobProvider & { getJobDetails(jobId: string): Promise<NormalizedJob | null> } = {
    providerName: () => 'jsearch',
    label: () => 'JSearch',
    isEnabled: () => configured,
    isAvailable: () => configured,
    connectionLabel: () => jsearchConnectionLabel(options.enabled, configured),
    supportsApplicationAutomation: () => false,
    normalizeJob: (raw) => normalizeJsearchJob(raw),
    async searchJobs(params) {
      return provider.search(params)
    },
    async search(params) {
      if (!options.enabled) return warning(params, 'disabled', 'JSearch is turned off.')
      if (!options.apiKey) return warning(params, 'missing_key', 'JSearch is not configured on the server.')
      const query = buildJsearchSearchParams(params, pages)
      if (!query) return warning(params, 'empty', 'JSearch needs search keywords.')
      try {
        const response = await request('/search', query, `jsearch:search:${query.toString()}`)
        if (response.status === 401 || response.status === 403) {
          return warning(params, 'unauthorized', 'JSearch rejected the server credentials.')
        }
        if (response.status === 429) return warning(params, 'rate_limited', 'JSearch rate limit reached.')
        if (!response.ok) return warning(params, 'unavailable', 'JSearch is temporarily unavailable.')
        const items = extractJsearchData(await response.json().catch(() => null))
        if (!items) return warning(params, 'malformed', 'JSearch returned an unexpected response.')
        const jobs = items
          .map((item) => normalizeJsearchJob(item))
          .filter((job): job is NormalizedJob => Boolean(job))
        return result(params, {
          jobs,
          total: null,
          rawCount: items.length,
          hasMore: items.length >= pages * JSEARCH_RESULTS_PER_PAGE,
        })
      } catch (error) {
        if (error instanceof Error && error.name === 'TimeoutError') {
          return warning(params, 'timeout', 'JSearch timed out.')
        }
        return warning(params, 'unavailable', 'JSearch is temporarily unavailable.')
      }
    },
    async getJob(jobId) {
      return provider.getJobDetails(jobId)
    },
    async getJobDetails(jobId) {
      const id = jobId.trim()
      if (!configured || !id) return null
      const query = new URLSearchParams({ job_id: id, extended_publisher_details: 'false' })
      try {
        const response = await request('/job-details', query, `jsearch:job:${id}`)
        if (!response.ok) return null
        const items = extractJsearchData(await response.json().catch(() => null))
        return items?.length ? normalizeJsearchJob(items[0]) : null
      } catch {
        return null
      }
    },
  }
  return provider
}

export function jsearchFromConfig(config: ServerConfig, fetchImpl?: FetchLike) {
  return createJsearchProvider({
    apiKey: config.rapidApiKey ?? '',
    enabled: config.jsearchEnabled ?? true,
    baseUrl: config.jsearchApiBaseUrl,
    maxPages: config.jsearchMaxPages,
    fetchImpl,
  })
}
