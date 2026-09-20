import { readFileSync } from 'node:fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

const read = (relative: string) => readFileSync(path.resolve(process.cwd(), relative), 'utf8')

describe('dark mode contracts', () => {
  const css = read('src/index.css')
  const settings = read('src/pages/SettingsPage.tsx')
  const toggle = read('src/components/ThemeToggle.tsx')
  const layout = read('src/components/layout/AppLayout.tsx')
  const app = read('src/App.tsx')
  const theme = read('src/lib/theme.ts')

  it('defines light defaults and dark token overrides', () => {
    expect(css).toMatch(/--color-canvas: #f6f5f1/)
    expect(css).toMatch(/html\.dark/)
    expect(css).toMatch(/color-scheme: dark/)
  })

  it('persists Light/Dark with the existing client storage key', () => {
    expect(theme).toMatch(/jobpilot\.theme/)
    expect(theme).toMatch(/'light' \| 'dark'/)
    expect(app).toMatch(/ThemeProvider/)
    expect(settings).toMatch(/Appearance/)
    expect(toggle).toMatch(/\bLight\b/)
    expect(toggle).toMatch(/\bDark\b/)
    expect(toggle).toMatch(/aria-label="Color theme"/)
    expect(layout).toMatch(/ThemeToggle/)
  })
})
