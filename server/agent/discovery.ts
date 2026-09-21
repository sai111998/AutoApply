import type { ServerConfig } from '../config'
import { listLiveJobs, type LiveJobsRequest } from '../jobs/list'
import type { FetchLike } from '../jobs/http'
import type { ListedAutoApplyJob, AutoApplyStartInput } from '../apply/types'
import type { ProviderWarning } from '../jobs/types'
import { SEARCH_PAGE_LIMIT } from './policy'
import { fetchProviderJob } from '../jobs/provider'
import { ApplyError } from '../apply/errors'
import type { EligibilityFunnel } from './pipeline'

const APPLY_DISCOVERY_MESSAGE = 'DISCOVERY_FAILED'

export interface CampaignDiscoveryDeps {
  listJobs?: (request: LiveJobsRequest) => Promise<{ jobs: ListedAutoApplyJob[]; warning?: ProviderWarning }>
}

export interface CampaignDiscoveryResult {
  jobs: ListedAutoApplyJob[]
  warning?: ProviderWarning
  funnel: Pick<
    EligibilityFunnel,
    'discovered' | 'afterKeywords' | 'afterLocation' | 'afterRemote' | 'afterEmploymentType'
  >
}

function matchesLocation(job: ListedAutoApplyJob, location: string, state: string): boolean {
  const wanted = [location, state].map((item) => item.trim().toLowerCase()).filter(Boolean)
  if (!wanted.length) return true
  const haystack = `${job.location ?? ''} ${job.title} ${job.company}`.toLowerCase()
  return wanted.every((item) => haystack.includes(item))
}

function matchesRemote(job: ListedAutoApplyJob, remote: AutoApplyStartInput['config']['remotePreference']): boolean {
  if (remote === 'any') return true
  if (remote === 'remote') return job.location?.toLowerCase().includes('remote') || /remote/i.test(job.description ?? '')
  if (remote === 'hybrid') return /hybrid/i.test(`${job.location ?? ''} ${job.description ?? ''}`)
  return !/remote/i.test(job.location ?? '')
}

function matchesEmployment(job: ListedAutoApplyJob, employmentType: AutoApplyStartInput['config']['employmentType']): boolean {
  if (!employmentType || employmentType === 'any') return true
  const value = (job.employmentType ?? '').toLowerCase()
  if (!value) return true
  return value.includes(employmentType.replace('-', ' ')) || value.includes(employmentType)
}

export async function discoverCampaignJobs(
  config: ServerConfig,
  input: AutoApplyStartInput,
  fetchImpl: FetchLike | undefined,
  deps: CampaignDiscoveryDeps = {},
): Promise<CampaignDiscoveryResult> {
  const listJobs =
    deps.listJobs ??
    ((request: LiveJobsRequest) => listLiveJobs(config, request, fetchImpl))
  let listed: { jobs: ListedAutoApplyJob[]; warning?: ProviderWarning }
  try {
    listed = await listJobs({
      q: input.config.q,
      country: input.config.country || 'US',
      state: input.config.state,
      location: input.config.location,
      remote: input.config.remotePreference,
      employmentType: input.config.employmentType || 'any',
      seniority: '',
      page: 1,
      limit: SEARCH_PAGE_LIMIT,
      resumeText: input.resumeText,
      resumeVersionId: input.resumeVersionId ?? undefined,
      sort: 'match',
      jobType: input.config.jobType,
    })
  } catch (error) {
    throw new ApplyError(503, 'DISCOVERY_FAILED', APPLY_DISCOVERY_MESSAGE, {
      error: error instanceof Error ? error.message : 'unknown',
    })
  }
  if (!listed.jobs.length && listed.warning && ['unavailable', 'timeout', 'rate_limited'].includes(listed.warning.code)) {
    throw new ApplyError(503, 'DISCOVERY_FAILED', listed.warning.message || APPLY_DISCOVERY_MESSAGE)
  }

  let afterKeywords: ListedAutoApplyJob[]
  let afterLocation: ListedAutoApplyJob[]
  let afterRemote: ListedAutoApplyJob[]
  let afterEmploymentType: ListedAutoApplyJob[]
  let enriched: ListedAutoApplyJob[]
  try {
    const keywords = input.config.keywords.map((item) => item.trim().toLowerCase()).filter(Boolean)
    const titles = (input.config.jobTitles ?? []).map((item) => item.trim().toLowerCase()).filter(Boolean)
    afterKeywords = listed.jobs.filter((job) => {
      if (keywords.length) {
        const haystack = `${job.title} ${job.company} ${job.description ?? ''}`.toLowerCase()
        if (!keywords.every((keyword) => haystack.includes(keyword))) return false
      }
      if (titles.length) {
        const title = job.title.toLowerCase()
        if (!titles.some((item) => title.includes(item))) return false
      }
      return true
    })
    afterLocation = afterKeywords.filter((job) => matchesLocation(job, input.config.location, input.config.state))
    afterRemote = afterLocation.filter((job) => matchesRemote(job, input.config.remotePreference))
    afterEmploymentType = afterRemote.filter((job) => matchesEmployment(job, input.config.employmentType || 'any'))
    enriched = await Promise.all(
      afterEmploymentType.map(async (job) => {
        const discovery = job.discoveryProvider || job.provider
        if (discovery !== 'greenhouse') return job
        const existing = job.rawMetadata?.applicationQuestions
        if (Array.isArray(existing) && existing.length) return job
        const token = typeof job.rawMetadata?.boardToken === 'string' ? job.rawMetadata.boardToken : null
        const id = job.providerJobId
        if (!token || !id) return job
        const detail = await fetchProviderJob(config, 'greenhouse', `${token}:${id}`, fetchImpl)
        if (!detail) return job
        return {
          ...job,
          description: job.description || detail.description,
          rawMetadata: { ...job.rawMetadata, ...detail.rawMetadata },
        }
      }),
    )
  } catch (error) {
    if (error instanceof ApplyError) throw error
    throw new ApplyError(500, 'FILTER_ERROR', 'FILTER_ERROR', {
      error: error instanceof Error ? error.message : 'unknown',
    })
  }

  return {
    jobs: enriched,
    warning: listed.warning,
    funnel: {
      discovered: listed.jobs.length,
      afterKeywords: afterKeywords.length,
      afterLocation: afterLocation.length,
      afterRemote: afterRemote.length,
      afterEmploymentType: afterEmploymentType.length,
    },
  }
}
