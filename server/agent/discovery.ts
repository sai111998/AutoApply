import { listLiveJobs, type LiveJobsRequest } from '../jobs/list'
import type { ServerConfig } from '../config'
import type { FetchLike } from '../jobs/http'
import type { ListedAutoApplyJob, AutoApplyStartInput } from '../apply/types'
import { SEARCH_PAGE_LIMIT } from './policy'

export interface CampaignDiscoveryDeps {
  listJobs?: (request: LiveJobsRequest) => Promise<{ jobs: ListedAutoApplyJob[] }>
}

export async function discoverCampaignJobs(
  config: ServerConfig,
  input: AutoApplyStartInput,
  fetchImpl: FetchLike | undefined,
  deps: CampaignDiscoveryDeps = {},
): Promise<ListedAutoApplyJob[]> {
  const listJobs =
    deps.listJobs ??
    ((request: LiveJobsRequest) => listLiveJobs(config, request, fetchImpl))
  const listed = await listJobs({
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
  const keywords = input.config.keywords.map((item) => item.trim().toLowerCase()).filter(Boolean)
  const titles = (input.config.jobTitles ?? []).map((item) => item.trim().toLowerCase()).filter(Boolean)
  return listed.jobs.filter((job) => {
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
}
