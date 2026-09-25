import type { AutoApplyConfig, AutoApplyQueueItem } from '../apply/types'
import { DEFAULT_MAX_JOBS } from '../apply/defaults'

export const DEFAULT_AGENT_INTERVAL_MS = 5 * 60 * 1000
export const MIN_AGENT_INTERVAL_MS = 30_000
export const MAX_JOBS_PER_CAMPAIGN = 25
export const SEARCH_PAGE_LIMIT = 50

export function agentIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.JOBPILOT_AGENT_INTERVAL_MS)
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_AGENT_INTERVAL_MS
  return Math.max(MIN_AGENT_INTERVAL_MS, Math.round(raw))
}

export function campaignMaxJobs(config: Pick<AutoApplyConfig, 'maxJobs'>): number {
  return Math.min(MAX_JOBS_PER_CAMPAIGN, Math.max(1, Math.round(config.maxJobs || DEFAULT_MAX_JOBS)))
}

export function c2cOnly(config: Pick<AutoApplyConfig, 'jobType'>): boolean {
  return config.jobType === 'c2c'
}

export function utcDayKey(iso = new Date().toISOString()): string {
  return iso.slice(0, 10)
}

export function usesDailyApplySlot(
  item: Pick<AutoApplyQueueItem, 'applicationStatus' | 'createdAt' | 'submittedAt'>,
  day = utcDayKey(),
): boolean {
  if (item.applicationStatus === 'skipped' || item.applicationStatus === 'cancelled') return false
  const stamp = item.submittedAt || item.createdAt
  return stamp.slice(0, 10) === day
}

export function dailyApplyCount(
  items: Array<Pick<AutoApplyQueueItem, 'applicationStatus' | 'createdAt' | 'submittedAt'>>,
  day = utcDayKey(),
): number {
  return items.filter((item) => usesDailyApplySlot(item, day)).length
}

export function remainingDailySlots(
  items: Array<Pick<AutoApplyQueueItem, 'applicationStatus' | 'createdAt' | 'submittedAt'>>,
  maxJobs: number,
  day = utcDayKey(),
): number {
  return Math.max(0, campaignMaxJobs({ maxJobs }) - dailyApplyCount(items, day))
}

export function canSearchAgain(lastTickAt: number | null, now = Date.now(), intervalMs = agentIntervalMs()): boolean {
  if (!lastTickAt) return true
  return now - lastTickAt >= intervalMs
}
