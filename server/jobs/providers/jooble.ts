import type { ServerConfig } from '../../config'
import { fetchWithPolicy, type FetchLike } from '../http'
import {
  asIsoDate,
  cleanText,
  emptyNormalizedJob,
  inferRemote,
  inferWorkArrangement,
  parseSalary,
} from '../normalize'
import {
  defaultConnectionLabel,
  type JobProvider,
  type ProviderSearchParams,
  type ProviderSearchResult,
  type ProviderWarning,
} from '../types'

export interface JoobleClientOptions {
  apiKey: string
  enabled: boolean
  baseUrl?: string
  fetchImpl?: FetchLike
}

function warning(
  code: ProviderWarning['code'],
  message: string,
  params: ProviderSearchParams,
): ProviderSearchResult {
  return {
    provider: 'jooble',
    jobs: [],
    total: 0,
    page: params.page,
    pageSize: params.pageSize,
    hasMore: false,
    warning: { provider: 'jooble', code, message },
  }
}

function radiusFor(params: ProviderSearchParams): string | undefined {
  if (params.radiusKm == null) return undefined
  const allowed = [0, 4, 8, 16, 26, 40, 80]
  const closest = allowed.reduce((best, item) =>
    Math.abs(item - params.radiusKm!) < Math.abs(best - params.radiusKm!) ? item : best,
  )
  return String(closest)
}

export function createJoobleProvider(options: JoobleClientOptions): JobProvider {
  const baseUrl = (options.baseUrl || 'https://jooble.org/api').replace(/\/$/, '')

  return {
    providerName: () => 'jooble',
    label: () => 'Jooble',
    isEnabled: () => options.enabled,
    isAvailable: () => options.enabled && Boolean(options.apiKey),
    connectionLabel: () => defaultConnectionLabel(options.enabled, options.enabled && Boolean(options.apiKey)),
    async search(params) {
      if (!options.enabled) return warning('disabled', 'Jooble is turned off.', params)
      if (!options.apiKey) return warning('missing_key', 'Jooble is unavailable until JOOBLE_API_KEY is set.', params)

      const body: Record<string, unknown> = {
        keywords: params.keywords,
        location: params.location || 'United States',
        page: String(params.page),
        ResultOnPage: params.pageSize,
        companysearch: false,
      }
      const radius = radiusFor(params)
      if (radius) body.radius = radius

      try {
        const response = await fetchWithPolicy(
          `${baseUrl}/${options.apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          },
          {
            timeoutMs: 12_000,
            retries: 1,
            minIntervalMs: 350,
            cacheTtlMs: 5 * 60_000,
            cacheKey: `jooble:${params.keywords}|${params.location}|${params.page}|${params.pageSize}`,
          },
          options.fetchImpl,
        )
        if (response.status === 403) return warning('unauthorized', 'Jooble rejected the API key.', params)
        if (response.status === 429) return warning('rate_limited', 'Jooble rate-limited the search. Try again shortly.', params)
        if (!response.ok) return warning('unavailable', 'Jooble did not return live jobs.', params)

        const raw = (await response.json()) as Record<string, unknown>
        if (!raw || typeof raw !== 'object' || !Array.isArray(raw.jobs)) {
          return warning('malformed', 'Jooble returned an unexpected payload.', params)
        }
        const cutoff = Date.now() - params.datePostedDays * 86_400_000
        const jobs = raw.jobs
          .map((item) => normalizeJoobleJob(item))
          .filter((job): job is NonNullable<typeof job> => Boolean(job))
          .filter((job) => !job.postedAt || new Date(job.postedAt).getTime() >= cutoff)
        const total = typeof raw.totalCount === 'number' ? raw.totalCount : jobs.length
        return {
          provider: 'jooble',
          jobs,
          total,
          page: params.page,
          pageSize: params.pageSize,
          hasMore: params.page * params.pageSize < total,
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'TimeoutError') {
          return warning('timeout', 'Jooble timed out.', params)
        }
        return warning('unavailable', 'Jooble could not be reached.', params)
      }
    },
  }
}

export function normalizeJoobleJob(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const title = cleanText(record.title)
  if (!title) return null
  const location = cleanText(record.location)
  const salary = parseSalary(record.salary)
  const postedAt = asIsoDate(record.updated)
  const employmentType = cleanText(record.type)
  const remote = inferRemote(location, employmentType, [cleanText(record.snippet) ?? ''])
  return emptyNormalizedJob({
    provider: 'jooble',
    providerJobId: record.id == null ? null : String(record.id),
    title,
    company: cleanText(record.company) ?? '',
    location,
    remote,
    workArrangement: inferWorkArrangement(remote, location, [employmentType ?? '']),
    employmentType,
    description: cleanText(record.snippet),
    jobUrl: cleanText(record.link),
    postedAt,
    salaryMin: salary.min,
    salaryMax: salary.max,
    salaryCurrency: salary.currency,
    source: 'Jooble',
    rawMetadata: { provider: 'jooble', listingSource: cleanText(record.source) },
  })
}

export function joobleFromConfig(config: ServerConfig, fetchImpl?: FetchLike) {
  return createJoobleProvider({
    apiKey: config.joobleApiKey,
    enabled: config.joobleEnabled,
    baseUrl: config.joobleApiBaseUrl,
    fetchImpl,
  })
}
