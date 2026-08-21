import { scoreTone } from '@/lib/format'

export function ScoreRing({ score, size = 132 }: { score: number | null; size?: number }) {
  const stroke = 10
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const progress = score == null ? 0 : Math.max(0, Math.min(100, score)) / 100
  const tone = scoreTone(score)
  const color =
    tone === 'strong' ? '#1c6b4a' : tone === 'review' ? '#c4a056' : tone === 'skip' ? '#c45c3e' : '#3a7ca5'

  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#e8e1d4"
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
        />
      </svg>
      <div className="absolute text-center">
        <p className="font-display text-4xl leading-none text-navy">{score ?? '—'}</p>
        <p className="mt-1 text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-slate-ink">
          {score == null ? 'Queued' : 'Match'}
        </p>
      </div>
    </div>
  )
}
