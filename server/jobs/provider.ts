import type { ServerConfig } from '../config'
import type { FetchLike } from './http'
import { joobleFromConfig } from './providers/jooble'
import { usajobsFromConfig } from './providers/usajobs'
import type { JobProvider, JobProviderName, ProviderStatus } from './types'

export function createJobProviders(config: ServerConfig, fetchImpl?: FetchLike): JobProvider[] {
  return [joobleFromConfig(config, fetchImpl), usajobsFromConfig(config, fetchImpl)]
}

export function providerStatuses(providers: JobProvider[]): ProviderStatus[] {
  return providers.map((provider) => ({
    name: provider.providerName(),
    label: provider.label(),
    enabled: provider.isEnabled(),
    available: provider.isAvailable(),
  }))
}

export function selectProviders(providers: JobProvider[], requested: JobProviderName[]): JobProvider[] {
  if (!requested.length) return providers
  const allow = new Set(requested.map((item) => item.toLowerCase()))
  return providers.filter((provider) => allow.has(provider.providerName().toLowerCase()))
}
