import type { ServerConfig } from '../config'
import type { FetchLike } from './http'
import { jobOpportunitiesFromConfig } from './providers/job-opportunities'
import { joobleFromConfig } from './providers/jooble'
import { usajobsFromConfig } from './providers/usajobs'
import type { JobProvider, JobProviderName, NormalizedJob, ProviderStatus } from './types'

export function createJobProviders(config: ServerConfig, fetchImpl?: FetchLike): JobProvider[] {
  return [
    jobOpportunitiesFromConfig(config, fetchImpl),
    joobleFromConfig(config, fetchImpl),
    usajobsFromConfig(config, fetchImpl),
  ]
}

export function providerStatuses(providers: JobProvider[]): ProviderStatus[] {
  return providers.map((provider) => ({
    name: provider.providerName(),
    label: provider.label(),
    enabled: provider.isEnabled(),
    available: provider.isAvailable(),
    connectionLabel: provider.connectionLabel(),
  }))
}

export function selectProviders(providers: JobProvider[], requested: JobProviderName[]): JobProvider[] {
  if (!requested.length) return providers
  const allow = new Set(requested.map((item) => item.toLowerCase()))
  return providers.filter((provider) => allow.has(provider.providerName().toLowerCase()))
}

export async function fetchProviderJob(
  config: ServerConfig,
  providerName: string,
  jobId: string,
  fetchImpl?: FetchLike,
): Promise<NormalizedJob | null> {
  const provider = createJobProviders(config, fetchImpl).find(
    (item) => item.providerName().toLowerCase() === providerName.trim().toLowerCase(),
  )
  if (!provider?.getJob) return null
  return provider.getJob(jobId)
}
