import type { ExistingApplicationRecord, ListedAutoApplyJob } from './types'

const FAILED_ATTEMPT = new Set(['failed', 'blocked', 'cancelled'])
const APPLIED = new Set(['applied', 'interview', 'offer'])

export function jobApplicationUrl(job: Pick<ListedAutoApplyJob, 'url' | 'jobUrl'>): string | null {
  const value = (job.jobUrl || job.url || '').trim()
  return value || null
}

export function applicationIdentity(job: Pick<ListedAutoApplyJob, 'identityKey' | 'id' | 'url' | 'jobUrl'>): string {
  if (job.identityKey?.trim()) return job.identityKey.trim().toLowerCase()
  const url = jobApplicationUrl(job)
  if (url) return `url:${url.toLowerCase()}`
  return job.id.toLowerCase()
}

export function hasDuplicateApplication(
  job: ListedAutoApplyJob,
  existing: ExistingApplicationRecord[] = [],
): boolean {
  const identity = applicationIdentity(job)
  const url = jobApplicationUrl(job)?.toLowerCase() ?? ''
  return existing.some((item) => {
    const status = (item.status ?? '').toLowerCase()
    const itemIdentity = (item.identityKey ?? '').trim().toLowerCase()
    const itemUrl = (item.applicationUrl ?? '').trim().toLowerCase()
    const sameJob =
      item.jobId === job.id ||
      (itemIdentity && itemIdentity === identity) ||
      (url && itemUrl && itemUrl === url)
    if (!sameJob) return false
    if (APPLIED.has(status) || FAILED_ATTEMPT.has(status) || status === 'ready') return true
    return true
  })
}

export function isExcludedCompany(company: string | null | undefined, excluded: string[] = []): boolean {
  const hay = (company ?? '').trim().toLowerCase()
  if (!hay) return false
  return excluded.some((item) => {
    const needle = item.trim().toLowerCase()
    return Boolean(needle) && (hay === needle || hay.includes(needle))
  })
}

export function hasDuplicateQueueEntry(job: ListedAutoApplyJob, identities: string[] = []): boolean {
  const identity = applicationIdentity(job)
  return identities.some((item) => item.trim().toLowerCase() === identity)
}

export function meetsMatchThreshold(score: number | null | undefined, minimumMatchRate: number): boolean {
  if (score == null || !Number.isFinite(score)) return false
  return score >= minimumMatchRate
}

export function isEligibleForAutoApply(
  job: ListedAutoApplyJob,
  options: {
    minimumMatchRate: number
    finalMatchScore: number | null
    existingApplications?: ExistingApplicationRecord[]
    existingQueueIdentities?: string[]
    jobType?: import('../jobs/c2c').JobTypeFilter
    excludedCompanies?: string[]
  },
): { ok: boolean; reason: string | null } {
  if (isExcludedCompany(job.company, options.excludedCompanies)) {
    return { ok: false, reason: 'This company is excluded from Auto Apply.' }
  }
  if (options.jobType === 'c2c' && job.c2cStatus !== 'confirmed') {
    return { ok: false, reason: 'C2C-only mode requires a confirmed C2C job.' }
  }
  if (!meetsMatchThreshold(options.finalMatchScore, options.minimumMatchRate)) {
    return { ok: false, reason: 'Match score is below the selected threshold.' }
  }
  if (!jobApplicationUrl(job)) {
    return { ok: false, reason: 'This listing does not include a valid application URL.' }
  }
  if (hasDuplicateApplication(job, options.existingApplications)) {
    return { ok: false, reason: 'An application for this job already exists.' }
  }
  if (hasDuplicateQueueEntry(job, options.existingQueueIdentities)) {
    return { ok: false, reason: 'This job is already in the Auto Apply queue.' }
  }
  return { ok: true, reason: null }
}
