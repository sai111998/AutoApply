import { classifyApplicationCapability } from '../apply/capability'
import { deduplicateJobs } from './deduplicate'
import type { FetchLike } from './http'
import { createJobProviders, providerStatuses, selectProviders } from './provider'
import type {
  JobProvider,
  JobProviderName,
  NormalizedJob,
  ProviderSearchParams,
  ProviderSearchResult,
  ProviderWarning,
} from './types'
import type { ServerConfig } from '../config'

export interface AggregatedJobs {
  jobs: NormalizedJob[]
  warnings: ProviderWarning[]
  providers: ReturnType<typeof providerStatuses>
  total: number
  hasMore: boolean
  source: string
}

const PROVIDERS_WITH_SEPARATE_APPLY_URL = new Set<JobProviderName>(['jsearch'])

export function canonicalApplicationUrl(job: Pick<NormalizedJob, 'provider' | 'applicationUrl' | 'jobUrl'>): string | null {
  if (PROVIDERS_WITH_SEPARATE_APPLY_URL.has(job.provider)) return job.applicationUrl ?? null
  return job.applicationUrl || job.jobUrl
}

export function annotateCanonicalJob(job: NormalizedJob): NormalizedJob {
  const applicationUrl = canonicalApplicationUrl(job)
  const capability = classifyApplicationCapability({
    url: applicationUrl,
    applicationUrl,
    discoveryProvider: job.discoveryProvider || job.provider,
  })
  return {
    ...job,
    applicationUrl,
    sourceUrl: job.sourceUrl || applicationUrl,
    discoveryProvider: job.discoveryProvider || job.provider,
    applicationProvider: job.applicationProvider || capability.provider,
    applicationCapability: job.applicationCapability || capability.capability,
  }
}

export async function isolateProviderSearch(
  providerName: JobProviderName,
  params: Pick<ProviderSearchParams, 'page' | 'pageSize'>,
  search: () => Promise<ProviderSearchResult>,
): Promise<ProviderSearchResult> {
  try {
    return await search()
  } catch {
    return {
      provider: providerName,
      jobs: [],
      total: 0,
      page: params.page,
      pageSize: params.pageSize,
      hasMore: false,
      warning: { provider: providerName, code: 'unavailable', message: 'Live job source temporarily unavailable.' },
    }
  }
}

export async function searchProviderJobs(
  provider: JobProvider,
  params: ProviderSearchParams,
): Promise<ProviderSearchResult> {
  const search = provider.searchJobs?.bind(provider) ?? provider.search.bind(provider)
  return isolateProviderSearch(provider.providerName(), params, () => search(params))
}

export async function aggregateProviderJobs(
  providers: JobProvider[],
  params: ProviderSearchParams,
): Promise<AggregatedJobs> {
  const results = await Promise.all(providers.map((provider) => searchProviderJobs(provider, params)))
  const warnings = results.flatMap((item) => (item.warning && item.warning.code !== 'empty' ? [item.warning] : []))
  const jobs = deduplicateJobs(results.flatMap((item) => item.jobs)).map(annotateCanonicalJob)
  const named = providers.map((item) => item.label())
  const source = named.includes('Job Opportunities API') ? 'Job Opportunities API' : named[0] || 'Live jobs'
  return {
    jobs,
    warnings,
    providers: providerStatuses(providers),
    total: jobs.length,
    hasMore: results.some((item) => item.hasMore),
    source,
  }
}

export async function aggregateLiveJobs(
  config: ServerConfig,
  params: ProviderSearchParams,
  fetchImpl?: FetchLike,
  requested: JobProviderName[] = [],
): Promise<AggregatedJobs> {
  const all = createJobProviders(config, fetchImpl)
  const selected = selectProviders(all, requested)
  const aggregated = await aggregateProviderJobs(selected, params)
  return {
    ...aggregated,
    providers: providerStatuses(all),
  }
}

export const JobAggregator = {
  aggregate: aggregateProviderJobs,
  aggregateLiveJobs,
  annotate: annotateCanonicalJob,
}
