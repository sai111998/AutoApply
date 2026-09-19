import { Compass } from 'lucide-react'

export function BrandMark({ light = false, compact = false }: { light?: boolean; compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={`grid h-10 w-10 place-items-center rounded-xl ${
          light ? 'bg-white/12 text-olive-soft' : 'bg-olive text-white'
        }`}
      >
        <Compass size={20} strokeWidth={2.2} />
      </div>
      {!compact && (
        <div className="leading-tight">
          <p className={`text-[1.15rem] font-semibold tracking-tight ${light ? 'text-white' : 'text-charcoal'}`}>
            JobPilot
          </p>
          <p className={`text-[0.68rem] font-semibold uppercase tracking-[0.18em] ${light ? 'text-olive-soft' : 'text-olive'}`}>
            AI
          </p>
        </div>
      )}
    </div>
  )
}
