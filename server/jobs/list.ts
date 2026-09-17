import type { ServerConfig } from '../config'
import { deduplicateJobs } from './deduplicate'
import type { FetchLike } from './http'
import { createJobProviders } from './provider'
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

export function toLiveJob(job: NormalizedJob): LiveJob {
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
  }
}

function providerParams(request: LiveJobsRequest): ProviderSearchParams {
  return {
    keywords: '',
    q: request.q,
    location: '',
    country: request.country || 'US',
    state: request.state,
    remote: request.remote,
    employmentType: request.employmentType,
    experienceLevel: request.seniority,
    datePostedDays: 0,
    page: request.page,
    pageSize: request.limit,
  }
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
  const jobs = deduplicateJobs(result.jobs).map(toLiveJob)
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
