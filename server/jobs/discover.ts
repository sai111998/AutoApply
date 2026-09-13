import { extractJobLocal, extractResumeLocal } from '../match/extract-local'
import { scoreMatch } from '../match/engine'
import type { ServerConfig } from '../config'
import { deduplicateJobs } from './deduplicate'
import type { FetchLike } from './http'
import { stableJobId } from './normalize'
import { createJobProviders, providerStatuses, selectProviders } from './provider'
import { persistDiscoveredJobs } from './store'
import type {
  DiscoverRequest,
  DiscoverResponse,
  DiscoveredJob,
  NormalizedJob,
  ProviderSearchParams,
  ProviderWarning,
} from './types'

function keywordsFrom(request: DiscoverRequest): string {
  return [...request.roles, ...request.keywords].map((item) => item.trim()).filter(Boolean).join(' ') || 'software engineer'
}

function providerParams(request: DiscoverRequest): ProviderSearchParams {
  return {
    keywords: keywordsFrom(request),
    location: request.location.trim() || 'United States',
    remote: request.remote,
    employmentType: request.employmentType,
    datePostedDays: request.datePostedDays,
    page: request.page,
    pageSize: request.pageSize,
  }
}

function matchesRemote(job: NormalizedJob, remote: DiscoverRequest['remote']): boolean {
  if (remote === 'any') return true
  if (remote === 'remote') return job.remote === true || job.workArrangement === 'remote'
  if (remote === 'hybrid') return job.workArrangement === 'hybrid'
  return job.remote === false || job.workArrangement === 'onsite'
}

function matchesEmployment(job: NormalizedJob, filter: DiscoverRequest['employmentType']): boolean {
  if (filter === 'any' || !job.employmentType) return true
  const value = job.employmentType.toLowerCase()
  return value.includes(filter.replace('-', ' ')) || value.includes(filter)
}

function matchesExperience(job: NormalizedJob, level: string): boolean {
  const wanted = level.trim().toLowerCase()
  if (!wanted || wanted === 'any') return true
  const text = `${job.title} ${job.description ?? ''}`.toLowerCase()
  if (wanted === 'entry' || wanted === 'junior') return /\b(junior|entry|intern|associate)\b/.test(text)
  if (wanted === 'senior') return /\b(senior|staff|principal|lead)\b/.test(text)
  if (wanted === 'mid') return !/\b(intern|entry-level)\b/.test(text)
  return true
}

function scoreJob(job: NormalizedJob, resumeText: string): Pick<DiscoveredJob, 'matchScore' | 'matchedSkills'> {
  const description = job.description?.trim()
  if (!description) return { matchScore: null, matchedSkills: [] }
  const report = scoreMatch(extractResumeLocal(resumeText), extractJobLocal(description), resumeText)
  return {
    matchScore: report.matchScore,
    matchedSkills: [
      ...report.requiredSkills.matched.map((item) => item.name),
      ...report.preferredSkills.matched.map((item) => item.name),
    ].slice(0, 6),
  }
}

export async function discoverJobs(
  config: ServerConfig,
  request: DiscoverRequest,
  fetchImpl?: FetchLike,
): Promise<DiscoverResponse> {
  const allProviders = createJobProviders(config, fetchImpl)
  const providers = selectProviders(allProviders, request.providers)
  const params = providerParams(request)
  const results = await Promise.all(providers.map((provider) => provider.search(params)))
  const warnings: ProviderWarning[] = results.flatMap((item) => (item.warning ? [item.warning] : []))
  const merged = deduplicateJobs(results.flatMap((item) => item.jobs))
    .filter((job) => matchesRemote(job, request.remote))
    .filter((job) => matchesEmployment(job, request.employmentType))
    .filter((job) => matchesExperience(job, request.experienceLevel))
    .sort((left, right) => (right.postedAt ?? right.discoveredAt).localeCompare(left.postedAt ?? left.discoveredAt))

  const resumeText = request.resumeText?.trim() ?? ''
  const scored: DiscoveredJob[] = merged.map((job) => ({
    ...job,
    id: stableJobId(job.identityKey, request.userId),
    demo: false,
    ...(resumeText ? scoreJob(job, resumeText) : { matchScore: null, matchedSkills: [] }),
  }))

  const filtered =
    request.minMatchScore == null
      ? scored
      : scored.filter((job) => job.matchScore == null || job.matchScore >= request.minMatchScore!)

  if (request.persist !== false && request.userId) {
    await persistDiscoveredJobs(config, request.userId, filtered)
  }

  const reportedTotals = results.map((item) => item.total).filter((item): item is number => item != null)
  const total = reportedTotals.length ? Math.max(...reportedTotals, filtered.length) : filtered.length

  return {
    jobs: filtered,
    page: request.page,
    pageSize: request.pageSize,
    total,
    providers: providerStatuses(allProviders),
    warnings,
    hasMore: results.some((item) => item.hasMore),
    demo: false,
  }
}
