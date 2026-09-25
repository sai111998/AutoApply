import { DEFAULT_MINIMUM_MATCH_RATE } from './defaults'

export function normalizeMinimumMatchRate(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MINIMUM_MATCH_RATE
  let percent = value
  if (percent > 0 && percent < 1) percent *= 100
  const rounded = Math.round(percent)
  return Math.min(99, Math.max(50, rounded))
}
