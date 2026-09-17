import type { ServerConfig } from '../config'
import { deduplicateJobs } from './deduplicate'
import type { FetchLike } from './http'
import { createJobProviders } from './provider'
import { emptyLiveMatch, scoreJobAgainstResume, type LiveJobMatch } from './score'
import type {
  EmploymentFilter,
  NormalizedJob,
  ProviderSearchParams,
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
}

export interface LiveJobsResponse {
  jobs: LiveJob[]
  page: number
  limit: number
  total: number
  hasMore: boolean
  source: string
  warning?: ProviderWarning
}

export function toLiveJob(job: NormalizedJob, match: LiveJobMatch = emptyLiveMatch()): LiveJob {
  return {
    id: job.id,
    title: job.title,
    company: job.company,
    location: job.location,
    remote: job.remote,
    employmentType: job.employmentType,
    seniority: job.seniority,
    description: job.description,
    url: job.jobUrl,
    source: job.source,
    sourceJobId: job.providerJobId,
    postedAt: job.postedAt,
    fetchedAt: job.discoveredAt,
    provider: job.provider,
    providerJobId: job.providerJobId,
    jobUrl: job.jobUrl,
    workArrangement: job.workArrangement,
    discoveredAt: job.discoveredAt,
    lastVerifiedAt: job.lastVerifiedAt,
    identityKey: job.identityKey,
    salaryMin: job.salaryMin,
    salaryMax: job.salaryMax,
    salaryCurrency: job.salaryCurrency,
    rawMetadata: job.rawMetadata,
    match,
    matchScore: match.score,
    matchedSkills: match.matchedSkills,
    missingSkills: match.missingSkills,
  }
}

function composedLocation(request: LiveJobsRequest): string {
  const location = request.location?.trim() ?? ''
  const state = request.state?.trim() ?? ''
  if (location && state && !/,/.test(location)) return `${location}, ${state}`
  return location || state
}

function providerParams(request: LiveJobsRequest): ProviderSearchParams {
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

export async function listLiveJobs(
  config: ServerConfig,
  request: LiveJobsRequest,
  fetchImpl?: FetchLike,
): Promise<LiveJobsResponse> {
  const provider = createJobProviders(config, fetchImpl).find((item) => item.providerName() === 'job-opportunities')
  if (!provider) {
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

  const result = await provider.search(providerParams(request))
  const resumeText = request.resumeText?.trim() ?? ''
  const jobs = sortLiveJobs(
    deduplicateJobs(result.jobs).map((job) => {
      const match = resumeText
        ? scoreJobAgainstResume(job, resumeText, request.resumeVersionId)
        : emptyLiveMatch(request.resumeVersionId ?? null)
      return toLiveJob(job, match)
    }),
    request,
  )
  return {
    jobs,
    page: request.page,
    limit: request.limit,
    total: result.total ?? jobs.length,
    hasMore: result.hasMore,
    source: 'Job Opportunities API',
    warning: result.warning,
  }
}
