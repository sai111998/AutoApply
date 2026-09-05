import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const page = readFileSync(path.resolve(process.cwd(), 'src/pages/JobAnalysisPage.tsx'), 'utf8')
const workspace = readFileSync(path.resolve(process.cwd(), 'src/context/WorkspaceContext.tsx'), 'utf8')

describe('job analysis history contracts', () => {
  it('updates workspace state immediately after a successful delete', () => {
    const deleteFn = workspace.slice(
      workspace.indexOf('const deleteAnalysis = useCallback'),
      workspace.indexOf('const updateApplication = useCallback'),
    )
    expect(deleteFn).toMatch(/removeAnalysisFromSnapshot\(state, matchId\)/)
    expect(deleteFn).toMatch(/deleteAnalysisRecords/)
    expect(deleteFn).toMatch(/Could not delete analysis\. Please try again/)
    expect(deleteFn).not.toMatch(/location\.reload/)
    expect(deleteFn.indexOf('deleteAnalysisRecords')).toBeLessThan(deleteFn.indexOf('removeAnalysisFromSnapshot'))
  })

  it('refreshes history without merging deleted complete analyses back in', () => {
    expect(workspace).toMatch(/mergeFetchedMatches\(history\.matches, current\.matches\)/)
    expect(workspace).not.toMatch(/history\.matches\.reduce\(\(items, match\) => upsertById\(items, match\), current\.matches\)/)
  })

  it('confirms deletion and toasts success without a page refresh', () => {
    expect(page).toMatch(/ConfirmDialog/)
    expect(page).toMatch(/notify\('Analysis deleted'\)/)
    expect(page).toMatch(/Could not delete analysis\. Please try again/)
    expect(page).not.toMatch(/window\.location|location\.reload|window\.confirm|alert\(/)
  })

  it('keeps search working without an absolutely positioned circle/dot', () => {
    expect(page).toMatch(/data-testid="history-search"/)
    expect(page).toMatch(/aria-label="Search history"/)
    expect(page).toMatch(/filterAnalysisHistory\(rows, query\)/)
    expect(page).not.toMatch(/absolute top-3 left-3/)
    expect(page).not.toMatch(/notification|status-dot|empty badge/i)
    const searchBlock = page.slice(page.indexOf('data-testid="history-search"'), page.indexOf('data-testid="history-search"') + 500)
    expect(searchBlock).not.toMatch(/rounded-full/)
    expect(searchBlock).not.toMatch(/::before|::after/)
  })
})
