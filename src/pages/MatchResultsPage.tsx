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
import { useAuth } from '@/context/AuthContext'
import { fetchMatchBundle } from '@/lib/analysis-persist'
import { formatDate } from '@/lib/format'
import { supabase } from '@/lib/supabase'
import type { MatchReport, SkillAssessment } from '@/lib/ai/types'
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
  const report = match?.report ?? null

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
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => {
                if (!resume) {
                  notify('Upload a resume before tailoring.', 'error')
                  return
                }
                if (!job.description.trim() || match.analysisStatus !== 'complete') {
                  notify('Analyze a job before tailoring your resume.', 'error')
                  return
                }
                navigate(`/matches/${match.id}/tailor`)
              }}
              disabled={!resume || !job.description.trim() || match.analysisStatus !== 'complete'}
            >
              Tailor Resume
            </Button>
            <Button variant="secondary" onClick={() => navigate('/analyze?tab=history')}>
              <ArrowLeft size={16} />
              History
            </Button>
          </div>
        }
      />

      {!resume && (
        <div className="mb-6 rounded-2xl border border-[#ead5cf] bg-[#fdf7f5] px-4 py-3 text-sm text-danger">
          Upload a resume before tailoring.
        </div>
      )}
      {resume && (!job.description.trim() || match.analysisStatus !== 'complete') && (
        <div className="mb-6 rounded-2xl border border-[#ead5cf] bg-[#fdf7f5] px-4 py-3 text-sm text-danger">
          Analyze a job before tailoring your resume.
        </div>
      )}

      {match.parentMatchId && (
        <div className="mb-6 rounded-2xl border border-olive-border bg-olive-soft px-4 py-3 text-sm text-olive-dark">
          Updated analysis of a tailored resume. The original match report is unchanged.
          {(() => {
            const previous = matches.find((item) => item.id === match.parentMatchId)
            if (previous?.overallScore == null || match.overallScore == null) return null
            const delta = match.overallScore - previous.overallScore
            return ` Previous score ${previous.overallScore}/100 · Updated ${match.overallScore}/100 · ${delta > 0 ? '+' : ''}${delta} points.`
          })()}
        </div>
      )}

      {match.analysisSource === 'sample' && (
        <div className="mb-6 rounded-2xl border border-olive-border bg-olive-soft px-4 py-3 text-sm text-olive-dark">
          Sample preview — this record is included so you can review the match UI. It is not a live production analysis.
        </div>
      )}

      {loading && (
        <Card className="mb-6 p-6">
          <p className="text-sm font-semibold text-olive-dark">Analysis in progress</p>
          <p className="mt-1 text-sm text-muted">
            Extracting resume and job evidence, then scoring. No substitute score is invented while this runs.
          </p>
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

      <Card className="mb-6 p-6">
        <div className="grid gap-6 md:grid-cols-[auto_1fr] md:items-center">
          <ScoreRing score={match.overallScore} />
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Match score</p>
            <p className="font-display text-4xl text-charcoal">
              {match.overallScore ?? '—'} <span className="text-2xl text-muted">/ 100</span>
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted">Recommendation</span>
              <RecommendationBadge value={match.recommendation} />
              <span className="text-sm text-muted">Confidence</span>
              <Pill tone={match.confidence === 'HIGH' ? 'strong' : match.confidence === 'MEDIUM' ? 'review' : 'pending'}>
                {match.confidence ?? '—'}
              </Pill>
            </div>
            <p className="mt-3 text-sm text-muted">
              Resume: {resume?.versionLabel ?? 'No resume attached'} · Analyzed{' '}
              {formatDate(match.analyzedAt ?? match.createdAt)}
            </p>
            <p className="mt-2 max-w-2xl text-xs text-muted">
              This is a fit recommendation from the supplied resume and job description. It is not a hiring or interview
              prediction.
            </p>
            {job.jobUrl && (
              <a
                className="mt-2 inline-block text-sm font-semibold text-olive hover:text-olive-dark"
                href={job.jobUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open posting
              </a>
            )}
          </div>
        </div>
        <div className="mt-6 rounded-2xl bg-canvas p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Work authorization</p>
          <p className="mt-2 text-sm text-charcoal">
            {match.workAuthorizationNotes || 'Not included in this analysis contract.'}
          </p>
        </div>
      </Card>

      <div className="space-y-6">
        <SkillSection
          title="Strong matches"
          tone="strong"
          items={report ? [...report.requiredSkills.matched, ...report.preferredSkills.matched] : match.skillsMatched}
          empty="No strong overlaps were evidenced on the resume."
        />
        <SkillSection
          title="Partial matches"
          tone="review"
          items={report ? [...report.requiredSkills.partial, ...report.preferredSkills.partial] : match.skillsPartial}
          empty="No partial overlaps were identified."
        />
        <SkillSection
          title="Missing requirements"
          tone="skip"
          items={
            report ? [...report.requiredSkills.missing, ...report.preferredSkills.missing] : match.skillsMissing
          }
          empty="No missing requirements were listed."
        />

        <Card className="p-6">
          <h2 className="text-lg font-semibold text-charcoal">Experience fit</h2>
          <ExperienceBlock report={report} fallback={match.experienceMatch} />
        </Card>

        <Card className="p-6">
          <h2 className="text-lg font-semibold text-charcoal">Responsibility fit</h2>
          {report ? (
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <MiniList title="Strongly aligned" items={report.responsibilities.strongMatches} empty="None evidenced." />
              <MiniList title="Partially aligned" items={report.responsibilities.partialMatches} empty="None evidenced." />
              <MiniList title="Major gaps" items={report.responsibilities.gaps} empty="None listed." />
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted">
              This older record does not include a structured responsibility comparison.
            </p>
          )}
        </Card>

        <div className="grid gap-6 md:grid-cols-2">
          <Card className="p-6">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-charcoal">
              <Sparkles size={18} className="text-olive" />
              Strengths
            </h2>
            <List items={match.strengths.slice(0, 5)} empty="No strengths returned yet." />
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
          <h2 className="text-lg font-semibold text-charcoal">Education and certifications</h2>
          <p className="mt-3 text-sm text-charcoal">
            {report?.education.details || match.educationMatch?.summary || 'Not included in this record.'}
          </p>
          {report && (
            <div className="mt-4 flex flex-wrap gap-2">
              {report.certifications.matched.map((item) => (
                <Pill key={item.name} tone="strong">
                  {item.name}
                </Pill>
              ))}
              {report.certifications.missing.map((item) => (
                <Pill key={item.name} tone="skip">
                  Missing: {item.name}
                </Pill>
              ))}
            </div>
          )}
        </Card>

        {(report?.missingEvidence.length || 0) > 0 && (
          <Card className="p-6">
            <h2 className="text-lg font-semibold text-charcoal">Insufficient evidence</h2>
            <List items={report?.missingEvidence ?? []} empty="" />
          </Card>
        )}

        {match.summary && (
          <Card className="p-6">
            <h2 className="text-lg font-semibold text-charcoal">AI summary</h2>
            <p className="mt-3 text-sm leading-6 text-charcoal">{match.summary}</p>
          </Card>
        )}

        <Card className="p-6">
          <h2 className="text-lg font-semibold text-charcoal">Job description</h2>
          {job.description.trim() ? (
            <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-muted">{job.description}</p>
          ) : (
            <p className="mt-3 text-sm text-muted">No job description was stored for this role.</p>
          )}
          {application && (
            <Button
              className="mt-5"
              variant="secondary"
              onClick={() => {
                void updateApplication(application.id, { status: 'applied' }).then(() => notify('Marked as applied.'))
              }}
              disabled={application.status !== 'ready'}
            >
              Mark as applied
            </Button>
          )}
        </Card>
      </div>
    </div>
  )
}

function ExperienceBlock({ report, fallback }: { report: MatchReport | null; fallback: DimensionMatch | null }) {
  if (!report) {
    return <p className="mt-3 text-sm text-muted">{fallback?.summary ?? 'Pending analysis output.'}</p>
  }
  return (
    <dl className="mt-4 grid gap-3 text-sm md:grid-cols-3">
      <div className="rounded-2xl bg-canvas px-4 py-3">
        <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Job requirement</dt>
        <dd className="mt-1 text-charcoal">{report.experience.jobRequirement || '—'}</dd>
      </div>
      <div className="rounded-2xl bg-canvas px-4 py-3">
        <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Candidate evidence</dt>
        <dd className="mt-1 text-charcoal">{report.experience.candidateEvidence || '—'}</dd>
      </div>
      <div className="rounded-2xl bg-canvas px-4 py-3">
        <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Gap</dt>
        <dd className="mt-1 text-charcoal">{report.experience.gap || report.experience.status.replaceAll('_', ' ')}</dd>
      </div>
    </dl>
  )
}

function SkillSection({
  title,
  tone,
  items,
  empty,
}: {
  title: string
  tone: 'strong' | 'review' | 'skip'
  items: Array<SkillSignal | SkillAssessment>
  empty: string
}) {
  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold text-charcoal">{title}</h2>
      <div className="mt-4 space-y-3">
        {items.length === 0 && <p className="text-sm text-muted">{empty}</p>}
        {items.map((item) => {
          const name = item.name
          const source = 'source' in item ? item.source : undefined
          const evidence = 'evidence' in item ? item.evidence : item.note
          return (
            <div key={`${title}-${name}-${source ?? ''}`} className="rounded-2xl border border-line px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold text-charcoal">{name}</p>
                <Pill tone={tone}>{tone === 'strong' ? 'Strong match' : tone === 'review' ? 'Partial match' : 'Missing'}</Pill>
                {source && (
                  <Pill tone={source === 'required' ? 'info' : 'neutral'}>
                    {source === 'required' ? 'Required' : 'Preferred'}
                  </Pill>
                )}
              </div>
              {evidence && <p className="mt-2 text-sm text-muted">Evidence: {evidence}</p>}
            </div>
          )
        })}
      </div>
    </Card>
  )
}

function MiniList({ title, items, empty }: { title: string; items: SkillAssessment[]; empty: string }) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted">{title}</p>
      {items.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <ul className="space-y-2 text-sm text-charcoal">
          {items.map((item) => (
            <li key={item.name} className="rounded-xl bg-canvas px-3 py-2">
              <p>{item.name}</p>
              {item.evidence && <p className="mt-1 text-xs text-muted">Evidence: {item.evidence}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function List({ items, empty }: { items: string[]; empty: string }) {
  if (!items.length) return empty ? <p className="mt-3 text-sm text-muted">{empty}</p> : null
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
