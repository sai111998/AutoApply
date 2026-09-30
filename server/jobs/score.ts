import { createHash } from 'node:crypto'
import { extractJobLocal, extractResumeLocal } from '../match/extract-local'
import { scoreMatch } from '../match/engine'
import type { NormalizedJob } from './types'

export interface LiveJobMatch {
  score: number | null
  matchedSkills: string[]
  missingSkills: string[]
  resumeVersionId: string | null
  scoreUpdatedAt: string | null
  cached: boolean
}

interface CachedLiveJobMatch extends Omit<LiveJobMatch, 'cached'> {
  resumeHash: string
}

const cache = new Map<string, CachedLiveJobMatch>()
let hits = 0
let misses = 0

export function jobContentHash(job: Pick<NormalizedJob, 'title' | 'company' | 'description'>): string {
  return normalizedJobHash(job)
}

export function normalizedJobHash(job: Pick<NormalizedJob, 'title' | 'company' | 'description'>): string {
  const title = job.title.trim().toLowerCase()
  const company = job.company.trim().toLowerCase()
  const description = (job.description ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
  return createHash('sha256').update(`${title}\n${company}\n${description}`).digest('hex')
}

export function resumeContentHash(resumeText: string): string {
  return createHash('sha256').update(resumeText.trim()).digest('hex')
}

export function liveScoreCacheKey(jobId: string, resumeVersionId: string, jobHash: string): string {
  return `${jobId}|${resumeVersionId}|${jobHash}`
}

export function resumeIdentity(resumeText: string, resumeVersionId?: string | null): string {
  if (resumeVersionId?.trim()) return resumeVersionId.trim()
  return resumeContentHash(resumeText)
}

export function emptyLiveMatch(resumeVersionId: string | null = null): LiveJobMatch {
  return {
    score: null,
    matchedSkills: [],
    missingSkills: [],
    resumeVersionId,
    scoreUpdatedAt: null,
    cached: false,
  }
}

export function scoreJobAgainstResume(
  job: NormalizedJob,
  resumeText: string,
  resumeVersionId?: string | null,
): LiveJobMatch {
  const versionId = resumeIdentity(resumeText, resumeVersionId)
  const description = job.description?.trim() ?? ''
  if (!resumeText.trim() || !description) return emptyLiveMatch(resumeVersionId ?? null)

  const resumeHash = resumeContentHash(resumeText)
  const key = liveScoreCacheKey(job.providerJobId || job.id, versionId, normalizedJobHash(job))
  const hit = cache.get(key)
  if (hit && hit.resumeHash === resumeHash) {
    hits += 1
    const { resumeHash: _resumeHash, ...value } = hit
    return { ...value, cached: true }
  }

  misses += 1
  const report = scoreMatch(extractResumeLocal(resumeText), extractJobLocal(description), resumeText)
  const result: CachedLiveJobMatch = {
    score: report.matchScore,
    matchedSkills: [
      ...report.requiredSkills.matched.map((item) => item.name),
      ...report.preferredSkills.matched.map((item) => item.name),
    ]
      .filter((name, index, all) => all.findIndex((item) => item.toLowerCase() === name.toLowerCase()) === index)
      .slice(0, 6),
    missingSkills: [
      ...report.requiredSkills.missing.map((item) => item.name),
      ...report.preferredSkills.missing.map((item) => item.name),
    ]
      .filter((name, index, all) => all.findIndex((item) => item.toLowerCase() === name.toLowerCase()) === index)
      .slice(0, 6),
    resumeVersionId: resumeVersionId?.trim() || null,
    scoreUpdatedAt: new Date().toISOString(),
    resumeHash,
  }
  if (cache.size >= 500) {
    const oldest = cache.keys().next().value
    if (oldest) cache.delete(oldest)
  }
  cache.set(key, result)
  const { resumeHash: _resumeHash, ...value } = result
  return { ...value, cached: false }
}

export function liveScoreCacheStats() {
  return { size: cache.size, hits, misses }
}

export function clearLiveScoreCache() {
  cache.clear()
  hits = 0
  misses = 0
}
