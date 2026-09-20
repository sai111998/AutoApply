import type { ServerConfig } from '../../config'
import { classifyApplicationCapability } from '../../apply/capability'
import { fetchWithPolicy, type FetchLike } from '../http'
import { cleanMultilineText, cleanText, emptyNormalizedJob, inferRemote, inferWorkArrangement } from '../normalize'
import {
  defaultConnectionLabel,
  type JobProvider,
  type NormalizedJob,
  type ProviderSearchParams,
  type ProviderSearchResult,
  type ProviderWarning,
} from '../types'
import { displayBoardName, matchesProviderQuery, parseLeverSiteUrl } from './boards'

export const LEVER_POSTINGS_API = 'https://api.lever.co/v0/postings'

function warning(code: ProviderWarning['code'], params: ProviderSearchParams, message: string): ProviderSearchResult {
  return {
    provider: 'lever',
    jobs: [],
    total: 0,
    page: params.page,
    pageSize: params.pageSize,
    hasMore: false,
    warning: { provider: 'lever', code, message },
  }
}

function asEpoch(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const ms = value < 1e12 ? value * 1000 : value
  const date = new Date(ms)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function normalizeLeverJob(raw: unknown, site: string): NormalizedJob | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const title = cleanText(record.text) || cleanText(record.title)
  if (!title) return null
  const categories = record.categories && typeof record.categories === 'object' ? (record.categories as Record<string, unknown>) : {}
  const location = cleanText(categories.location) || cleanText(record.location)
  const employmentType = cleanText(categories.commitment) || cleanText(record.commitment)
  const applicationUrl = cleanText(record.applyUrl) || cleanText(record.hostedUrl)
  const description = cleanMultilineText(record.descriptionPlain) || cleanMultilineText(record.description)
  const remote = inferRemote(location, employmentType, [description ?? '', cleanText(categories.team) ?? ''])
  const capability = classifyApplicationCapability({
    url: applicationUrl,
    applicationUrl,
    discoveryProvider: 'lever',
  })
  return emptyNormalizedJob({
    provider: 'lever',
    providerJobId: cleanText(record.id),
    title,
    company: displayBoardName(site),
    location,
    remote,
    workArrangement: inferWorkArrangement(remote, location, [employmentType ?? '']),
    employmentType,
    seniority: null,
    description,
    jobUrl: applicationUrl,
    applicationUrl,
    postedAt: asEpoch(record.createdAt) ?? asEpoch(record.updatedAt),
    updatedAt: asEpoch(record.updatedAt) ?? asEpoch(record.createdAt),
    sourceUrl: cleanText(record.hostedUrl) || applicationUrl,
    source: 'Lever',
    discoveryProvider: 'lever',
    applicationProvider: capability.provider,
    applicationCapability: capability.capability,
    rawMetadata: {
      provider: 'lever',
      site,
      team: cleanText(categories.team) || cleanText(categories.department),
      category: cleanText(categories.team),
    },
  })
}

export function createLeverProvider(options: { enabled: boolean; sites: string[]; fetchImpl?: FetchLike }): JobProvider {
  const sites = [...new Set(options.sites.map((item) => item.trim().toLowerCase()).filter(Boolean))]
  const available = options.enabled && sites.length > 0

  return {
    providerName: () => 'lever',
    label: () => 'Lever',
    isEnabled: () => options.enabled,
    isAvailable: () => available,
    connectionLabel: () => defaultConnectionLabel(options.enabled, available),
    supportsApplicationAutomation: () => true,
    normalizeJob: (raw) => normalizeLeverJob(raw, sites[0] || 'unknown'),
    async getJob(jobId) {
      const parsed = parseLeverSiteUrl(jobId)
      const site = parsed?.site || (jobId.includes(':') ? jobId.split(':')[0] : sites[0])
      const id = parsed?.jobId || (jobId.includes(':') ? jobId.split(':').slice(1).join(':') : jobId)
      if (!options.enabled || !site || !id) return null
      try {
        const response = await fetchWithPolicy(
          `${LEVER_POSTINGS_API}/${encodeURIComponent(site)}/${encodeURIComponent(id)}`,
          { method: 'GET' },
          { timeoutMs: 12_000, retries: 1, minIntervalMs: 250, cacheTtlMs: 5 * 60_000, cacheKey: `lever-job:${site}:${id}` },
          options.fetchImpl,
        )
        if (!response.ok) return null
        return normalizeLeverJob(await response.json(), site)
      } catch {
        return null
      }
    },
    async searchJobs(params) {
      return this.search(params)
    },
    async search(params) {
      if (!options.enabled) return warning('disabled', params, 'Lever is turned off.')
      if (!sites.length) return warning('empty', params, 'No Lever sites are configured.')
      const jobs: NormalizedJob[] = []
      for (const site of sites) {
        try {
          const response = await fetchWithPolicy(
            `${LEVER_POSTINGS_API}/${encodeURIComponent(site)}?mode=json`,
            { method: 'GET' },
            { timeoutMs: 12_000, retries: 1, minIntervalMs: 250, cacheTtlMs: 5 * 60_000, cacheKey: `lever:${site}` },
            options.fetchImpl,
          )
          if (response.status === 429) return warning('rate_limited', params, 'Lever rate-limited the search.')
          if (!response.ok) continue
          const raw = await response.json()
          const items = Array.isArray(raw) ? raw : []
          for (const item of items) {
            const job = normalizeLeverJob(item, site)
            if (job && matchesProviderQuery(job, params)) jobs.push(job)
          }
        } catch (error) {
          if (error instanceof Error && error.name === 'TimeoutError') return warning('timeout', params, 'Lever timed out.')
        }
      }
      return {
        provider: 'lever',
        jobs,
        total: jobs.length,
        page: params.page,
        pageSize: params.pageSize,
        hasMore: false,
      }
    },
  }
}

export function leverFromConfig(config: ServerConfig, fetchImpl?: FetchLike) {
  return createLeverProvider({
    enabled: config.leverEnabled ?? false,
    sites: config.leverSites ?? [],
    fetchImpl,
  })
}
