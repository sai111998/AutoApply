import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (relative: string) => readFileSync(path.resolve(process.cwd(), relative), 'utf8')

describe('resume version card contracts', () => {
  const resumePage = read('src/pages/ResumePage.tsx')
  const actions = read('src/components/resume/ResumeVersionActions.tsx')
  const iconButton = read('src/components/ui/IconButton.tsx')

  it('uses compact version names and keeps job/company as metadata', () => {
    expect(resumePage).toMatch(/compactVersionName/)
    expect(resumePage).toMatch(/\$\{job\.title\} • \$\{job\.company\}/)
    expect(resumePage).toMatch(/ScoreBadge/)
    expect(resumePage).toMatch(/versionTypeLabel/)
    expect(resumePage).toMatch(/ResumeVersionActions/)
  })

  it('keeps desktop resume actions on one non-wrapping row', () => {
    expect(actions).toMatch(/data-testid="resume-actions-desktop"/)
    expect(actions).toMatch(/flex-nowrap/)
    expect(actions).toMatch(/whitespace-nowrap/)
    expect(actions).toMatch(/hidden[^\n]+sm:flex/)
    expect(actions).toMatch(/label="View"/)
    expect(actions).toMatch(/label="Rename"/)
    expect(actions).toMatch(/label="Download"/)
    expect(actions).toMatch(/label="Delete"/)
    expect(actions).toMatch(/<Eye /)
    expect(actions).toMatch(/<Pencil /)
    expect(actions).toMatch(/<Download /)
    expect(actions).toMatch(/<Trash2 /)
  })

  it('moves resume actions into an overflow menu on mobile', () => {
    expect(actions).toMatch(/data-testid="resume-actions-mobile"/)
    expect(actions).toMatch(/sm:hidden/)
    expect(actions).toMatch(/MoreHorizontal/)
    expect(actions).toMatch(/aria-haspopup="menu"/)
  })

  it('gives icon-only buttons accessible names and tooltips', () => {
    expect(iconButton).toMatch(/aria-label=\{label\}/)
    expect(iconButton).toMatch(/title=\{label\}/)
    expect(iconButton).toMatch(/h-9 w-9 shrink-0/)
  })

  it('does not use browser alert for resume deletion', () => {
    expect(resumePage).toMatch(/ConfirmDialog/)
    expect(resumePage).not.toMatch(/window\.alert|window\.confirm|alert\(/)
  })
})

describe('application bulk delete contracts', () => {
  const applicationsPage = read('src/pages/ApplicationsPage.tsx')
  const workspace = read('src/context/WorkspaceContext.tsx')
  const persist = read('src/lib/analysis-persist.ts')
  const schema = read('supabase/migrations/001_initial_schema.sql')
  const confirm = read('src/components/ui/ConfirmDialog.tsx')

  it('selects visible applications with a master checkbox and per-row checkboxes', () => {
    expect(applicationsPage).toMatch(/aria-label="Select all"/)
    expect(applicationsPage).toMatch(/indeterminate = selectState === 'some'/)
    expect(applicationsPage).toMatch(/applySelectAll\(visibleIds/)
    expect(applicationsPage).toMatch(/toggleId\(visibleSelected/)
    expect(applicationsPage).toMatch(/pruneSelection\(current/)
  })

  it('shows a bulk action bar only when applications are selected', () => {
    expect(applicationsPage).toMatch(/visibleSelected\.length > 0/)
    expect(applicationsPage).toMatch(/data-testid="bulk-action-bar"/)
    expect(applicationsPage).toMatch(/Delete Selected/)
    expect(applicationsPage).toMatch(/selected/)
  })

  it('confirms bulk and single deletes without claiming resumes or jobs are removed', () => {
    expect(applicationsPage).toMatch(/ConfirmDialog/)
    expect(applicationsPage).toMatch(/bulkDeleteTitle/)
    expect(applicationsPage).toMatch(/bulkDeleteBody/)
    expect(applicationsPage).toMatch(/setPendingIds\(\[application\.id\]\)/)
    expect(applicationsPage).not.toMatch(/window\.alert|window\.confirm|alert\(/)
    expect(applicationsPage).not.toMatch(/resumes or job records will be deleted/i)
    expect(confirm).toMatch(/variant="danger"/)
  })

  it('persists deletion through Supabase and refreshes on success or failure', () => {
    const persistFn = persist.slice(
      persist.indexOf('export async function deleteApplicationRecords'),
      persist.indexOf('export async function fetchJobApplicationBundle'),
    )
    expect(workspace).toMatch(/deleteApplicationRecords\(supabase, user\.id, unique\)/)
    expect(workspace).toMatch(/The selected applications could not be deleted/)
    expect(workspace).toMatch(/Some applications could not be deleted/)
    expect(persistFn).toMatch(/from\('applications'\)\.select\('id'\)/)
    expect(persistFn).toMatch(/from\('applications'\)\.delete\(\)/)
    expect(persistFn).toMatch(/\.eq\('user_id', userId\)/)
    expect(persistFn).not.toMatch(/from\('resumes'\)/)
    expect(persistFn).not.toMatch(/from\('resume_versions'\)/)
    expect(persistFn).not.toMatch(/from\('job_matches'\)/)
    expect(persistFn).not.toMatch(/from\('jobs'\)/)
    const deleteApplicationsFn = workspace.slice(
      workspace.indexOf('const deleteApplications = useCallback'),
      workspace.indexOf('const savePreferences = useCallback'),
    )
    expect(deleteApplicationsFn).toMatch(/await refreshAnalyses\(\)/)
    expect(deleteApplicationsFn).not.toMatch(/deleteAnalysisRecords/)
  })

  it('uses existing ownership RLS for application deletes without weakening it', () => {
    expect(schema).toMatch(/grant select, insert, update, delete on table public\.applications/)
    expect(schema).toMatch(/create policy "Users can manage own applications"/)
    expect(schema).toMatch(/on public\.applications for all/)
    expect(schema).toMatch(/using \(auth\.uid\(\) = user_id\)/)
    expect(schema).toMatch(/with check \(auth\.uid\(\) = user_id\)/)
    expect(schema).toMatch(/alter table public\.applications enable row level security/)
  })

  it('keeps a compact applications table and a usable mobile list', () => {
    expect(applicationsPage).toMatch(/>Job</)
    expect(applicationsPage).toMatch(/>Company</)
    expect(applicationsPage).toMatch(/>Match</)
    expect(applicationsPage).toMatch(/>Status</)
    expect(applicationsPage).toMatch(/data-testid="applications-mobile-list"/)
    expect(applicationsPage).toMatch(/hidden md:block/)
    expect(applicationsPage).toMatch(/md:hidden/)
  })

  it('reports deletion through the existing toast helper', () => {
    expect(applicationsPage).toMatch(/deletedApplicationsMessage\(deleted\)/)
    expect(applicationsPage).toMatch(/notify\(/)
    expect(applicationsPage).toMatch(/'error'/)
  })
})
