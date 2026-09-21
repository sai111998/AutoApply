export function normalizeMinimumMatchRate(value: number): number {
  if (!Number.isFinite(value)) return 85
  let percent = value
  if (percent > 0 && percent < 1) percent *= 100
  const rounded = Math.round(percent)
  return Math.min(99, Math.max(50, rounded))
}
