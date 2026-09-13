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
  if (provider === 'jooble') return 'Jooble'
  if (provider === 'usajobs') return 'USAJOBS'
  return provider
}

export function formatSalary(job: Pick<DiscoveredJobResult, 'salaryMin' | 'salaryMax' | 'salaryCurrency'>): string | null {
  if (job.salaryMin == null && job.salaryMax == null) return null
  const currency = job.salaryCurrency || ''
  if (job.salaryMin != null && job.salaryMax != null && job.salaryMin !== job.salaryMax) {
    return `${currency} ${job.salaryMin.toLocaleString()} – ${job.salaryMax.toLocaleString()}`.trim()
  }
  return `${currency} ${(job.salaryMin ?? job.salaryMax)?.toLocaleString()}`.trim()
}
