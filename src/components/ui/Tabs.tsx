export function Tabs({
  value,
  onChange,
  items,
}: {
  value: string
  onChange: (value: string) => void
  items: { id: string; label: string; count?: number }[]
}) {
  return (
    <div className="inline-flex rounded-xl border border-line bg-white p-1">
      {items.map((item) => {
        const active = item.id === value
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(item.id)}
            className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition duration-150 ${
              active ? 'bg-olive text-white shadow-sm' : 'text-muted hover:bg-olive-soft hover:text-olive-dark'
            }`}
          >
            {item.label}
            {item.count != null && (
              <span className={`ml-2 text-xs ${active ? 'text-white/80' : 'text-muted'}`}>{item.count}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
