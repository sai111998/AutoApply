import { fingerprint } from './normalize'
import type { NormalizedJob } from './types'

function quality(job: NormalizedJob): number {
  return (
    (job.description ? job.description.length : 0) +
    (job.jobUrl ? 40 : 0) +
    (job.salaryMin || job.salaryMax ? 20 : 0) +
    (job.postedAt ? 10 : 0) +
    (job.company ? 10 : 0) +
    (job.provider === 'greenhouse' || job.provider === 'lever' || job.provider === 'ashby' ? 50 : 0)
  )
}

export function deduplicateJobs(jobs: NormalizedJob[]): NormalizedJob[] {
  const byProviderId = new Map<string, NormalizedJob>()
  const byFingerprint = new Map<string, NormalizedJob>()
  const result: NormalizedJob[] = []

  for (const job of jobs) {
    const providerKey = job.providerJobId ? `${job.provider}:${job.providerJobId.toLowerCase()}` : ''
    const print = fingerprint(job)
    const existing =
      (providerKey ? byProviderId.get(providerKey) : undefined) ?? byFingerprint.get(print)
    if (!existing) {
      result.push(job)
      if (providerKey) byProviderId.set(providerKey, job)
      byFingerprint.set(print, job)
      continue
    }
    if (quality(job) <= quality(existing)) {
      const sources = Array.isArray(existing.rawMetadata.sources) ? existing.rawMetadata.sources : [existing.source]
      existing.rawMetadata = {
        ...existing.rawMetadata,
        sources: [...new Set([...sources, job.source, job.provider].filter(Boolean))],
      }
      continue
    }
    const index = result.indexOf(existing)
    const sources = Array.isArray(existing.rawMetadata.sources) ? existing.rawMetadata.sources : [existing.source]
    const merged: NormalizedJob = {
      ...job,
      rawMetadata: {
        ...job.rawMetadata,
        sources: [...new Set([...sources, job.source, existing.provider].filter(Boolean))],
        replacedIdentity: existing.identityKey,
      },
    }
    if (index >= 0) result[index] = merged
    if (providerKey) byProviderId.set(providerKey, merged)
    byFingerprint.set(print, merged)
    if (existing.providerJobId) byProviderId.set(`${existing.provider}:${existing.providerJobId.toLowerCase()}`, merged)
  }

  return result
}
