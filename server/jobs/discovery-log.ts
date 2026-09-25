import { logApplyEvent } from '../apply/log'

export interface ProviderDiscoveryCounts {
  provider: string
  query: string
  country: string
  state: string
  filters: {
    remote: string
    employmentType: string
    jobType: string
    keywords: string[]
  }
  raw: number
  normalized: number
  deduplicated: number
  filtered: number
}

export function logDiscoveryCounts(entry: ProviderDiscoveryCounts): void {
  logApplyEvent('discovery-provider', {
    provider: entry.provider,
    code: 'OK',
    error: null,
  })
  console.info('[AutoApply] discovery-provider', {
    provider: entry.provider,
    query: entry.query,
    country: entry.country,
    state: entry.state,
    filters: entry.filters,
    raw: entry.raw,
    normalized: entry.normalized,
    deduplicated: entry.deduplicated,
    filtered: entry.filtered,
  })
}
