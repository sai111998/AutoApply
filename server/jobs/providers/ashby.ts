import type { ServerConfig } from '../../config'
import { classifyApplicationCapability } from '../../apply/capability'
import { fetchWithPolicy, type FetchLike } from '../http'
import { asIsoDate, cleanMultilineText, cleanText, emptyNormalizedJob, inferRemote, inferWorkArrangement } from '../normalize'
import {
  defaultConnectionLabel,
  type JobProvider,
  type NormalizedJob,
  type ProviderSearchParams,
  type ProviderSearchResult,
  type ProviderWarning,
} from '../types'
import { displayBoardName, matchesProviderQuery, parseAshbyBoardUrl } from './boards'

export const ASHBY_POSTINGS_API = 'https://api.ashbyhq.com/posting-api/job-board'

function warning(code: ProviderWarning['code'], params: ProviderSearchParams, message: string): ProviderSearchResult {
  return {
    provider: 'ashby',
    jobs: [],
    total: 0,
    page: params.page,
    pageSize: params.pageSize,
    hasMore: false,
    warning: { provider: 'ashby', code, message },
  }
}

function employmentFrom(value: unknown): string | null {
  const text = cleanText(value)
  if (!text) return null
  if (/full/i.test(text)) return 'Full-time'
  if (/part/i.test(text)) return 'Part-time'
  if (/contract/i.test(text)) return 'Contract'
  if (/intern/i.test(text)) return 'Internship'
  return text
}

export function normalizeAshbyJob(raw: unknown, board: string): NormalizedJob | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const title = cleanText(record.title)
  if (!title) return null
  const location = cleanText(record.locationName) || cleanText(record.location)
  const employmentType = employmentFrom(record.employmentType)
  const workplace = cleanText(record.workplaceType) || cleanText(record.workplace)
  const applicationUrl = cleanText(record.applyUrl) || cleanText(record.jobUrl)
  const description = cleanMultilineText(record.descriptionPlain) || cleanMultilineText(record.descriptionHtml) || cleanMultilineText(record.description)
  const remote = record.isRemote === true || inferRemote(location, workplace, [description ?? ''])
  const capability = classifyApplicationCapability({
    url: applicationUrl,
    applicationUrl,
    discoveryProvider: 'ashby',
  })
  return emptyNormalizedJob({
    provider: 'ashby',
    providerJobId: cleanText(record.id),
    title,
    company: displayBoardName(board),
    location,
    remote,
    workArrangement: inferWorkArrangement(remote, location, [workplace ?? '']),
    employmentType,
    description,
    jobUrl: applicationUrl,
    applicationUrl,
    postedAt: asIsoDate(record.publishedDate) || asIsoDate(record.publishedAt),
    updatedAt: asIsoDate(record.updatedAt) || asIsoDate(record.publishedDate),
    sourceUrl: cleanText(record.jobUrl) || applicationUrl,
    source: 'Ashby',
    discoveryProvider: 'ashby',
    applicationProvider: capability.provider,
    applicationCapability: capability.capability,
    rawMetadata: {
      provider: 'ashby',
      board,
      department: cleanText(record.departmentName),
      workplaceType: workplace,
      employmentType: cleanText(record.employmentType),
    },
  })
}

export function createAshbyProvider(options: { enabled: boolean; boards: string[]; fetchImpl?: FetchLike }): JobProvider {
  const boards = [...new Set(options.boards.map((item) => item.trim().toLowerCase()).filter(Boolean))]
  const available = options.enabled && boards.length > 0

  return {
    providerName: () => 'ashby',
    label: () => 'Ashby',
    isEnabled: () => options.enabled,
    isAvailable: () => available,
    connectionLabel: () => defaultConnectionLabel(options.enabled, available),
    supportsApplicationAutomation: () => true,
    normalizeJob: (raw) => normalizeAshbyJob(raw, boards[0] || 'unknown'),
    async getJob(jobId) {
      const parsed = parseAshbyBoardUrl(jobId)
      const board = parsed?.board || (jobId.includes(':') ? jobId.split(':')[0] : boards[0])
      const id = parsed?.jobId || (jobId.includes(':') ? jobId.split(':').slice(1).join(':') : jobId)
      if (!options.enabled || !board) return null
      const listed = await createAshbyProvider(options).search({
        keywords: '',
        location: '',
        remote: 'any',
        employmentType: 'any',
        datePostedDays: 0,
        page: 1,
        pageSize: 100,
      })
      return listed.jobs.find((job) => job.providerJobId === id || job.jobUrl?.includes(id)) ?? null
    },
    async searchJobs(params) {
      return this.search(params)
    },
    async search(params) {
      if (!options.enabled) return warning('disabled', params, 'Ashby is turned off.')
      if (!boards.length) {
        return { provider: 'ashby', jobs: [], total: 0, page: params.page, pageSize: params.pageSize, hasMore: false }
      }
      const jobs: NormalizedJob[] = []
      for (const board of boards) {
        try {
          const response = await fetchWithPolicy(
            `${ASHBY_POSTINGS_API}/${encodeURIComponent(board)}`,
            { method: 'GET' },
            { timeoutMs: 12_000, retries: 1, minIntervalMs: 250, cacheTtlMs: 5 * 60_000, cacheKey: `ashby:${board}` },
            options.fetchImpl,
          )
          if (response.status === 429) return warning('rate_limited', params, 'Ashby rate-limited the search.')
          if (!response.ok) continue
          const raw = await response.json()
          const items =
            raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>).jobs)
              ? ((raw as Record<string, unknown>).jobs as unknown[])
              : Array.isArray(raw)
                ? raw
                : []
          for (const item of items) {
            const job = normalizeAshbyJob(item, board)
            if (job && matchesProviderQuery(job, params)) jobs.push(job)
          }
        } catch (error) {
          if (error instanceof Error && error.name === 'TimeoutError') return warning('timeout', params, 'Ashby timed out.')
        }
      }
      return {
        provider: 'ashby',
        jobs,
        total: jobs.length,
        page: params.page,
        pageSize: params.pageSize,
        hasMore: false,
      }
    },
  }
}

export function ashbyFromConfig(config: ServerConfig, fetchImpl?: FetchLike) {
  return createAshbyProvider({
    enabled: config.ashbyEnabled ?? false,
    boards: config.ashbyBoards ?? [],
    fetchImpl,
  })
}
