import { Compass } from 'lucide-react'

export function BrandMark({ light = false, compact = false }: { light?: boolean; compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={`grid h-10 w-10 place-items-center rounded-xl ${
          light ? 'bg-white/10 text-moss' : 'bg-navy text-moss'
        }`}
      >
        <Compass size={20} strokeWidth={2.2} />
      </div>
      {!compact && (
        <div className="leading-tight">
          <p className={`font-display text-[1.35rem] ${light ? 'text-white' : 'text-navy'}`}>JobPilot</p>
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-moss">AI</p>
        </div>
      )}
    </div>
  )
}
