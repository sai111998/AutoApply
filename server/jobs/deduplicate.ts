import { canonicalUrl, fingerprint, normalizeToken } from './normalize'
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

function jobSpecificUrlKey(value: unknown): string | null {
  const url = canonicalUrl(value)
  if (!url) return null
  try {
    const parsed = new URL(url)
    const path = parsed.pathname.replace(/\/apply\/?$/i, '').replace(/\/+$/, '')
    if (!path && !parsed.search) return null
    return `url:${normalizeToken(`${parsed.host}${path}${parsed.search}`)}`
  } catch {
    return null
  }
}

function directApplyLinks(job: NormalizedJob): string[] {
  const options = job.rawMetadata.applyOptions
  if (!Array.isArray(options)) return []
  return options.flatMap((option) => {
    const entry = option as { applyLink?: unknown; isDirect?: unknown }
    return entry?.isDirect === true && typeof entry.applyLink === 'string' ? [entry.applyLink] : []
  })
}

export function deduplicationKeys(job: NormalizedJob): { strong: string[]; crossProvider: string | null } {
  const strong = new Set<string>()
  if (job.providerJobId) strong.add(`id:${job.provider}:${job.providerJobId.toLowerCase()}`)
  const urls = [job.applicationUrl, job.jobUrl, job.sourceUrl, ...directApplyLinks(job)]
  for (const url of urls) {
    const key = jobSpecificUrlKey(url)
    if (key) strong.add(key)
  }
  if (![...strong].some((key) => key.startsWith('url:'))) strong.add(fingerprint(job))
  const company = normalizeToken(job.company)
  const title = normalizeToken(job.title)
  const city = normalizeToken((job.location ?? '').split(',')[0] ?? '')
  return { strong: [...strong], crossProvider: company && title ? `meta:${company}|${title}|${city}` : null }
}

function withSources(job: NormalizedJob, other: NormalizedJob, extra: Record<string, unknown> = {}): NormalizedJob {
  const sources = Array.isArray(job.rawMetadata.sources) ? job.rawMetadata.sources : [job.source]
  return {
    ...job,
    rawMetadata: {
      ...job.rawMetadata,
      ...extra,
      sources: [...new Set([...sources, other.source, other.provider].filter(Boolean))],
    },
  }
}

function mergeDuplicate(existing: NormalizedJob, job: NormalizedJob): NormalizedJob {
  if (quality(job) <= quality(existing)) return withSources(existing, job)
  return withSources(job, existing, { replacedIdentity: existing.identityKey })
}

export function deduplicateJobs(jobs: NormalizedJob[]): NormalizedJob[] {
  const result: NormalizedJob[] = []
  const slotByKey = new Map<string, number>()
  const slotsByCrossProviderKey = new Map<string, number[]>()

  for (const job of jobs) {
    const keys = deduplicationKeys(job)
    let slot = keys.strong.map((key) => slotByKey.get(key)).find((value) => value !== undefined)
    if (slot === undefined && keys.crossProvider) {
      slot = (slotsByCrossProviderKey.get(keys.crossProvider) ?? []).find((candidate) => result[candidate].provider !== job.provider)
    }
    if (slot === undefined) {
      slot = result.push(job) - 1
    } else {
      result[slot] = mergeDuplicate(result[slot], job)
    }
    for (const key of [...keys.strong, ...deduplicationKeys(result[slot]).strong]) slotByKey.set(key, slot)
    if (keys.crossProvider) {
      const slots = slotsByCrossProviderKey.get(keys.crossProvider) ?? []
      if (!slots.includes(slot)) slotsByCrossProviderKey.set(keys.crossProvider, [...slots, slot])
    }
  }

  return result
}
