import { canEnterAutonomousApply, classifyApplicationCapability } from './capability'
import type { AutoApplyProfile, ExistingApplicationRecord, ListedAutoApplyJob } from './types'

const MAX_LIVE_JOB_AGE_MS = 90 * 24 * 60 * 60 * 1000
const CLOSED_STATUSES = new Set(['closed', 'expired', 'filled', 'archived', 'inactive'])

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

export function isJobLive(job: ListedAutoApplyJob): boolean {
  const status = String(job.rawMetadata?.status ?? job.rawMetadata?.jobStatus ?? '').toLowerCase()
  if (CLOSED_STATUSES.has(status)) return false
  if (job.rawMetadata?.expired === true || job.rawMetadata?.live === false) return false
  return Boolean(jobApplicationUrl(job))
}

export function isJobExpired(job: ListedAutoApplyJob, now = Date.now()): boolean {
  if (!isJobLive(job)) return true
  const posted = Date.parse(job.postedAt ?? '')
  return Number.isFinite(posted) && now - posted > MAX_LIVE_JOB_AGE_MS
}

export function hasRequiredCandidateInformation(
  profile?: Pick<AutoApplyProfile, 'fullName' | 'email'> | null,
): boolean {
  if (!profile) return true
  return Boolean(profile.fullName.trim() && profile.email.trim())
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
    profile?: Pick<AutoApplyProfile, 'fullName' | 'email'> | null
    skipScoreCheck?: boolean
    now?: number
  },
): { ok: boolean; reason: string | null } {
  if (isExcludedCompany(job.company, options.excludedCompanies)) {
    return { ok: false, reason: 'This company is excluded from Auto Apply.' }
  }
  if (options.jobType === 'c2c' && job.c2cStatus !== 'confirmed') {
    return { ok: false, reason: 'C2C-only mode requires a confirmed C2C job.' }
  }
  if (!options.skipScoreCheck && !meetsMatchThreshold(options.finalMatchScore, options.minimumMatchRate)) {
    return { ok: false, reason: 'Match score is below the selected threshold.' }
  }
  if (!jobApplicationUrl(job)) {
    return { ok: false, reason: 'This listing does not include a valid application URL.' }
  }
  if (!isJobLive(job)) {
    return { ok: false, reason: 'This job is no longer live.' }
  }
  if (isJobExpired(job, options.now)) {
    return { ok: false, reason: 'This job posting has expired.' }
  }
  if (!hasRequiredCandidateInformation(options.profile)) {
    return { ok: false, reason: 'Required candidate information is missing.' }
  }
  if (hasDuplicateApplication(job, options.existingApplications)) {
    return { ok: false, reason: 'An application for this job already exists.' }
  }
  if (hasDuplicateQueueEntry(job, options.existingQueueIdentities)) {
    return { ok: false, reason: 'This job is already in the Auto Apply queue.' }
  }
  const capability = classifyApplicationCapability({
    url: job.url,
    applicationUrl: jobApplicationUrl(job),
    discoveryProvider: job.discoveryProvider || job.provider,
  })
  if (!canEnterAutonomousApply(capability.capability)) {
    return {
      ok: false,
      reason:
        capability.capability === 'unsupported'
          ? 'This listing is not Auto-Apply capable.'
          : capability.capability === 'blocked'
            ? 'This application is blocked from autonomous apply.'
            : capability.capability === 'assisted_apply'
              ? 'This application needs user input and cannot run autonomously.'
              : 'Application capability is unknown, so this job stays discovery-only.',
    }
  }
  return { ok: true, reason: null }
}
