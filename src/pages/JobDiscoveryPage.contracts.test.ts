import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const page = readFileSync(path.resolve(process.cwd(), 'src/pages/JobDiscoveryPage.tsx'), 'utf8')
const analysis = readFileSync(path.resolve(process.cwd(), 'src/pages/JobAnalysisPage.tsx'), 'utf8')
const layout = readFileSync(path.resolve(process.cwd(), 'src/components/layout/AppLayout.tsx'), 'utf8')
const client = readFileSync(path.resolve(process.cwd(), 'src/lib/ai/client.ts'), 'utf8')

describe('live jobs contracts', () => {
  it('searches through the backend catalog and labels results as Live', () => {
    expect(layout).toMatch(/Live Jobs/)
    expect(page).toMatch(/listLiveJobsRequest/)
    expect(page).toMatch(/Search live jobs/)
    expect(page).toMatch(/● Live/)
    expect(page).toMatch(/Job Opportunities API/)
    expect(page).toMatch(/Apply\/View Job/)
    expect(page).toMatch(/getLiveJobRequest/)
    expect(page).toMatch(/Job data provided by/)
    expect(page).not.toMatch(/Live Demo Provider/)
    expect(page).toMatch(/Source: \{providerLabel/)
    expect(page).not.toMatch(/createSampleWorkspace|SAMPLE_RESUME/)
    expect(page).not.toMatch(/api\.jobopportunitiesapi\.org/)
    expect(client).toMatch(/fetch\(apiUrl\(`\/api\/jobs\?/)
  })

  it('wires Analyze Job, Save Job, and Apply/View Job without auto-apply', () => {
    expect(page).toMatch(/Analyze Job/)
    expect(page).toMatch(/Save Job/)
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
