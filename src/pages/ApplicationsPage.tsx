import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, PageHeader } from '@/components/ui/Card'
import { Field, Select, TextInput } from '@/components/ui/Field'
import { Pill, ScoreBadge, StatusBadge } from '@/components/ui/Badge'
import { useWorkspace } from '@/context/WorkspaceContext'
import { formatDate } from '@/lib/format'
import type { ApplicationStatus } from '@/types/domain'
import { APPLICATION_STATUS_LABELS } from '@/types/domain'

export function ApplicationsPage() {
  const { applications, jobs, matches, resumes, updateApplication } = useWorkspace()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'all' | ApplicationStatus>('all')
  const [minScore, setMinScore] = useState('')

  const rows = useMemo(() => {
    return applications
      .map((application) => {
        const job = jobs.find((item) => item.id === application.jobId)
        const match = matches.find((item) => item.id === application.matchId)
        const resume = resumes.find((item) => item.id === application.resumeId)
        return { application, job, match, resume }
      })
      .filter((row) => row.job)
      .filter((row) => {
        const haystack = `${row.job?.company} ${row.job?.title}`.toLowerCase()
        const matchesQuery = haystack.includes(query.toLowerCase())
        const matchesStatus = status === 'all' || row.application.status === status
        const score = row.match?.overallScore
        const matchesScore = !minScore || (score != null && score >= Number(minScore))
        return matchesQuery && matchesStatus && matchesScore
      })
      .sort((a, b) => b.application.dateAdded.localeCompare(a.application.dateAdded))
  }, [applications, jobs, matches, minScore, query, resumes, status])

  return (
    <div>
      <PageHeader
        eyebrow="Pipeline"
        title="Applications"
        description="Track status, resume version, and the next action. Automatic submission is intentionally out of scope for this MVP."
      />

      <Card className="mb-5 grid gap-3 p-4 sm:grid-cols-3">
        <Field label="Search">
          <TextInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Company or title" />
        </Field>
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value as 'all' | ApplicationStatus)}>
            <option value="all">All statuses</option>
            {Object.entries(APPLICATION_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
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
                <th>Match score</th>
                <th>Status</th>
                <th>Date added</th>
                <th>Date applied</th>
                <th>Resume version</th>
                <th>Next action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ application, job, match, resume }) => (
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
                    <ScoreBadge score={match?.overallScore ?? null} />
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
                  <td>{formatDate(application.dateAdded)}</td>
                  <td>{formatDate(application.dateApplied)}</td>
                  <td>{resume?.versionLabel ?? '—'}</td>
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
