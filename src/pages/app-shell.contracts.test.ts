import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (relative: string) => readFileSync(path.resolve(process.cwd(), relative), 'utf8')

describe('application shell layout', () => {
  const css = read('src/index.css')
  const layout = read('src/components/layout/AppLayout.tsx')

  it('keeps the shell at viewport height without document-length growth', () => {
    const shellBlock = css.slice(css.indexOf('.app-shell {'), css.indexOf('.app-sidebar {'))
    expect(shellBlock).toMatch(/height: 100%;/)
    expect(shellBlock).toMatch(/overflow: hidden;/)
    expect(shellBlock).not.toMatch(/min-height: 100vh/)
    expect(layout).toMatch(/data-testid="app-shell"/)
    expect(layout).not.toMatch(/min-h-screen/)
  })

  it('makes only the main content independently scrollable', () => {
    expect(css).toMatch(/\.app-shell-content \{[\s\S]*overflow-y: auto;/)
    expect(css).toMatch(/\.app-sidebar \{[\s\S]*overflow: hidden;/)
    expect(layout).toMatch(/data-testid="app-main"/)
    expect(layout).toMatch(/className="app-shell-content/)
  })

  it('keeps the sidebar user footer in the non-scrolling sidebar', () => {
    const sidebar = layout.slice(layout.indexOf('data-testid="app-sidebar"'), layout.indexOf('data-testid="app-main"'))
    expect(sidebar).toMatch(/data-testid="sidebar-user-footer"/)
    expect(sidebar).toMatch(/Sign out/)
    expect(sidebar).toMatch(/shrink-0/)
    expect(layout).toMatch(/document\.body\.style\.overflow = 'hidden'/)
  })
})
