import type { Job } from '@/types/domain'
import type { DiscoveredJobResult } from '@/lib/ai/client'

export function discoveredToJob(job: DiscoveredJobResult, userId: string): Job {
  return {
    id: job.id,
    userId,
    title: job.title,
    company: job.company || 'Unknown company',
    location: job.location ?? '',
    jobUrl: job.jobUrl || job.url || '',
    description: job.description ?? '',
    createdAt: job.discoveredAt || job.fetchedAt || new Date().toISOString(),
    provider: job.provider,
    providerJobId: job.providerJobId || job.sourceJobId,
    remote: job.remote,
    workArrangement: job.workArrangement,
    employmentType: job.employmentType,
    seniority: job.seniority,
    postedAt: job.postedAt,
    discoveredAt: job.discoveredAt || job.fetchedAt,
    lastVerifiedAt: job.lastVerifiedAt,
    salaryMin: job.salaryMin,
    salaryMax: job.salaryMax,
    salaryCurrency: job.salaryCurrency,
    source: job.source,
    identityKey: job.identityKey,
    matchScore: job.match?.score ?? job.matchScore ?? null,
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
    seniority: fresh.seniority ?? current.seniority,
    description: fresh.description || current.description,
    jobUrl: fresh.jobUrl || fresh.url || current.jobUrl || current.url || null,
    url: fresh.url || fresh.jobUrl || current.url || current.jobUrl || null,
    sourceJobId: fresh.sourceJobId || fresh.providerJobId || current.sourceJobId || current.providerJobId,
    postedAt: fresh.postedAt ?? current.postedAt,
    lastVerifiedAt: fresh.lastVerifiedAt || current.lastVerifiedAt,
    source: fresh.source || current.source,
    rawMetadata: { ...current.rawMetadata, ...fresh.rawMetadata },
  }
}

export function applyUrl(job: Pick<DiscoveredJobResult, 'jobUrl' | 'url'>): string | null {
  const value = (job.jobUrl || job.url || '').trim()
  return value || null
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
