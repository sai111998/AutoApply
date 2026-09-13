import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const page = readFileSync(path.resolve(process.cwd(), 'src/pages/JobDiscoveryPage.tsx'), 'utf8')
const analysis = readFileSync(path.resolve(process.cwd(), 'src/pages/JobAnalysisPage.tsx'), 'utf8')
const layout = readFileSync(path.resolve(process.cwd(), 'src/components/layout/AppLayout.tsx'), 'utf8')

describe('job discovery contracts', () => {
  it('searches live providers and labels results as Live, not sample jobs', () => {
    expect(layout).toMatch(/Job Discovery/)
    expect(page).toMatch(/Find Jobs/)
    expect(page).toMatch(/discoverJobsRequest/)
    expect(page).toMatch(/● Live/)
    expect(page).toMatch(/Source: \{providerLabel/)
    expect(page).not.toMatch(/createSampleWorkspace|SAMPLE_RESUME/)
  })

  it('wires View, Analyze, Save, and Tailor without auto-apply', () => {
    expect(page).toMatch(/>\s*View\s*</)
    expect(page).toMatch(/goAnalyze/)
    expect(page).toMatch(/saveDiscoveredJob/)
    expect(page).toMatch(/Tailor Resume/)
    expect(page).not.toMatch(/submit application/i)
  })

  it('pre-fills Job Analysis from a live job', () => {
    expect(analysis).toMatch(/liveJob/)
    expect(analysis).toMatch(/jobId: liveJobId/)
    expect(analysis).toMatch(/title: fieldsRef.current.title/)
    expect(analysis).toMatch(/Job title/)
    expect(analysis).toMatch(/provider: liveMeta\?\.provider/)
  })
})
