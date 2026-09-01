import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, PageHeader } from '@/components/ui/Card'
import { Field, Select, TextInput } from '@/components/ui/Field'
import { Pill, ScoreBadge, StatusBadge } from '@/components/ui/Badge'
import { useWorkspace } from '@/context/WorkspaceContext'
import { resolveApplicationResumeDisplay } from '@/lib/application-selection'
import { formatDate, formatRelativeDate } from '@/lib/format'
import type { ApplicationStatus } from '@/types/domain'
import { APPLICATION_STATUS_LABELS } from '@/types/domain'

export function ApplicationsPage() {
  const { applications, jobs, matches, resumes, resumeVersions, updateApplication } = useWorkspace()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'all' | ApplicationStatus>('all')
  const [minScore, setMinScore] = useState('')

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

      <Card className="overflow-hidden">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Job title</th>
                <th>Current resume</th>
                <th>Current match</th>
                <th>Previous match</th>
                <th>Status</th>
                <th>Updated</th>
                <th>Next action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ application, job, match, display }) => (
                <tr key={application.id}>
                  <td className="font-semibold">{job?.company}</td>
                  <td>
                    {match ? (
                      <Link className="font-medium text-olive hover:text-olive-dark" to={`/matches/${match.id}`}>
                        {job?.title}
                      </Link>
                    ) : (
                      job?.title
                    )}
                    {match?.analysisSource === 'sample' && (
                      <span className="ml-2">
                        <Pill tone="review">Sample</Pill>
                      </span>
                    )}
                  </td>
                  <td>
                    <p className="font-medium text-charcoal">{display.currentResumeLabel}</p>
                    {display.usingMaster && <p className="text-xs text-muted">Original</p>}
                  </td>
                  <td>
                    <ScoreBadge score={display.currentMatchScore} />
                  </td>
                  <td>
                    {display.previousMatchScore != null && display.previousMatchScore !== display.currentMatchScore ? (
                      <span className="text-sm text-muted">{display.previousMatchScore}%</span>
                    ) : display.previousMatchScore != null ? (
                      <span className="text-sm text-muted">{display.previousMatchScore}%</span>
                    ) : (
                      '—'
                    )}
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
                    <div className="mt-2">
                      <StatusBadge status={application.status} />
                    </div>
                  </td>
                  <td>
                    <p>{formatRelativeDate(application.updatedAt)}</p>
                    <p className="text-xs text-muted">Added {formatDate(application.dateAdded)}</p>
                  </td>
                  <td>{application.nextAction}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-ink">
                    No applications match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
