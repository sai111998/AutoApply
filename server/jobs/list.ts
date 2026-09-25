import type { ServerConfig } from '../config'
import { classifyC2c, matchesJobTypeFilter, type C2cClassification, type JobTypeFilter } from './c2c'
import { deduplicateJobs } from './deduplicate'
import type { FetchLike } from './http'
import { annotateCanonicalJob, canonicalApplicationUrl, isolateProviderSearch } from './aggregator'
import { expandSearchQueries } from './query-expand'
import { logDiscoveryCounts, type ProviderDiscoveryCounts } from './discovery-log'
import { createJobProviders } from './provider'
import { createSyntheticTestJob, shouldIncludeSyntheticListing } from './synthetic-listing'
import { emptyLiveMatch, scoreJobAgainstResume, type LiveJobMatch } from './score'
import type {
  EmploymentFilter,
  NormalizedJob,
  ProviderSearchParams,
  ProviderSearchResult,
  ProviderWarning,
  RemoteFilter,
} from './types'

export interface LiveJob {
  id: string
  title: string
  company: string
  location: string | null
  remote: boolean | null
  employmentType: string | null
  seniority: string | null
  description: string | null
  url: string | null
  source: string
  sourceJobId: string | null
  postedAt: string | null
  fetchedAt: string
  provider: string
  providerJobId: string | null
  jobUrl: string | null
  workArrangement: string | null
  discoveredAt: string
  lastVerifiedAt: string
  identityKey: string
  salaryMin: number | null
  salaryMax: number | null
  salaryCurrency: string | null
  rawMetadata: Record<string, unknown>
  match: LiveJobMatch
  matchScore: number | null
  matchedSkills: string[]
  missingSkills: string[]
  c2cStatus: C2cClassification['status']
  c2cEvidence: C2cClassification['evidence']
  applicationUrl?: string | null
  discoveryProvider?: string | null
  applicationProvider?: string | null
  applicationCapability?: string | null
}

export interface LiveJobsRequest {
  q: string
  country: string
  state: string
  remote: RemoteFilter
  employmentType: EmploymentFilter
  seniority: string
  page: number
  limit: number
  location?: string
  resumeText?: string
  resumeVersionId?: string
  sort?: 'match' | 'recent' | 'relevance'
  jobType?: JobTypeFilter
  includeSynthetic?: boolean
}

export interface LiveJobsResponse {
  jobs: LiveJob[]
  page: number
  limit: number
  total: number
  hasMore: boolean
  source: string
  warning?: ProviderWarning
  diagnostics?: import('./discovery-log').ProviderDiscoveryCounts[]
}

export function toLiveJob(job: NormalizedJob, match: LiveJobMatch = emptyLiveMatch()): LiveJob {
  const annotated = annotateCanonicalJob(job)
  const c2c = classifyC2c({
    title: annotated.title,
    description: annotated.description,
    employmentType: annotated.employmentType,
    company: annotated.company,
  })
  return {
    id: annotated.id,
    title: annotated.title,
    company: annotated.company,
    location: annotated.location,
    remote: annotated.remote,
    employmentType: annotated.employmentType,
    seniority: annotated.seniority,
    description: annotated.description,
    url: annotated.applicationUrl ?? annotated.jobUrl,
    source: annotated.source,
    sourceJobId: annotated.providerJobId,
    postedAt: annotated.postedAt,
    fetchedAt: annotated.discoveredAt,
    provider: annotated.provider,
    providerJobId: annotated.providerJobId,
    jobUrl: annotated.jobUrl,
    workArrangement: annotated.workArrangement,
    discoveredAt: annotated.discoveredAt,
    lastVerifiedAt: annotated.lastVerifiedAt,
    identityKey: annotated.identityKey,
    salaryMin: annotated.salaryMin,
    salaryMax: annotated.salaryMax,
    salaryCurrency: annotated.salaryCurrency,
    rawMetadata: annotated.rawMetadata,
    match,
    matchScore: match.score,
    matchedSkills: match.matchedSkills,
    missingSkills: match.missingSkills,
    c2cStatus: c2c.status,
    c2cEvidence: c2c.evidence,
    applicationUrl: canonicalApplicationUrl(annotated),
    discoveryProvider: annotated.discoveryProvider ?? annotated.provider,
    applicationProvider: annotated.applicationProvider ?? null,
    applicationCapability: annotated.applicationCapability ?? null,
  }
}

function composedLocation(request: LiveJobsRequest): string {
  const location = request.location?.trim() ?? ''
  const state = request.state?.trim() ?? ''
  if (location && state && !/,/.test(location)) return `${location}, ${state}`
  return location || state
}

function providerParams(request: LiveJobsRequest, overrides: Partial<ProviderSearchParams> = {}): ProviderSearchParams {
  return {
    keywords: '',
    q: request.q,
    location: composedLocation(request),
    country: request.country || 'US',
    state: '',
    remote: request.remote,
    employmentType: request.employmentType,
    experienceLevel: request.seniority,
    datePostedDays: 0,
    page: request.page,
    pageSize: request.limit,
    ...overrides,
  }
}

async function searchLiveJobs(
  provider: { search(params: ProviderSearchParams): Promise<ProviderSearchResult>; providerName?: () => string },
  request: LiveJobsRequest,
): Promise<ProviderSearchResult> {
  const name = provider.providerName?.() ?? ''
  if (request.jobType !== 'c2c' && name === 'job-opportunities') {
    const queries = expandSearchQueries(request.q)
    const collected: ProviderSearchResult[] = []
    for (const q of queries) {
      collected.push(await provider.search(providerParams(request, { q })))
    }
    return {
      provider: 'job-opportunities',
      jobs: deduplicateJobs(collected.flatMap((item) => item.jobs)),
      total: collected.reduce((sum, item) => sum + (item.total ?? item.jobs.length), 0),
      page: request.page,
      pageSize: request.limit,
      hasMore: collected.some((item) => item.hasMore),
      warning: collected.find((item) => item.warning)?.warning,
    }
  }
  if (request.jobType !== 'c2c') {
    return provider.search(providerParams(request))
  }
  const role = request.q.trim() || 'software engineer'
  const searches = [`${role} C2C`, `${role} corp to corp`]
  const results: ProviderSearchResult[] = []
  for (const q of searches) {
    results.push(await provider.search(providerParams(request, { q })))
  }
  return {
    provider: 'job-opportunities',
    jobs: deduplicateJobs(results.flatMap((item) => item.jobs)),
    total: results.reduce((sum, item) => sum + (item.total ?? item.jobs.length), 0),
    page: request.page,
    pageSize: request.limit,
    hasMore: results.some((item) => item.hasMore),
    warning: results.find((item) => item.warning)?.warning,
  }
}

function relevanceRank(job: LiveJob, query: string): number {
  if (!query.trim()) return job.match.score ?? 0
  const haystack = `${job.title} ${job.company} ${job.location ?? ''}`.toLowerCase()
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
  const hits = tokens.filter((token) => haystack.includes(token)).length
  return hits * 1000 + (job.match.score ?? 0)
}

export function sortLiveJobs(jobs: LiveJob[], request: LiveJobsRequest): LiveJob[] {
  const sort = request.sort || 'match'
  const copy = [...jobs]
  if (sort === 'recent') {
    copy.sort((left, right) => (right.postedAt ?? right.fetchedAt).localeCompare(left.postedAt ?? left.fetchedAt))
    return copy
  }
  if (sort === 'relevance') {
    copy.sort((left, right) => relevanceRank(right, request.q) - relevanceRank(left, request.q))
    return copy
  }
  copy.sort((left, right) => (right.match.score ?? -1) - (left.match.score ?? -1))
  return copy
}

const LIVE_DISCOVERY_PROVIDERS = new Set(['job-opportunities', 'greenhouse', 'lever', 'ashby', 'jsearch'])

export async function listLiveJobs(
  config: ServerConfig,
  request: LiveJobsRequest,
  fetchImpl?: FetchLike,
): Promise<LiveJobsResponse> {
  const providers = createJobProviders(config, fetchImpl).filter(
    (item) => LIVE_DISCOVERY_PROVIDERS.has(item.providerName()) && item.isEnabled(),
  )
  const includeSynthetic =
    request.includeSynthetic === true || (request.includeSynthetic !== false && shouldIncludeSyntheticListing())
  if (!providers.length && !includeSynthetic) {
    return {
      jobs: [],
      page: request.page,
      limit: request.limit,
      total: 0,
      hasMore: false,
      source: 'Job Opportunities API',
      warning: {
        provider: 'job-opportunities',
        code: 'unavailable',
        message: 'Live job source temporarily unavailable.',
      },
    }
  }

  const results = await Promise.all(
    providers.map((provider) =>
      isolateProviderSearch(provider.providerName(), { page: request.page, pageSize: request.limit }, () =>
        searchLiveJobs(provider, request),
      ),
    ),
  )
  const syntheticJobs = includeSynthetic ? [createSyntheticTestJob(config.port)] : []
  const merged = deduplicateJobs([...syntheticJobs, ...results.flatMap((item) => item.jobs)]).map(annotateCanonicalJob)
  const resumeText = request.resumeText?.trim() ?? ''
  const jobType = request.jobType || 'all'
  const scored = merged.map((job) => {
    const match = resumeText
      ? scoreJobAgainstResume(job, resumeText, request.resumeVersionId)
      : emptyLiveMatch(request.resumeVersionId ?? null)
    return toLiveJob(job, match)
  })
  const jobs = sortLiveJobs(
    scored.filter((job) =>
      matchesJobTypeFilter(
        job,
        { status: job.c2cStatus, evidence: job.c2cEvidence },
        jobType,
      ),
    ),
    request,
  )
  const diagnostics: ProviderDiscoveryCounts[] = []
  if (syntheticJobs.length) {
    const syntheticEntry: ProviderDiscoveryCounts = {
      provider: 'synthetic',
      query: request.q,
      country: request.country || 'US',
      state: request.state || '',
      filters: {
        remote: request.remote,
        employmentType: request.employmentType,
        jobType,
        keywords: [],
      },
      raw: syntheticJobs.length,
      normalized: syntheticJobs.length,
      deduplicated: merged.filter((job) => (job.discoveryProvider || job.provider) === 'synthetic').length,
      duplicatesRemoved: 0,
      usableApplicationUrls: syntheticJobs.filter((job) => canonicalApplicationUrl(job)).length,
      filtered: jobs.filter((job) => (job.discoveryProvider || job.provider) === 'synthetic').length,
    }
    logDiscoveryCounts(syntheticEntry)
    diagnostics.push(syntheticEntry)
  }
  for (const result of results) {
    const fromProvider = merged.filter((job) => (job.discoveryProvider || job.provider) === result.provider)
    const afterFilter = jobs.filter((job) => (job.discoveryProvider || job.provider) === result.provider)
    const entry: ProviderDiscoveryCounts = {
      provider: result.provider,
      query: request.q,
      country: request.country || 'US',
      state: request.state || '',
      filters: {
        remote: request.remote,
        employmentType: request.employmentType,
        jobType,
        keywords: [],
      },
      raw: result.rawCount ?? result.jobs.length,
      normalized: result.jobs.length,
      deduplicated: fromProvider.length,
      duplicatesRemoved: Math.max(0, result.jobs.length - fromProvider.length),
      usableApplicationUrls: result.jobs.filter((job) => canonicalApplicationUrl(job)).length,
      filtered: afterFilter.length,
      ...(result.warning && result.warning.code !== 'empty' ? { warning: result.warning.code } : {}),
    }
    logDiscoveryCounts(entry)
    diagnostics.push(entry)
  }
  const joa = results.find((item) => item.provider === 'job-opportunities')
  const nonEmptyWarning = (warning?: { code: string } | null) => warning && warning.code !== 'empty'
  return {
    jobs,
    page: request.page,
    limit: request.limit,
    total: Math.max(joa?.total ?? 0, jobs.length),
    hasMore: results.some((item) => item.hasMore),
    source: 'Job Opportunities API',
    warning:
      (nonEmptyWarning(joa?.warning) ? joa?.warning : undefined) ??
      results.find((item) => nonEmptyWarning(item.warning))?.warning,
    diagnostics,
  }
}
