import { createHash } from 'node:crypto'
import type { NormalizedJob } from './types'

const GENERIC_HOSTS = new Set(['www.google.com', 'google.com', 'www.bing.com', 'bing.com'])

export function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  return text || null
}

export function cleanMultilineText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
  return text || null
}

export function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return null
  const parsed = Number(value.replace(/[^0-9.-]/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

export function asIsoDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function canonicalUrl(value: unknown): string | null {
  const raw = cleanText(value)
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (GENERIC_HOSTS.has(url.hostname.toLowerCase())) return null
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|ref|source|sid)/i.test(key)) url.searchParams.delete(key)
    }
    return url.toString()
  } catch {
    return raw
  }
}

export function normalizeToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

export function parseSalary(value: unknown): { min: number | null; max: number | null; currency: string | null } {
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return {
      min: asNumber(record.min ?? record.MinimumRange ?? record.salaryMin),
      max: asNumber(record.max ?? record.MaximumRange ?? record.salaryMax),
      currency: cleanText(record.currency ?? record.Currency ?? record.salaryCurrency),
    }
  }
  const text = cleanText(value)
  if (!text) return { min: null, max: null, currency: null }
  const currency = text.match(/\b([A-Z]{3})\b/)?.[1] ?? (text.includes('$') ? 'USD' : null)
  const amounts = [...text.matchAll(/(\d[\d,]*(?:\.\d+)?)/g)]
    .map((item) => Number(item[1].replace(/,/g, '')))
    .filter((item) => Number.isFinite(item) && item > 0)
  if (!amounts.length) return { min: null, max: null, currency }
  return {
    min: amounts[0] ?? null,
    max: amounts.length > 1 ? amounts[amounts.length - 1] : amounts[0] ?? null,
    currency,
  }
}

export function inferRemote(location: string | null, workArrangement: string | null, extras: string[] = []): boolean | null {
  const blob = [location, workArrangement, ...extras].filter(Boolean).join(' ')
  if (!blob) return null
  if (/\bremote\b|\btelework\b|\bwork from home\b/i.test(blob)) return true
  if (/\bonsite\b|\bon-site\b|\bin office\b/i.test(blob)) return false
  return null
}

export function inferWorkArrangement(
  remote: boolean | null,
  location: string | null,
  extras: string[] = [],
): string | null {
  const blob = [location, ...extras].filter(Boolean).join(' ')
  if (/\bhybrid\b/i.test(blob)) return 'hybrid'
  if (remote === true) return 'remote'
  if (remote === false || /\bonsite\b|\bon-site\b/i.test(blob)) return 'onsite'
  return null
}

export function identityKey(input: {
  provider: string
  providerJobId: string | null
  company: string
  title: string
  location: string | null
  jobUrl: string | null
}): string {
  if (input.providerJobId?.trim()) {
    return `${normalizeToken(input.provider)}:${normalizeToken(input.providerJobId)}`
  }
  const url = canonicalUrl(input.jobUrl)
  if (url) return `url:${normalizeToken(url)}`
  return `meta:${normalizeToken(input.company)}|${normalizeToken(input.title)}|${normalizeToken(input.location ?? '')}`
}

export function fingerprint(job: Pick<NormalizedJob, 'company' | 'title' | 'location' | 'jobUrl'>): string {
  const url = canonicalUrl(job.jobUrl)
  if (url) return `url:${normalizeToken(url)}`
  return `meta:${normalizeToken(job.company)}|${normalizeToken(job.title)}|${normalizeToken(job.location ?? '')}`
}

export function stableJobId(identity: string, userId?: string): string {
  const digest = createHash('sha1').update(`${userId ?? 'catalog'}|${identity}`).digest()
  const bytes = Buffer.from(digest.subarray(0, 16))
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function emptyNormalizedJob(partial: Partial<NormalizedJob> & Pick<NormalizedJob, 'provider' | 'title'>): NormalizedJob {
  const now = new Date().toISOString()
  const company = cleanText(partial.company) ?? ''
  const title = cleanText(partial.title) ?? 'Untitled role'
  const location = cleanText(partial.location)
  const jobUrl = canonicalUrl(partial.jobUrl)
  const providerJobId = cleanText(partial.providerJobId)
  const identity = identityKey({
    provider: partial.provider,
    providerJobId,
    company,
    title,
    location,
    jobUrl,
  })
  return {
    id: partial.id ?? stableJobId(identity),
    provider: partial.provider,
    providerJobId,
    title,
    company,
    location,
    remote: partial.remote ?? null,
    workArrangement: partial.workArrangement ?? null,
    employmentType: cleanText(partial.employmentType),
    seniority: cleanText(partial.seniority),
    description: cleanMultilineText(partial.description),
    jobUrl,
    postedAt: partial.postedAt ?? null,
    salaryMin: partial.salaryMin ?? null,
    salaryMax: partial.salaryMax ?? null,
    salaryCurrency: cleanText(partial.salaryCurrency),
    source: cleanText(partial.source) ?? partial.provider,
    discoveredAt: partial.discoveredAt ?? now,
    lastVerifiedAt: partial.lastVerifiedAt ?? now,
    identityKey: identity,
    rawMetadata: partial.rawMetadata ?? {},
    liveDemoProvider: partial.liveDemoProvider ?? false,
  }
}
