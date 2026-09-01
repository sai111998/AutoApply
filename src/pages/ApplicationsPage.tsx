import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card, PageHeader } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Field, Select, TextInput } from '@/components/ui/Field'
import { IconButton } from '@/components/ui/IconButton'
import { Pill, ScoreBadge, StatusBadge } from '@/components/ui/Badge'
import { useToast } from '@/context/ToastContext'
import { useWorkspace } from '@/context/WorkspaceContext'
import {
  applySelectAll,
  bulkDeleteBody,
  bulkDeleteTitle,
  checkboxSelectionState,
  deletedApplicationsMessage,
  pruneSelection,
  toggleId,
} from '@/lib/application-bulk'
import { resolveApplicationResumeDisplay } from '@/lib/application-selection'
import type { ApplicationStatus } from '@/types/domain'
import { APPLICATION_STATUS_LABELS } from '@/types/domain'

export function ApplicationsPage() {
  const { applications, jobs, matches, resumes, resumeVersions, updateApplication, deleteApplications, refreshAnalyses } =
    useWorkspace()
  const { notify } = useToast()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'all' | ApplicationStatus>('all')
  const [minScore, setMinScore] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [pendingIds, setPendingIds] = useState<string[] | null>(null)
  const [deleting, setDeleting] = useState(false)
  const selectAllRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void refreshAnalyses()
  }, [refreshAnalyses])

  const rows = useMemo(() => {
    return applications
      .map((application) => {
        const job = jobs.find((item) => item.id === application.jobId)
        const display = resolveApplicationResumeDisplay({
          application,
          versions: resumeVersions ?? [],
          matches,
          resumes,
        })
        const currentMatch =
          (display.currentMatchId ? matches.find((item) => item.id === display.currentMatchId) : undefined) ??
          matches.find((item) => item.id === application.matchId)
        return { application, job, match: currentMatch, display }
      })
      .filter((row) => row.job)
      .filter((row) => {
        const haystack = `${row.job?.company} ${row.job?.title}`.toLowerCase()
        const matchesQuery = haystack.includes(query.toLowerCase())
        const matchesStatus = status === 'all' || row.application.status === status
        const score = row.display.currentMatchScore
        const matchesScore = !minScore || (score != null && score >= Number(minScore))
        return matchesQuery && matchesStatus && matchesScore
      })
      .sort((a, b) => b.application.updatedAt.localeCompare(a.application.updatedAt))
  }, [applications, jobs, matches, minScore, query, resumeVersions, resumes, status])

  const visibleIds = rows.map((row) => row.application.id)
  const visibleKey = visibleIds.join('\0')
  const visibleSelected = pruneSelection(selectedIds, visibleIds)
  const selectState = checkboxSelectionState(visibleSelected, visibleIds)

  useEffect(() => {
    setSelectedIds((current) => pruneSelection(current, visibleKey ? visibleKey.split('\0') : []))
  }, [visibleKey])

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = selectState === 'some'
  }, [selectState])

  async function confirmDelete() {
    if (!pendingIds?.length) return
    setDeleting(true)
    try {
      const deleted = await deleteApplications(pendingIds)
      notify(deletedApplicationsMessage(deleted))
      setSelectedIds([])
      setPendingIds(null)
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not delete the selected applications.', 'error')
      setPendingIds(null)
      setSelectedIds([])
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Pipeline"
        title="Applications"
        description="Track status, the selected resume version, and the current match score. Automatic submission is intentionally out of scope for this MVP."
      />

      <Card className="mb-5 grid gap-3 p-4 sm:grid-cols-3">
        <Field label="Search">
          <TextInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Company or title" />
        </Field>
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value as 'all' | ApplicationStatus)}>
            <option value="all">All statuses</option>
            {Object.entries(APPLICATION_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={label ? value : value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Minimum match score">
          <TextInput
            type="number"
            min={0}
            max={100}
            value={minScore}
            onChange={(e) => setMinScore(e.target.value)}
            placeholder="Any"
          />
        </Field>
      </Card>

      {visibleSelected.length > 0 && (
        <div
          className="sticky top-0 z-10 mb-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-white px-4 py-3"
          data-testid="bulk-action-bar"
        >
          <p className="text-sm font-semibold text-charcoal">{visibleSelected.length} selected</p>
          <Button
            type="button"
            variant="secondary"
            className="text-danger hover:border-[#e4cfc8] hover:bg-[#f7ece8]"
            onClick={() => setPendingIds(visibleSelected)}
          >
            Delete Selected
          </Button>
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="hidden md:block">
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="w-10">
                    <input
                      ref={selectAllRef}
                      type="checkbox"
                      aria-label="Select all"
                      checked={selectState === 'all'}
                      onChange={() => setSelectedIds(applySelectAll(visibleIds, selectState === 'all'))}
                    />
                  </th>
                  <th>Job</th>
                  <th>Company</th>
                  <th>Match</th>
                  <th>Status</th>
                  <th>Resume</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ application, job, match, display }) => (
                  <tr
                    key={application.id}
                    className={visibleSelected.includes(application.id) ? 'bg-olive-soft/50' : undefined}
                  >
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Select ${job?.title ?? 'application'}`}
                        checked={visibleSelected.includes(application.id)}
                        onChange={() => setSelectedIds(toggleId(visibleSelected, application.id))}
                      />
                    </td>
                    <td>
                      {match ? (
                        <Link className="font-medium text-olive hover:text-olive-dark" to={`/matches/${match.id}`}>
                          {job?.title}
                        </Link>
                      ) : (
                        <span className="font-medium">{job?.title}</span>
                      )}
                      {match?.analysisSource === 'sample' && (
                        <span className="ml-2">
                          <Pill tone="review">Sample</Pill>
                        </span>
                      )}
                    </td>
                    <td className="font-semibold">{job?.company}</td>
                    <td>
                      <ScoreBadge score={display.currentMatchScore} />
                    </td>
                    <td>
                      <Select
                        value={application.status}
                        onChange={(event) =>
                          void updateApplication(application.id, {
                            status: event.target.value as ApplicationStatus,
                          })
                        }
                      >
                        {Object.entries(APPLICATION_STATUS_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td>
                      <p className="font-medium text-charcoal">{display.currentResumeLabel}</p>
                      {display.usingMaster && <p className="text-xs text-muted">Original</p>}
                    </td>
                    <td>
                      <IconButton label="Delete" variant="danger" onClick={() => setPendingIds([application.id])}>
                        <Trash2 size={16} />
                      </IconButton>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-slate-ink">
                      No applications match these filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="md:hidden" data-testid="applications-mobile-list">
          <div className="flex items-center gap-3 border-b border-line px-4 py-3">
            <input
              type="checkbox"
              aria-label="Select all"
              checked={selectState === 'all'}
              ref={(node) => {
                if (node) node.indeterminate = selectState === 'some'
              }}
              onChange={() => setSelectedIds(applySelectAll(visibleIds, selectState === 'all'))}
            />
            <span className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">Select all</span>
          </div>
          <ul className="divide-y divide-fog">
            {rows.map(({ application, job, match, display }) => (
              <li key={application.id} className={`flex items-start gap-3 px-4 py-4 ${visibleSelected.includes(application.id) ? 'bg-olive-soft/50' : ''}`}>
                <input
                  className="mt-1"
                  type="checkbox"
                  aria-label={`Select ${job?.title ?? 'application'}`}
                  checked={visibleSelected.includes(application.id)}
                  onChange={() => setSelectedIds(toggleId(visibleSelected, application.id))}
                />
                <div className="min-w-0 flex-1">
                  {match ? (
                    <Link className="font-semibold text-olive hover:text-olive-dark" to={`/matches/${match.id}`}>
                      {job?.title}
                    </Link>
                  ) : (
                    <p className="font-semibold text-charcoal">{job?.title}</p>
                  )}
                  <p className="mt-0.5 text-sm text-muted">{job?.company}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <ScoreBadge score={display.currentMatchScore} />
                    <StatusBadge status={application.status} />
                    <span className="text-xs text-muted">{display.currentResumeLabel}</span>
                  </div>
                </div>
                <IconButton label="Delete" variant="danger" onClick={() => setPendingIds([application.id])}>
                  <Trash2 size={16} />
                </IconButton>
              </li>
            ))}
            {rows.length === 0 && (
              <li className="px-4 py-12 text-center text-slate-ink">No applications match these filters.</li>
            )}
          </ul>
        </div>
      </Card>

      <ConfirmDialog
        open={Boolean(pendingIds?.length)}
        title={bulkDeleteTitle(pendingIds?.length ?? 0)}
        confirmLabel="Delete"
        busy={deleting}
        onCancel={() => setPendingIds(null)}
        onConfirm={() => void confirmDelete()}
      >
        {bulkDeleteBody(pendingIds?.length ?? 0)}
      </ConfirmDialog>
    </div>
  )
}
