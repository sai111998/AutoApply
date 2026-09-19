import type { DiscoveredJobResult, LiveJobMatchResult } from '@/lib/ai/client'
import { applyUrl } from '@/lib/discovered-job'

export type LiveJobSort = 'match' | 'recent' | 'relevance'

export function emptyLiveMatch(resumeVersionId: string | null = null): LiveJobMatchResult {
  return {
    score: null,
    matchedSkills: [],
    missingSkills: [],
    resumeVersionId,
    scoreUpdatedAt: null,
    cached: false,
  }
}

export function liveMatch(job: DiscoveredJobResult): LiveJobMatchResult {
  if (job.match) {
    return {
      score: job.match.score ?? job.matchScore ?? null,
      matchedSkills: job.match.matchedSkills ?? job.matchedSkills ?? [],
      missingSkills: job.match.missingSkills ?? job.missingSkills ?? [],
      resumeVersionId: job.match.resumeVersionId ?? null,
      scoreUpdatedAt: job.match.scoreUpdatedAt ?? null,
      cached: job.match.cached,
    }
  }
  return {
    score: job.matchScore ?? null,
    matchedSkills: job.matchedSkills ?? [],
    missingSkills: job.missingSkills ?? [],
    resumeVersionId: null,
    scoreUpdatedAt: null,
    cached: false,
  }
}

export function workArrangementLabel(job: Pick<DiscoveredJobResult, 'workArrangement' | 'remote'>): string | null {
  const raw = job.workArrangement?.trim().toLowerCase().replace(/[_-]/g, ' ')
  if (raw === 'remote') return 'Remote'
  if (raw === 'hybrid') return 'Hybrid'
  if (raw === 'onsite' || raw === 'on site') return 'On-site'
  if (raw === 'flexible') return 'Flexible'
  if (job.remote === true) return 'Remote'
  if (job.remote === false) return 'On-site'
  return null
}

export function employmentLabel(value: string | null | undefined): string | null {
  if (!value?.trim()) return null
  const key = value.trim().toLowerCase().replace(/[_\s]+/g, '-')
  const labels: Record<string, string> = {
    'full-time': 'Full-time',
    'part-time': 'Part-time',
    contract: 'Contract',
    temporary: 'Temporary',
    internship: 'Internship',
  }
  if (labels[key]) return labels[key]
  return value.trim()
}

export function jobMetaLine(job: DiscoveredJobResult): string {
  return [job.location, workArrangementLabel(job), employmentLabel(job.employmentType)].filter(Boolean).join(' • ')
}

export function topSkills(skills: string[] | undefined, limit = 3): string[] {
  return (skills ?? []).map((item) => item.trim()).filter(Boolean).slice(0, limit)
}

export function sortDiscoveredJobs(
  jobs: DiscoveredJobResult[],
  sort: LiveJobSort = 'match',
  query = '',
): DiscoveredJobResult[] {
  const copy = [...jobs]
  const score = (job: DiscoveredJobResult) => liveMatch(job).score ?? -1
  if (sort === 'recent') {
    copy.sort((left, right) =>
      (right.postedAt ?? right.fetchedAt ?? right.discoveredAt ?? '').localeCompare(
        left.postedAt ?? left.fetchedAt ?? left.discoveredAt ?? '',
      ),
    )
    return copy
  }
  if (sort === 'relevance') {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
    copy.sort((left, right) => relevanceRank(right, tokens, query) - relevanceRank(left, tokens, query))
    return copy
  }
  copy.sort((left, right) => score(right) - score(left))
  return copy
}

function relevanceRank(job: DiscoveredJobResult, tokens: string[], query: string): number {
  if (!query.trim()) return liveMatch(job).score ?? 0
  const haystack = `${job.title} ${job.company} ${job.location ?? ''}`.toLowerCase()
  const hits = tokens.filter((token) => haystack.includes(token)).length
  return hits * 1000 + (liveMatch(job).score ?? 0)
}

export function employerApplyHref(job: Pick<DiscoveredJobResult, 'jobUrl' | 'url'>): string | null {
  return applyUrl(job)
}

export function c2cStatusLabel(status?: string | null): string {
  if (status === 'confirmed') return 'Confirmed'
  if (status === 'not_allowed') return 'Not allowed'
  return 'Unknown'
}

export function autoApplyStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    queued: 'Queued',
    preparing: 'Preparing',
    tailoring: 'Tailoring',
    ready: 'Ready',
    opening: 'Opening',
    filling: 'Filling',
    needs_user_input: 'Needs input',
    captcha_required: 'CAPTCHA required',
    mfa_required: 'MFA required',
    login_required: 'Login required',
    blocked: 'Blocked',
    automation_blocked: 'Blocked',
    ready_for_submission: 'Ready',
    submitting: 'Submitting',
    needs_user_confirmation: 'Needs confirmation',
    submitted: 'Submitted',
    failed: 'Preparation Failed',
    skipped: 'Skipped',
    cancelled: 'Cancelled',
  }
  return labels[status] ?? status
}
