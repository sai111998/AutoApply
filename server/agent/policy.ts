import type { AutoApplyConfig } from '../apply/types'

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
  return Math.min(MAX_JOBS_PER_CAMPAIGN, Math.max(1, Math.round(config.maxJobs || 10)))
}

export function c2cOnly(config: Pick<AutoApplyConfig, 'jobType'>): boolean {
  return config.jobType === 'c2c'
}

export function canSearchAgain(lastTickAt: number | null, now = Date.now(), intervalMs = agentIntervalMs()): boolean {
  if (!lastTickAt) return true
  return now - lastTickAt >= intervalMs
}
