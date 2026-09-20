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
import { displayBoardName, matchesProviderQuery, parseGreenhouseBoardUrl } from './boards'

export const GREENHOUSE_BOARDS_API = 'https://boards-api.greenhouse.io/v1/boards'

export interface GreenhouseQuestion {
  id: string
  label: string
  type: string
  required: boolean
  options: string[]
}

function warning(
  code: ProviderWarning['code'],
  params: ProviderSearchParams,
  message: string,
): ProviderSearchResult {
  return {
    provider: 'greenhouse',
    jobs: [],
    total: 0,
    page: params.page,
    pageSize: params.pageSize,
    hasMore: false,
    warning: { provider: 'greenhouse', code, message },
  }
}

function officeNames(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (item && typeof item === 'object' ? cleanText((item as Record<string, unknown>).name) : null))
    .filter((item): item is string => Boolean(item))
}

export function normalizeGreenhouseQuestions(raw: unknown): GreenhouseQuestion[] {
  if (!Array.isArray(raw)) return []
  const questions: GreenhouseQuestion[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const fields = Array.isArray(record.fields) ? record.fields : [record]
    for (const field of fields) {
      if (!field || typeof field !== 'object') continue
      const row = field as Record<string, unknown>
      const label = cleanText(record.label) || cleanText(row.label) || cleanText(row.name)
      if (!label) continue
      const options = Array.isArray(row.values)
        ? row.values
            .map((value) => (value && typeof value === 'object' ? cleanText((value as Record<string, unknown>).label) : cleanText(value)))
            .filter((value): value is string => Boolean(value))
        : []
      questions.push({
        id: String(row.name ?? row.id ?? label),
        label,
        type: cleanText(row.type) || 'input_text',
        required: record.required === true || row.required === true,
        options,
      })
    }
  }
  return questions
}

export function normalizeGreenhouseJob(
  raw: unknown,
  boardToken: string,
  extras: { company?: string | null; questions?: GreenhouseQuestion[] } = {},
): NormalizedJob | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const title = cleanText(record.title)
  if (!title) return null
  const location =
    (record.location && typeof record.location === 'object'
      ? cleanText((record.location as Record<string, unknown>).name)
      : cleanText(record.location)) || officeNames(record.offices).join(', ') || null
  const applicationUrl = cleanText(record.absolute_url)
  const description = cleanMultilineText(record.content) || cleanMultilineText(record.description)
  const departments = officeNames(record.departments)
  const remote = inferRemote(location, null, [description ?? ''])
  const capability = classifyApplicationCapability({
    url: applicationUrl,
    applicationUrl,
    discoveryProvider: 'greenhouse',
  })
  const questions = extras.questions ?? normalizeGreenhouseQuestions(record.questions)
  return emptyNormalizedJob({
    provider: 'greenhouse',
    providerJobId: record.id == null ? null : String(record.id),
    title,
    company: extras.company || displayBoardName(boardToken),
    location,
    remote,
    workArrangement: inferWorkArrangement(remote, location, [description ?? '']),
    employmentType: null,
    description,
    jobUrl: applicationUrl,
    applicationUrl,
    postedAt: asIsoDate(record.updated_at),
    updatedAt: asIsoDate(record.updated_at),
    sourceUrl: applicationUrl,
    source: 'Greenhouse',
    discoveryProvider: 'greenhouse',
    applicationProvider: capability.provider,
    applicationCapability: capability.capability,
    rawMetadata: {
      provider: 'greenhouse',
      boardToken,
      departments,
      offices: officeNames(record.offices),
      updatedAt: asIsoDate(record.updated_at),
      applicationQuestions: questions,
      greenhouseApiSubmission: false,
    },
  })
}

export function createGreenhouseProvider(options: {
  enabled: boolean
  boardTokens: string[]
  jobBoardApiKey?: string
  fetchImpl?: FetchLike
}): JobProvider {
  const tokens = [...new Set(options.boardTokens.map((item) => item.trim().toLowerCase()).filter(Boolean))]
  const available = options.enabled && tokens.length > 0

  async function fetchJson(url: string, cacheKey: string) {
    return fetchWithPolicy(
      url,
      { method: 'GET' },
      { timeoutMs: 12_000, retries: 1, minIntervalMs: 250, cacheTtlMs: 5 * 60_000, cacheKey },
      options.fetchImpl,
    )
  }

  async function boardCompany(token: string): Promise<string> {
    try {
      const response = await fetchJson(`${GREENHOUSE_BOARDS_API}/${encodeURIComponent(token)}`, `gh-board:${token}`)
      if (!response.ok) return displayBoardName(token)
      const raw = (await response.json()) as Record<string, unknown>
      return cleanText(raw.name) || displayBoardName(token)
    } catch {
      return displayBoardName(token)
    }
  }

  return {
    providerName: () => 'greenhouse',
    label: () => 'Greenhouse',
    isEnabled: () => options.enabled,
    isAvailable: () => available,
    connectionLabel: () => defaultConnectionLabel(options.enabled, available),
    supportsApplicationAutomation: () => true,
    normalizeJob: (raw) => normalizeGreenhouseJob(raw, tokens[0] || 'unknown'),
    async getJob(jobId) {
      const parsed = parseGreenhouseBoardUrl(jobId)
      const token = parsed?.boardToken || (jobId.includes(':') ? jobId.split(':')[0] : tokens[0])
      const id = parsed?.jobId || (jobId.includes(':') ? jobId.split(':')[1] : jobId)
      if (!options.enabled || !token || !id) return null
      try {
        const response = await fetchJson(
          `${GREENHOUSE_BOARDS_API}/${encodeURIComponent(token)}/jobs/${encodeURIComponent(id)}?questions=true`,
          `gh-job:${token}:${id}`,
        )
        if (!response.ok) return null
        const raw = await response.json()
        const questions = normalizeGreenhouseQuestions((raw as Record<string, unknown>).questions)
        return normalizeGreenhouseJob(raw, token, { company: await boardCompany(token), questions })
      } catch {
        return null
      }
    },
    async searchJobs(params) {
      return this.search(params)
    },
    async search(params) {
      if (!options.enabled) return warning('disabled', params, 'Greenhouse is turned off.')
      if (!tokens.length) return warning('empty', params, 'No Greenhouse board tokens are configured.')
      const jobs: NormalizedJob[] = []
      let invalidBoard = false
      for (const token of tokens) {
        try {
          const response = await fetchJson(
            `${GREENHOUSE_BOARDS_API}/${encodeURIComponent(token)}/jobs?content=true`,
            `gh-jobs:${token}`,
          )
          if (response.status === 404) {
            invalidBoard = true
            continue
          }
          if (response.status === 429) return warning('rate_limited', params, 'Greenhouse rate-limited the search.')
          if (!response.ok) continue
          const raw = await response.json()
          const items = raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>).jobs)
            ? ((raw as Record<string, unknown>).jobs as unknown[])
            : []
          const company = await boardCompany(token)
          for (const item of items) {
            const job = normalizeGreenhouseJob(item, token, { company })
            if (job && matchesProviderQuery(job, params)) jobs.push(job)
          }
        } catch (error) {
          if (error instanceof Error && error.name === 'TimeoutError') return warning('timeout', params, 'Greenhouse timed out.')
        }
      }
      if (!jobs.length && invalidBoard && tokens.length === 1) {
        return warning('unavailable', params, 'Greenhouse board was not found.')
      }
      return {
        provider: 'greenhouse',
        jobs,
        total: jobs.length,
        page: params.page,
        pageSize: params.pageSize,
        hasMore: false,
      }
    },
  }
}

export function greenhouseFromConfig(config: ServerConfig, fetchImpl?: FetchLike) {
  return createGreenhouseProvider({
    enabled: config.greenhouseEnabled ?? false,
    boardTokens: config.greenhouseBoardTokens ?? [],
    jobBoardApiKey: config.greenhouseJobBoardApiKey ?? '',
    fetchImpl,
  })
}

export function canSubmitGreenhouseViaApi(apiKey?: string | null): boolean {
  return Boolean(apiKey?.trim())
}
