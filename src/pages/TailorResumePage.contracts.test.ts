import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('resume tailoring page contracts', () => {
  const tailorPage = readFileSync(path.resolve(process.cwd(), 'src/pages/TailorResumePage.tsx'), 'utf8')
  const layout = readFileSync(path.resolve(process.cwd(), 'src/components/layout/AppLayout.tsx'), 'utf8')

  it('does not reload the browser after Keep This Resume', () => {
    expect(tailorPage).not.toMatch(/location\.reload/)
    expect(tailorPage).not.toMatch(/window\.location/)
    expect(tailorPage).toMatch(/onKeep\(\)/)
    expect(tailorPage).toMatch(/notify\('Resume saved\.'\)/)
  })

  it('uses client-side routing for application tabs', () => {
    expect(layout).toMatch(/NavLink/)
    expect(layout).not.toMatch(/window\.location/)
    expect(layout).not.toMatch(/location\.reload/)
  })
})
