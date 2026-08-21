import { Link } from 'react-router-dom'
import { ArrowUpRight, Briefcase, CircleCheck, Inbox, Sparkles } from 'lucide-react'
import { Card, PageHeader } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Pill, RecommendationBadge, ScoreBadge } from '@/components/ui/Badge'
import { useWorkspace } from '@/context/WorkspaceContext'
import { formatDate } from '@/lib/format'

export function DashboardPage() {
  const { jobs, matches, applications, preferences } = useWorkspace()
  const isDemoData = matches.some((match) => match.analysisSource === 'sample')

  const stats = [
    { label: 'Jobs analyzed', value: jobs.length, hint: 'Saved roles' },
    { label: 'Strong matches', value: matches.filter((match) => (match.overallScore ?? 0) >= 80).length, hint: 'Score 80+' },
    { label: 'Applications', value: applications.filter((app) => ['applied', 'interview', 'offer'].includes(app.status)).length, hint: 'In flight' },
    { label: 'Interviews', value: applications.filter((app) => app.status === 'interview').length, hint: 'Active' },
  ]

  const recentMatches = [...matches]
    .sort((a, b) => (b.analyzedAt ?? b.createdAt).localeCompare(a.analyzedAt ?? a.createdAt))
    .slice(0, 6)

  return (
    <div>
      <PageHeader
        eyebrow="Overview"
        title="Dashboard"
        description="A quiet snapshot of your search. Recent analyses stay in Supabase, not only in this browser tab."
        actions={
          <Link
            to="/analyze"
            className="inline-flex items-center gap-2 rounded-xl bg-olive px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-olive-dark"
          >
            Analyze a role
            <ArrowUpRight size={16} />
          </Link>
        }
      />

      {isDemoData && (
        <div className="mb-6 rounded-2xl border border-olive-border bg-olive-soft px-4 py-3 text-sm text-olive-dark">
          You are viewing labeled sample data. Live analyses are stored when you are signed in with Supabase.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label} className="relative overflow-hidden p-5">
            <span className="absolute inset-y-0 left-0 w-1 bg-olive" />
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">{stat.label}</p>
            <p className="mt-3 text-4xl font-semibold tracking-tight text-charcoal">{stat.value}</p>
            <p className="mt-1 text-sm text-muted">{stat.hint}</p>
          </Card>
        ))}
      </div>

      <Card className="mt-6 overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-charcoal">Recent analyses</h2>
            <p className="text-sm text-muted">Minimum match preference: {preferences.minMatchScore}.</p>
          </div>
          <Link to="/analyze?tab=history" className="text-sm font-semibold text-olive hover:text-olive-dark">
            View history
          </Link>
        </div>
        {recentMatches.length === 0 ? (
          <EmptyState
            icon={<Inbox size={18} />}
            title="No analyses yet"
            description="Paste a job description to create your first saved match report."
            action={
              <Link to="/analyze" className="text-sm font-semibold text-olive">
                Start analysis
              </Link>
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Role</th>
                  <th>Score</th>
                  <th>Recommendation</th>
                  <th>Analyzed</th>
                </tr>
              </thead>
              <tbody>
                {recentMatches.map((match) => {
                  const job = jobs.find((item) => item.id === match.jobId)
                  return (
                    <tr key={match.id}>
                      <td className="font-semibold">{job?.company ?? '—'}</td>
                      <td>
                        <Link className="font-medium text-olive hover:text-olive-dark" to={`/matches/${match.id}`}>
                          {job?.title ?? 'Untitled role'}
                        </Link>
                        {match.analysisSource === 'sample' && (
                          <span className="ml-2">
                            <Pill tone="review">Sample</Pill>
                          </span>
                        )}
                      </td>
                      <td>
                        <ScoreBadge score={match.overallScore} />
                      </td>
                      <td>
                        <RecommendationBadge value={match.recommendation} />
                      </td>
                      <td>{formatDate(match.analyzedAt ?? match.createdAt)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <MiniStat icon={CircleCheck} label="Ready to submit" value={applications.filter((app) => app.status === 'ready').length} />
        <MiniStat icon={Briefcase} label="Applied" value={applications.filter((app) => app.status === 'applied').length} />
        <MiniStat icon={Sparkles} label="Offers" value={applications.filter((app) => app.status === 'offer').length} />
      </div>
    </div>
  )
}

function MiniStat({
  icon: Icon,
  label,
  value,
  className = '',
}: {
  icon: typeof CircleCheck
  label: string
  value: number
  className?: string
}) {
  return (
    <Card className={`flex items-center gap-3 p-4 ${className}`}>
      <div className="grid h-10 w-10 place-items-center rounded-xl bg-olive-soft text-olive">
        <Icon size={18} />
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">{label}</p>
        <p className="text-xl font-semibold text-charcoal">{value}</p>
      </div>
    </Card>
  )
}
