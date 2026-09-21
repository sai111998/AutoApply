import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { applyTheme, persistTheme, readStoredTheme, THEME_STORAGE_KEY, type ThemeMode } from './theme'

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = { ...initial }
  return {
    get length() {
      return Object.keys(data).length
    },
    clear() {
      for (const key of Object.keys(data)) delete data[key]
    },
    getItem(key: string) {
      return key in data ? data[key] : null
    },
    key(index: number) {
      return Object.keys(data)[index] ?? null
    },
    removeItem(key: string) {
      delete data[key]
    },
    setItem(key: string, value: string) {
      data[key] = value
    },
  }
}

function fakeRoot() {
  const classes = new Set<string>()
  return {
    classList: {
      toggle(name: string, force?: boolean) {
        if (force === true) classes.add(name)
        else if (force === false) classes.delete(name)
        else if (classes.has(name)) classes.delete(name)
        else classes.add(name)
      },
      contains: (name: string) => classes.has(name),
    },
    dataset: {} as DOMStringMap,
    style: { colorScheme: '' },
  } as HTMLElement
}

describe('theme persistence', () => {
  it('defaults to light when nothing is stored', () => {
    expect(readStoredTheme(memoryStorage())).toBe('light')
  })

  it('reads a stored dark preference', () => {
    expect(readStoredTheme(memoryStorage({ [THEME_STORAGE_KEY]: 'dark' }))).toBe('dark')
  })

  it('applies dark mode to the document root', () => {
    const root = fakeRoot()
    applyTheme('dark', root)
    expect(root.classList.contains('dark')).toBe(true)
    expect(root.dataset.theme).toBe('dark')
    expect(root.style.colorScheme).toBe('dark')
  })

  it('persists the preference and restores it after refresh', () => {
    const storage = memoryStorage()
    const root = fakeRoot()
    persistTheme('dark', storage, root)
    expect(storage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    applyTheme('light', root)
    expect(root.classList.contains('dark')).toBe(false)
    applyTheme(readStoredTheme(storage), root)
    expect(root.classList.contains('dark')).toBe(true)
    expect(readStoredTheme(storage)).toBe('dark' as ThemeMode)
  })

  it('does not animate layout when the theme changes', () => {
    const css = readFileSync(path.resolve(process.cwd(), 'src/index.css'), 'utf8')
    expect(css).toMatch(/\nbody \{\n  margin: 0;[\s\S]*?transition: background-color 200ms ease, color 200ms ease;\n\}/)
    expect(css).toMatch(/\.card \{[\s\S]*?transition: background-color 200ms ease, border-color 200ms ease/)
  })
})
