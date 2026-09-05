import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('resume tailoring page contracts', () => {
  const tailorPage = readFileSync(path.resolve(process.cwd(), 'src/pages/TailorResumePage.tsx'), 'utf8')
  const layout = readFileSync(path.resolve(process.cwd(), 'src/components/layout/AppLayout.tsx'), 'utf8')
  const applicationsPage = readFileSync(path.resolve(process.cwd(), 'src/pages/ApplicationsPage.tsx'), 'utf8')
  const migration = readFileSync(
    path.resolve(process.cwd(), 'supabase/migrations/005_application_selected_resume.sql'),
    'utf8',
  )

  it('does not reload the browser after Keep This Resume', () => {
    expect(tailorPage).not.toMatch(/location\.reload/)
    expect(tailorPage).not.toMatch(/window\.location/)
    expect(tailorPage).toMatch(/onUseVersion/)
    expect(tailorPage).toMatch(/notify\('Resume saved\.'\)/)
  })

  it('places Keep This Resume, Edit, Regenerate, and Download above the resume preview', () => {
    const keep = tailorPage.indexOf('Keep This Resume')
    const edit = tailorPage.indexOf('Edit Resume')
    const regenerate = tailorPage.indexOf('Regenerate')
    const download = tailorPage.indexOf('Download PDF')
    const preview = tailorPage.indexOf('Tailored resume preview')
    expect(keep).toBeGreaterThan(-1)
    expect(edit).toBeGreaterThan(-1)
    expect(regenerate).toBeGreaterThan(-1)
    expect(download).toBeGreaterThan(-1)
    expect(preview).toBeGreaterThan(-1)
    expect(keep).toBeLessThan(preview)
    expect(edit).toBeLessThan(preview)
    expect(regenerate).toBeLessThan(preview)
    expect(download).toBeLessThan(preview)
  })

  it('does not duplicate Keep This Resume after the resume document', () => {
    const preview = tailorPage.indexOf('Tailored resume preview')
    const afterPreview = tailorPage.slice(preview)
    expect(afterPreview).not.toMatch(/Keep This Resume/)
    expect(afterPreview).not.toMatch(/Use This Resume/)
  })

  it('offers Use This Resume for version selection and never restores the Changes list', () => {
    expect(tailorPage).toMatch(/Use This Resume/)
    expect(tailorPage).toMatch(/Resume versions/)
    expect(tailorPage).not.toMatch(/Changes made/)
    expect(tailorPage).toMatch(/scoreChangeMessage/)
    expect(tailorPage).toMatch(/scoreImprovementExplanation/)
  })

  it('shows JobPilot AI alignment metrics without claiming a guaranteed ATS score', () => {
    expect(tailorPage).toMatch(/JobPilot AI Alignment Score/)
    expect(tailorPage).toMatch(/ATS Alignment Estimate/)
    expect(tailorPage).toMatch(/Supported JD Coverage/)
    expect(tailorPage).toMatch(/Required Skills/)
    expect(tailorPage).toMatch(/Preferred Skills/)
    expect(tailorPage).toMatch(/Responsibility Alignment/)
    expect(tailorPage).not.toMatch(/Guaranteed ATS/)
    expect(tailorPage).not.toMatch(/Guaranteed to pass ATS/)
    expect(tailorPage).not.toMatch(/Guaranteed interview/)
  })

  it('uses client-side routing for application tabs', () => {
    expect(layout).toMatch(/NavLink/)
    expect(layout).not.toMatch(/window\.location/)
    expect(layout).not.toMatch(/location\.reload/)
  })

  it('shows the selected resume version and current score on Applications', () => {
    expect(applicationsPage).toMatch(/resolveApplicationResumeDisplay/)
    expect(applicationsPage).toMatch(/>Job</)
    expect(applicationsPage).toMatch(/>Company</)
    expect(applicationsPage).toMatch(/currentResumeLabel/)
    expect(applicationsPage).toMatch(/currentMatchScore/)
  })

  it('adds selected resume and current match columns without duplicating resume tables', () => {
    expect(migration).toMatch(/selected_resume_version_id/)
    expect(migration).toMatch(/current_match_id/)
    expect(migration).toMatch(/current_match_score/)
    expect(migration).toMatch(/references public\.resume_versions/)
    expect(migration).not.toMatch(/create table/i)
  })
})
