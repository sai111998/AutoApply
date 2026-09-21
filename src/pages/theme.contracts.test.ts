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
    expect(css).toMatch(/--accent-text: #3f4a29/)
    expect(css).toMatch(/--accent-text: #d5deb8/)
    expect(css).toMatch(/--text-primary:/)
    expect(css).toMatch(/--surface-elevated:/)
    expect(css).toMatch(/html\.dark \.text-olive/)
    expect(css).toMatch(/html\.dark \.text-olive-dark/)
    expect(css).toMatch(/transition: background-color 200ms ease, color 200ms ease/)
    expect(css).toMatch(/\.card \{[\s\S]*?transition: background-color 200ms ease, border-color 200ms ease/)
    expect(css).not.toMatch(/html\.dark[\s\S]{0,80}transform:/)
  })

  it('keeps the Appearance section compact and stores Light/Dark', () => {
    expect(theme).toMatch(/jobpilot\.theme/)
    expect(theme).toMatch(/'light' \| 'dark'/)
    expect(app).toMatch(/ThemeProvider/)
    expect(settings).toMatch(/Appearance/)
    expect(settings).toMatch(/self-start p-4/)
    expect(settings).not.toMatch(/Appearance[\s\S]{0,200}min-h-/)
    expect(toggle).toMatch(/\bLight\b/)
    expect(toggle).toMatch(/\bDark\b/)
    expect(toggle).toMatch(/aria-label="Color theme"/)
    expect(toggle).toMatch(/transition-colors duration-200/)
    expect(layout).toMatch(/ThemeToggle/)
  })
})
