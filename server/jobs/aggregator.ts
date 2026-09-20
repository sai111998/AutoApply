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

export function annotateCanonicalJob(job: NormalizedJob): NormalizedJob {
  const applicationUrl = job.applicationUrl || job.jobUrl
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

export async function searchProviderJobs(
  provider: JobProvider,
  params: ProviderSearchParams,
): Promise<ProviderSearchResult> {
  const search = provider.searchJobs?.bind(provider) ?? provider.search.bind(provider)
  return search(params)
}

export async function aggregateProviderJobs(
  providers: JobProvider[],
  params: ProviderSearchParams,
): Promise<AggregatedJobs> {
  const results = await Promise.all(providers.map((provider) => searchProviderJobs(provider, params)))
  const warnings = results.flatMap((item) => (item.warning ? [item.warning] : []))
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
