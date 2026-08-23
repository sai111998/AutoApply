import type { ApplicationStatus, Recommendation } from '@/types/domain'

export function formatDate(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date)
}

export function formatSalary(min: number, max: number): string {
  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(n)
  return `${fmt(min)} – ${fmt(max)}`
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function scoreTone(score: number | null): 'strong' | 'review' | 'skip' | 'pending' {
  if (score == null) return 'pending'
  if (score >= 80) return 'strong'
  if (score >= 60) return 'review'
  return 'skip'
}

export function recommendationFromScore(score: number): Recommendation {
  if (score >= 80) return 'APPLY'
  if (score >= 60) return 'REVIEW'
  return 'SKIP'
}

export function nextActionForStatus(status: ApplicationStatus): string {
  switch (status) {
    case 'ready':
      return 'Tailor resume and submit'
    case 'applied':
      return 'Follow up in 5 days'
    case 'interview':
      return 'Prepare interview notes'
    case 'offer':
      return 'Review compensation'
    case 'rejected':
      return 'Archive and note takeaways'
    case 'withdrawn':
      return 'No action'
  }
}

export function createId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function titleFromJobDescription(description: string): string {
  const line = description.split('\n').map((part) => part.trim()).find(Boolean)
  if (!line) return 'Untitled role'
  return line.length > 120 ? `${line.slice(0, 117)}...` : line
}
