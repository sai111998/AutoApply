import type { Job } from '@/types/domain'
import type { DiscoveredJobResult } from '@/lib/ai/client'

export function discoveredToJob(job: DiscoveredJobResult, userId: string): Job {
  return {
    id: job.id,
    userId,
    title: job.title,
    company: job.company || 'Unknown company',
    location: job.location ?? '',
    jobUrl: job.jobUrl ?? '',
    description: job.description ?? '',
    createdAt: job.discoveredAt,
    provider: job.provider,
    providerJobId: job.providerJobId,
    remote: job.remote,
    workArrangement: job.workArrangement,
    employmentType: job.employmentType,
    postedAt: job.postedAt,
    discoveredAt: job.discoveredAt,
    lastVerifiedAt: job.lastVerifiedAt,
    salaryMin: job.salaryMin,
    salaryMax: job.salaryMax,
    salaryCurrency: job.salaryCurrency,
    source: job.source,
    identityKey: job.identityKey,
  }
}

export function providerLabel(provider: string | null | undefined): string {
  if (!provider) return 'Unknown'
  if (provider === 'job-opportunities') return 'Job Opportunities API'
  if (provider === 'jooble') return 'Jooble'
  if (provider === 'usajobs') return 'USAJOBS'
  return provider
}

export function listingSource(job: Pick<DiscoveredJobResult, 'rawMetadata'>): string | null {
  const value = job.rawMetadata?.listingSource
  return typeof value === 'string' && value.trim() ? value : null
}

export function mergeLiveJob(current: DiscoveredJobResult, fresh: DiscoveredJobResult): DiscoveredJobResult {
  return {
    ...current,
    title: fresh.title || current.title,
    company: fresh.company || current.company,
    location: fresh.location ?? current.location,
    remote: fresh.remote ?? current.remote,
    workArrangement: fresh.workArrangement ?? current.workArrangement,
    employmentType: fresh.employmentType ?? current.employmentType,
    description: fresh.description || current.description,
    jobUrl: fresh.jobUrl || current.jobUrl,
    postedAt: fresh.postedAt ?? current.postedAt,
    lastVerifiedAt: fresh.lastVerifiedAt || current.lastVerifiedAt,
    source: fresh.source || current.source,
    rawMetadata: { ...current.rawMetadata, ...fresh.rawMetadata },
  }
}

export function formatSalary(job: {
  salaryMin: number | null
  salaryMax: number | null
  salaryCurrency: string | null
}): string | null {
  if (job.salaryMin == null && job.salaryMax == null) return null
  const currency = job.salaryCurrency || ''
  if (job.salaryMin != null && job.salaryMax != null && job.salaryMin !== job.salaryMax) {
    return `${currency} ${job.salaryMin.toLocaleString()} – ${job.salaryMax.toLocaleString()}`.trim()
  }
  return `${currency} ${(job.salaryMin ?? job.salaryMax)?.toLocaleString()}`.trim()
}
