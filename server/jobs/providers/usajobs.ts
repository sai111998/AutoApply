import type { ServerConfig } from '../../config'
import { fetchWithPolicy, type FetchLike } from '../http'
import {
  asIsoDate,
  asNumber,
  cleanText,
  emptyNormalizedJob,
  inferRemote,
  inferWorkArrangement,
} from '../normalize'
import {
  defaultConnectionLabel,
  type JobProvider,
  type ProviderSearchParams,
  type ProviderSearchResult,
  type ProviderWarning,
} from '../types'

export interface UsaJobsClientOptions {
  apiKey: string
  userAgentEmail: string
  enabled: boolean
  fetchImpl?: FetchLike
}

const SCHEDULE: Record<string, string> = {
  '1': 'full-time',
  '2': 'part-time',
  '3': 'shift',
  '4': 'intermittent',
  '5': 'job-sharing',
  '6': 'multiple',
}

function warning(
  code: ProviderWarning['code'],
  message: string,
  params: ProviderSearchParams,
): ProviderSearchResult {
  return {
    provider: 'usajobs',
    jobs: [],
    total: 0,
    page: params.page,
    pageSize: params.pageSize,
    hasMore: false,
    warning: { provider: 'usajobs', code, message },
  }
}

function named(value: unknown): string | null {
  if (Array.isArray(value) && value[0] && typeof value[0] === 'object') {
    return cleanText((value[0] as { Name?: unknown }).Name)
  }
  return cleanText(value)
}

function datePosted(days: number): string {
  return String(Math.max(0, Math.min(60, Math.round(days))))
}

export function createUsaJobsProvider(options: UsaJobsClientOptions): JobProvider {
  return {
    providerName: () => 'usajobs',
    label: () => 'USAJOBS',
    isEnabled: () => options.enabled,
    isAvailable: () => options.enabled && Boolean(options.apiKey && options.userAgentEmail),
    connectionLabel: () =>
      defaultConnectionLabel(options.enabled, options.enabled && Boolean(options.apiKey && options.userAgentEmail)),
    supportsApplicationAutomation: () => false,
    normalizeJob: (raw) => normalizeUsaJobsJob(raw),
    async searchJobs(params) {
      return this.search(params)
    },
    async search(params) {
      if (!options.enabled) return warning('disabled', 'USAJOBS is turned off.', params)
      if (!options.apiKey || !options.userAgentEmail) {
        return warning('missing_key', 'USAJOBS is unavailable until USAJOBS_API_KEY and USAJOBS_USER_AGENT_EMAIL are set.', params)
      }

      const query = new URLSearchParams({
        Keyword: params.keywords,
        DatePosted: datePosted(params.datePostedDays),
        Page: String(params.page),
        ResultsPerPage: String(Math.min(500, params.pageSize)),
        Fields: 'Full',
        WhoMayApply: 'public',
      })
      if (params.location && !/^(united states|usa|us|u\.s\.?)$/i.test(params.location.trim())) {
        query.set('LocationName', params.location)
      }
      if (params.remote === 'remote') query.set('RemoteIndicator', 'True')
      if (params.remote === 'onsite') query.set('RemoteIndicator', 'False')
      if (params.employmentType === 'full-time') query.set('PositionScheduleTypeCode', '1')
      if (params.employmentType === 'part-time') query.set('PositionScheduleTypeCode', '2')

      try {
        const response = await fetchWithPolicy(
          `https://data.usajobs.gov/api/search?${query.toString()}`,
          {
            method: 'GET',
            headers: {
              Host: 'data.usajobs.gov',
              'User-Agent': options.userAgentEmail,
              'Authorization-Key': options.apiKey,
            },
          },
          {
            timeoutMs: 12_000,
            retries: 1,
            minIntervalMs: 350,
            cacheTtlMs: 5 * 60_000,
            cacheKey: `usajobs:${query.toString()}`,
          },
          options.fetchImpl,
        )
        if (response.status === 401 || response.status === 403) {
          return warning('unauthorized', 'USAJOBS rejected the API credentials.', params)
        }
        if (response.status === 429) return warning('rate_limited', 'USAJOBS rate-limited the search. Try again shortly.', params)
        if (!response.ok) return warning('unavailable', 'USAJOBS did not return live jobs.', params)

        const raw = (await response.json()) as Record<string, unknown>
        const searchResult = raw?.SearchResult
        if (!searchResult || typeof searchResult !== 'object') {
          return warning('malformed', 'USAJOBS returned an unexpected payload.', params)
        }
        const block = searchResult as Record<string, unknown>
        const items = Array.isArray(block.SearchResultItems) ? block.SearchResultItems : null
        if (!items) return warning('malformed', 'USAJOBS returned an unexpected payload.', params)
        const jobs = items.map((item) => normalizeUsaJobsJob(item)).filter((job): job is NonNullable<typeof job> => Boolean(job))
        const total = typeof block.SearchResultCountAll === 'number' ? block.SearchResultCountAll : jobs.length
        return {
          provider: 'usajobs',
          jobs,
          total,
          page: params.page,
          pageSize: params.pageSize,
          hasMore: params.page * params.pageSize < total,
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'TimeoutError') {
          return warning('timeout', 'USAJOBS timed out.', params)
        }
        return warning('unavailable', 'USAJOBS could not be reached.', params)
      }
    },
  }
}

export function normalizeUsaJobsJob(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const descriptor =
    record.MatchedObjectDescriptor && typeof record.MatchedObjectDescriptor === 'object'
      ? (record.MatchedObjectDescriptor as Record<string, unknown>)
      : record
  const title = cleanText(descriptor.PositionTitle)
  if (!title) return null
  const details =
    descriptor.UserArea && typeof descriptor.UserArea === 'object'
      ? ((descriptor.UserArea as { Details?: Record<string, unknown> }).Details ?? {})
      : {}
  const formatted = Array.isArray(descriptor.PositionFormattedDescription)
    ? descriptor.PositionFormattedDescription
    : []
  const teaser = formatted
    .map((item) => (item && typeof item === 'object' ? cleanText((item as { Content?: unknown }).Content) : null))
    .filter(Boolean)
    .join('\n')
  const description = [
    cleanText(details.JobSummary),
    cleanText(descriptor.QualificationSummary),
    cleanText(details.MajorDuties),
    teaser,
  ]
    .filter(Boolean)
    .join('\n\n')
  const location = cleanText(descriptor.PositionLocationDisplay)
  const pay = Array.isArray(descriptor.PositionRemuneration) ? descriptor.PositionRemuneration[0] : null
  const payRecord = pay && typeof pay === 'object' ? (pay as Record<string, unknown>) : {}
  const scheduleCode =
    Array.isArray(descriptor.PositionSchedule) && descriptor.PositionSchedule[0] && typeof descriptor.PositionSchedule[0] === 'object'
      ? String((descriptor.PositionSchedule[0] as { Code?: unknown }).Code ?? '')
      : ''
  const remote = inferRemote(location, named(descriptor.PositionSchedule), [
    cleanText(details.JobSummary) ?? '',
    String(descriptor.RemoteIndicator ?? ''),
  ])
  const providerJobId = cleanText(record.MatchedObjectId) ?? cleanText(descriptor.PositionID)
  return emptyNormalizedJob({
    provider: 'usajobs',
    providerJobId,
    title,
    company: cleanText(descriptor.OrganizationName) ?? cleanText(descriptor.DepartmentName) ?? '',
    location,
    remote,
    workArrangement: inferWorkArrangement(remote, location),
    employmentType: named(descriptor.PositionSchedule) ?? SCHEDULE[scheduleCode] ?? named(descriptor.PositionOfferingType),
    description: description || null,
    jobUrl: cleanText(descriptor.PositionURI),
    postedAt: asIsoDate(descriptor.PublicationStartDate) ?? asIsoDate(descriptor.PositionStartDate),
    salaryMin: asNumber(payRecord.MinimumRange),
    salaryMax: asNumber(payRecord.MaximumRange),
    salaryCurrency: asNumber(payRecord.MinimumRange) != null || asNumber(payRecord.MaximumRange) != null ? 'USD' : null,
    source: 'USAJOBS',
    rawMetadata: { provider: 'usajobs', department: cleanText(descriptor.DepartmentName) },
  })
}

export function usajobsFromConfig(config: ServerConfig, fetchImpl?: FetchLike) {
  return createUsaJobsProvider({
    apiKey: config.usajobsApiKey,
    userAgentEmail: config.usajobsUserAgentEmail,
    enabled: config.usajobsEnabled,
    fetchImpl,
  })
}
