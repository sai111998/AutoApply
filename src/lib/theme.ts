export const THEME_STORAGE_KEY = 'jobpilot.theme'

export type ThemeMode = 'light' | 'dark'

function getLocalStorage(): Storage | null {
  try {
    const storage = globalThis.localStorage
    return storage ?? null
  } catch {
    return null
  }
}

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark'
}

export function readStoredTheme(storage: Storage | null = getLocalStorage()): ThemeMode {
  const raw = storage?.getItem(THEME_STORAGE_KEY)
  return raw === 'dark' ? 'dark' : 'light'
}

export function applyTheme(
  mode: ThemeMode,
  root: HTMLElement | null = typeof document === 'undefined' ? null : document.documentElement,
) {
  if (!root) return
  root.classList.toggle('dark', mode === 'dark')
  root.dataset.theme = mode
  root.style.colorScheme = mode
}

export function persistTheme(
  mode: ThemeMode,
  storage: Storage | null = getLocalStorage(),
  root?: HTMLElement | null,
) {
  storage?.setItem(THEME_STORAGE_KEY, mode)
  applyTheme(mode, root)
  return mode
}

export function applyStoredTheme() {
  applyTheme(readStoredTheme())
}
