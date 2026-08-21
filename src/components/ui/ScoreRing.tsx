import { scoreTone } from '@/lib/format'

export function ScoreRing({ score, size = 132 }: { score: number | null; size?: number }) {
  const stroke = 10
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const progress = score == null ? 0 : Math.max(0, Math.min(100, score)) / 100
  const tone = scoreTone(score)
  const color =
    tone === 'strong' ? '#556338' : tone === 'review' ? '#a4843c' : tone === 'skip' ? '#9a4f3e' : '#4d6a78'

  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#e2dfd6"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - progress)}
          style={{ transition: 'stroke-dashoffset 0.6s ease' }}
        />
      </svg>
      <div className="absolute text-center">
        <p className="text-4xl font-semibold leading-none tracking-tight text-charcoal">{score ?? '—'}</p>
        <p className="mt-1 text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-muted">
          {score == null ? 'Queued' : 'Match'}
        </p>
      </div>
    </div>
  )
}
