import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { persistTheme, readStoredTheme, type ThemeMode } from '@/lib/theme'

interface ThemeContextValue {
  theme: ThemeMode
  setTheme: (mode: ThemeMode) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(() => readStoredTheme())

  const setTheme = useCallback((mode: ThemeMode) => {
    persistTheme(mode)
    setThemeState(mode)
  }, [])

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used within ThemeProvider')
  return context
}
