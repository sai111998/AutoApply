import { Moon, Sun } from 'lucide-react'
import { useTheme } from '@/context/ThemeContext'

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme } = useTheme()
  if (compact) {
    return (
      <button
        type="button"
        className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm font-semibold text-charcoal"
        aria-label="Color theme"
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      >
        {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        {theme === 'dark' ? 'Light' : 'Dark'}
      </button>
    )
  }
  return (
    <div className="inline-flex rounded-xl border border-line bg-surface p-1" role="group" aria-label="Color theme">
      <button
        type="button"
        className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${theme === 'light' ? 'bg-olive text-white' : 'text-muted'}`}
        onClick={() => setTheme('light')}
      >
        Light
      </button>
      <button
        type="button"
        className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${theme === 'dark' ? 'bg-olive text-white' : 'text-muted'}`}
        onClick={() => setTheme('dark')}
      >
        Dark
      </button>
    </div>
  )
}
