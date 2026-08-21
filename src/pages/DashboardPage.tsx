import { Link } from 'react-router-dom'
import { ArrowUpRight, Briefcase, CircleCheck, Inbox, MessagesSquare, Sparkles } from 'lucide-react'
import { Card, PageHeader } from '@/components/ui/Card'
import { Pill, RecommendationBadge, ScoreBadge } from '@/components/ui/Badge'
import { useWorkspace } from '@/context/WorkspaceContext'
import { formatDate } from '@/lib/format'

export function DashboardPage() {
  const { jobs, matches, applications, preferences, isDemoData } = useDashboardStats()

  const stats = [
    { label: 'Jobs analyzed', value: jobs.length, icon: Inbox, hint: 'Roles saved for matching' },
    { label: 'Strong matches', value: matches.filter((match) => (match.overallScore ?? 0) >= 80).length, icon: Sparkles, hint: 'Score 80+' },
    { label: 'Applications ready', value: applications.filter((app) => app.status === 'ready').length, icon: CircleCheck, hint: 'Waiting to submit' },
    { label: 'Applications submitted', value: applications.filter((app) => ['applied', 'interview', 'offer'].includes(app.status)).length, icon: Briefcase, hint: 'In flight' },
    { label: 'Interview count', value: applications.filter((app) => app.status === 'interview').length, icon: MessagesSquare, hint: 'Active interviews' },
  ]

  const recent = [...jobs]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 6)

  return (
    <div>
      <PageHeader
        eyebrow="Overview"
        title="Dashboard"
        description="A snapshot of your search pipeline. Sample records are labeled so they are never confused with live AI analysis."
        actions={
          <Link
            to="/analyze"
            className="inline-flex items-center gap-2 rounded-xl bg-pine px-4 py-2.5 text-sm font-semibold text-white"
          >
            Analyze a role
            <ArrowUpRight size={16} />
          </Link>
        }
      />

      {isDemoData && (
        <div className="mb-6 rounded-2xl border border-gold/40 bg-[#fbf6ea] px-4 py-3 text-sm text-ink">
          You are viewing labeled sample data so the workspace looks complete. New analyses stay queued until an AI API is connected.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {stats.map((stat) => (
          <Card key={stat.label} className="p-5">
            <div className="flex items-start justify-between">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-ink">{stat.label}</p>
              <stat.icon size={18} className="text-pine" />
            </div>
            <p className="mt-3 font-display text-4xl text-navy">{stat.value}</p>
            <p className="mt-1 text-sm text-slate-ink">{stat.hint}</p>
          </Card>
        ))}
      </div>

      <Card className="mt-6 overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="font-display text-2xl text-navy">Recent jobs</h2>
            <p className="text-sm text-slate-ink">Latest roles in your workspace. Minimum match preference: {preferences.minMatchScore}.</p>
          </div>
          <Link to="/applications" className="text-sm font-semibold text-pine">
            View applications
          </Link>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Role</th>
                <th>Location</th>
                <th>Score</th>
                <th>Recommendation</th>
                <th>Added</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((job) => {
                const match = matches.find((item) => item.jobId === job.id)
                return (
                  <tr key={job.id}>
                    <td className="font-semibold">{job.company}</td>
                    <td>
                      {match ? (
                        <Link className="text-pine hover:underline" to={`/matches/${match.id}`}>
                          {job.title}
                        </Link>
                      ) : (
                        job.title
                      )}
                    </td>
                    <td>{job.location}</td>
                    <td>
                      <ScoreBadge score={match?.overallScore ?? null} />
                      {match?.analysisSource === 'sample' && (
                        <span className="ml-2">
                          <Pill tone="review">Sample</Pill>
                        </span>
                      )}
                    </td>
                    <td>
                      <RecommendationBadge value={match?.recommendation ?? null} />
                    </td>
                    <td>{formatDate(job.createdAt)}</td>
                  </tr>
                )
              })}
              {recent.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-ink">
                    No jobs yet. Paste a description on the Job Analysis page.
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

function useDashboardStats() {
  const workspace = useWorkspace()
  const isDemoData = workspace.matches.some((match) => match.analysisSource === 'sample')
  return { ...workspace, isDemoData }
}
