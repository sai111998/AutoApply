import { Link, useNavigate, useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { ArrowLeft, Ban, CircleAlert, Sparkles } from 'lucide-react'
import { Card, PageHeader } from '@/components/ui/Card'
import { Pill, RecommendationBadge } from '@/components/ui/Badge'
import { ScoreRing } from '@/components/ui/ScoreRing'
import { Button } from '@/components/ui/Button'
import { EmptyState, ErrorState, SkeletonBlock } from '@/components/ui/EmptyState'
import { useToast } from '@/context/ToastContext'
import { useWorkspace } from '@/context/WorkspaceContext'
import { fetchMatchBundle } from '@/lib/analysis-persist'
import { formatDate } from '@/lib/format'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import type { Application, DimensionMatch, Job, JobMatch, SkillSignal } from '@/types/domain'

export function MatchResultsPage() {
  const { matchId } = useParams()
  const navigate = useNavigate()
  const { notify } = useToast()
  const { user, isDemo } = useAuth()
  const { matches, jobs, resumes, applications, updateApplication, refreshAnalyses, historyLoading, historyError } =
    useWorkspace()
  const [fetched, setFetched] = useState<{ match: JobMatch; job: Job | null; application: Application | null } | null>(
    null,
  )
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [fetching, setFetching] = useState(false)

  const memoryMatch = matches.find((item) => item.id === matchId)
  const match = memoryMatch ?? fetched?.match
  const job = match ? jobs.find((item) => item.id === match.jobId) ?? fetched?.job ?? undefined : undefined
  const resume = match?.resumeId ? resumes.find((item) => item.id === match.resumeId) : undefined
  const application =
    (match ? applications.find((item) => item.matchId === match.id) : undefined) ?? fetched?.application ?? undefined

  useEffect(() => {
    void refreshAnalyses()
  }, [refreshAnalyses])

  useEffect(() => {
    if (!matchId || memoryMatch || isDemo || !supabase || !user) return
    let cancelled = false
    setFetching(true)
    setFetchError(null)
    void fetchMatchBundle(supabase, user.id, matchId)
      .then((bundle) => {
        if (cancelled) return
        if (bundle.match) setFetched(bundle)
      })
      .catch((error: unknown) => {
        if (!cancelled) setFetchError(error instanceof Error ? error.message : 'Could not load this analysis')
      })
      .finally(() => {
        if (!cancelled) setFetching(false)
      })
    return () => {
      cancelled = true
    }
  }, [isDemo, matchId, memoryMatch, user])

  if (!match || !job) {
    if (historyLoading || fetching) {
      return (
        <Card className="p-6">
          <SkeletonBlock className="mb-4 h-8 w-64" />
          <SkeletonBlock className="mb-6 h-4 w-40" />
          <div className="grid gap-4 md:grid-cols-2">
            <SkeletonBlock className="h-48" />
            <SkeletonBlock className="h-48" />
          </div>
        </Card>
      )
    }

    if (historyError || fetchError) {
      return (
        <ErrorState
          title="Could not load this analysis"
          description={fetchError ?? historyError ?? 'Unknown error'}
          onRetry={() => void refreshAnalyses()}
        />
      )
    }

    return (
      <Card>
        <EmptyState
          title="Analysis not found"
          description="This report is not in your workspace. It may have been deleted, or it belongs to another account."
          action={
            <Link className="text-sm font-semibold text-olive" to="/analyze?tab=history">
              Back to history
            </Link>
          }
        />
      </Card>
    )
  }

  const loading = match.analysisStatus === 'queued' || match.analysisStatus === 'pending'
  const failed = match.analysisStatus === 'failed' || match.analysisStatus === 'unavailable'

  return (
    <div>
      <PageHeader
        eyebrow="Fit report"
        title={job.title}
        description={`${job.company} · ${job.location || 'Location not specified'}`}
        actions={
          <Button variant="secondary" onClick={() => navigate('/analyze?tab=history')}>
            <ArrowLeft size={16} />
            History
          </Button>
        }
      />

      {match.analysisSource === 'sample' && (
        <div className="mb-6 rounded-2xl border border-olive-border bg-olive-soft px-4 py-3 text-sm text-olive-dark">
          Sample preview — this record is included so you can review the match UI. It is not a live production analysis.
        </div>
      )}

      {loading && (
        <Card className="mb-6 p-6">
          <p className="text-sm font-semibold text-olive-dark">Analysis in progress</p>
          <p className="mt-1 text-sm text-muted">Scores stay empty until the server returns a structured result.</p>
          <div className="progress-bar mt-4">
            <span style={{ width: '55%' }} />
          </div>
        </Card>
      )}

      {failed && (
        <Card className="mb-6 p-6">
          <div className="flex items-start gap-3">
            <CircleAlert className="text-danger" />
            <div>
              <h2 className="font-semibold text-charcoal">Analysis did not complete</h2>
              <p className="mt-1 max-w-3xl text-sm text-muted">
                {match.errorMessage || 'The analysis API returned an error. No substitute score was invented.'}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Pill tone="skip">{match.analysisStatus}</Pill>
                <Link className="text-sm font-semibold text-olive" to="/analyze">
                  Try another analysis
                </Link>
              </div>
            </div>
          </div>
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-[0.85fr_1.35fr]">
        <Card className="p-6">
          <div className="flex flex-col items-center text-center">
            <ScoreRing score={match.overallScore} />
            <div className="mt-4">
              <RecommendationBadge value={match.recommendation} />
            </div>
            <p className="mt-3 text-sm text-muted">Resume: {resume?.versionLabel ?? 'No resume attached'}</p>
            <p className="text-sm text-muted">Analyzed {formatDate(match.analyzedAt ?? match.createdAt)}</p>
            {job.jobUrl && (
              <a className="mt-2 text-sm font-semibold text-olive hover:text-olive-dark" href={job.jobUrl} target="_blank" rel="noreferrer">
                Open posting
              </a>
            )}
          </div>
          <div className="mt-6 space-y-3">
            <Dimension label="Experience match" value={match.experienceMatch} />
            <Dimension label="Education match" value={match.educationMatch} />
            <Dimension label="Location match" value={match.locationMatch} />
          </div>
          <div className="mt-6 rounded-2xl bg-canvas p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Work authorization</p>
            <p className="mt-2 text-sm text-charcoal">
              {match.workAuthorizationNotes || 'Not included in this analysis contract.'}
            </p>
          </div>
          {application && (
            <Button
              className="mt-5 w-full"
              variant="secondary"
              onClick={() => {
                void updateApplication(application.id, { status: 'applied' }).then(() =>
                  notify('Marked as applied.'),
                )
              }}
              disabled={application.status !== 'ready'}
            >
              Mark as applied
            </Button>
          )}
        </Card>

        <div className="space-y-6">
          {match.summary && (
            <Card className="p-6">
              <h2 className="text-lg font-semibold text-charcoal">Summary</h2>
              <p className="mt-3 text-sm leading-6 text-charcoal">{match.summary}</p>
            </Card>
          )}

          <Card className="p-6">
            <h2 className="text-lg font-semibold text-charcoal">Skills</h2>
            <div className="mt-5 grid gap-5 md:grid-cols-3">
              <SkillColumn title="Matched" tone="strong" items={match.skillsMatched} empty="None listed in the resume vs posting." />
              <SkillColumn title="Partial" tone="review" items={match.skillsPartial} empty="None listed." />
              <SkillColumn title="Missing" tone="skip" items={match.skillsMissing} empty="None listed." />
            </div>
          </Card>

          <div className="grid gap-6 md:grid-cols-2">
            <Card className="p-6">
              <h2 className="flex items-center gap-2 text-lg font-semibold text-charcoal">
                <Sparkles size={18} className="text-olive" />
                Strengths
              </h2>
              <List items={match.strengths} empty="No strengths returned yet." />
            </Card>
            <Card className="p-6">
              <h2 className="flex items-center gap-2 text-lg font-semibold text-charcoal">
                <Ban size={18} className="text-danger" />
                Concerns
              </h2>
              <List items={match.concerns} empty="No concerns returned yet." />
            </Card>
          </div>

          <Card className="p-6">
            <h2 className="text-lg font-semibold text-charcoal">Job description</h2>
            {job.description.trim() ? (
              <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-muted">{job.description}</p>
            ) : (
              <p className="mt-3 text-sm text-muted">No job description was stored for this role.</p>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}

function Dimension({ label, value }: { label: string; value: DimensionMatch | null }) {
  const display =
    value?.matched === true ? 'Yes' : value?.matched === false ? 'No' : value?.score == null ? '—' : String(value.score)

  return (
    <div className="rounded-2xl border border-line px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-xl font-semibold text-charcoal">{display}</p>
      </div>
      <p className="mt-1 text-sm text-muted">{value?.summary ?? 'Pending analysis API output.'}</p>
    </div>
  )
}

function SkillColumn({
  title,
  tone,
  items,
  empty,
}: {
  title: string
  tone: 'strong' | 'review' | 'skip'
  items: SkillSignal[]
  empty: string
}) {
  return (
    <div>
      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted">{title}</p>
      <div className="flex flex-wrap gap-2">
        {items.length === 0 && <p className="text-sm text-muted">{empty}</p>}
        {items.map((item) => (
          <span key={`${title}-${item.name}`} className="block">
            <Pill tone={tone}>{item.name}</Pill>
            {item.note && <p className="mt-1 text-xs text-muted">{item.note}</p>}
          </span>
        ))}
      </div>
    </div>
  )
}

function List({ items, empty }: { items: string[]; empty: string }) {
  if (!items.length) return <p className="mt-3 text-sm text-muted">{empty}</p>
  return (
    <ul className="mt-3 space-y-2 text-sm text-charcoal">
      {items.map((item) => (
        <li key={item} className="rounded-xl bg-canvas px-3 py-2">
          {item}
        </li>
      ))}
    </ul>
  )
}
