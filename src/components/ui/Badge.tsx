import type { ReactNode } from 'react'
import type { ApplicationStatus, Recommendation } from '@/types/domain'
import { APPLICATION_STATUS_LABELS } from '@/types/domain'

export function Pill({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: 'neutral' | 'strong' | 'review' | 'skip' | 'pending' | 'info'
}) {
  const tones: Record<typeof tone, string> = {
    neutral: 'bg-fog text-charcoal',
    strong: 'bg-olive-soft text-olive-dark',
    review: 'bg-[#f7f1e3] text-warning',
    skip: 'bg-[#f7ece8] text-danger',
    pending: 'bg-[#e8eef1] text-info',
    info: 'bg-[#e8eef1] text-info',
  }
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${tones[tone]}`}>
      {children}
    </span>
  )
}

export function StatusBadge({ status }: { status: ApplicationStatus }) {
  const tone =
    status === 'interview' || status === 'offer'
      ? 'strong'
      : status === 'applied' || status === 'ready'
        ? 'info'
        : status === 'rejected'
          ? 'skip'
          : 'neutral'
  return <Pill tone={tone}>{APPLICATION_STATUS_LABELS[status]}</Pill>
}

export function RecommendationBadge({ value }: { value: Recommendation | null }) {
  if (!value) return <Pill tone="pending">Awaiting analysis</Pill>
  const tone = value === 'APPLY' ? 'strong' : value === 'REVIEW' ? 'review' : 'skip'
  return <Pill tone={tone}>{value}</Pill>
}

export function ScoreBadge({ score }: { score: number | null }) {
  if (score == null) return <Pill tone="pending">Queued</Pill>
  const tone = score >= 80 ? 'strong' : score >= 60 ? 'review' : 'skip'
  return <Pill tone={tone}>{score}</Pill>
}
