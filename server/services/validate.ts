export function requireNonEmptyText(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${field} is required`)
  }
  const text = value.trim()
  if (!text) {
    throw new Error(`${field} must not be empty`)
  }
  return text
}

export function optionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  return text || undefined
}

export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
}

export function asBoolean(value: unknown, field: string): boolean {
  if (typeof value === 'boolean') return value
  throw new Error(`${field} must be a boolean`)
}

export function asScore(value: unknown): number {
  const score = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(score)) {
    throw new Error('matchScore must be a number')
  }
  return Math.max(0, Math.min(100, Math.round(score)))
}

export function asRecommendation(value: unknown): 'APPLY' | 'REVIEW' | 'SKIP' {
  if (value === 'APPLY' || value === 'REVIEW' || value === 'SKIP') return value
  throw new Error('recommendation must be APPLY, REVIEW, or SKIP')
}

export function asSummary(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim()
}
