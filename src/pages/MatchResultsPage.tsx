import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Ban, CircleAlert, Sparkles } from 'lucide-react'
import { Card, PageHeader } from '@/components/ui/Card'
import { Pill, RecommendationBadge } from '@/components/ui/Badge'
import { ScoreRing } from '@/components/ui/ScoreRing'
import { Button } from '@/components/ui/Button'
import { useWorkspace } from '@/context/WorkspaceContext'
import { formatDate } from '@/lib/format'
import type { DimensionMatch, SkillSignal } from '@/types/domain'

export function MatchResultsPage() {
  const { matchId } = useParams()
  const navigate = useNavigate()
  const { matches, jobs, resumes, applications, updateApplication } = useWorkspace()
  const match = matches.find((item) => item.id === matchId)
  const job = match ? jobs.find((item) => item.id === match.jobId) : undefined
  const resume = match?.resumeId ? resumes.find((item) => item.id === match.resumeId) : undefined
  const application = match ? applications.find((item) => item.matchId === match.id) : undefined

  if (!match || !job) {
    return (
      <Card className="p-10 text-center">
        <p className="text-slate-ink">That match record was not found.</p>
        <Link className="mt-3 inline-block font-semibold text-pine" to="/analyze">
          Analyze a job
        </Link>
      </Card>
    )
  }

  const pending = match.analysisStatus !== 'complete'

  return (
    <div>
      <PageHeader
        eyebrow="Fit report"
        title={job.title}
        description={`${job.company} · ${job.location || 'Location not specified'}`}
        actions={
          <Button variant="secondary" onClick={() => navigate(-1)}>
            <ArrowLeft size={16} />
            Back
          </Button>
        }
      />

      {match.analysisSource === 'sample' && (
        <div className="mb-6 rounded-2xl border border-gold/40 bg-[#fbf6ea] px-4 py-3 text-sm">
          Sample preview — this record is included so you can review the match UI. It is not a live production analysis.
        </div>
      )}

      {pending && (
        <Card className="mb-6 p-6">
          <div className="flex items-start gap-3">
            <CircleAlert className="text-sky" />
            <div>
              <h2 className="font-semibold text-navy">
                {match.analysisStatus === 'failed' ? 'Analysis did not complete' : 'Awaiting AI analysis'}
              </h2>
              <p className="mt-1 max-w-3xl text-sm text-slate-ink">
                {match.errorMessage ||
                  'This job is saved. Connect an analysis API to fill score, skills, and recommendation fields. JobPilot does not generate stand-in production scores locally.'}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Pill tone="pending">{match.analysisStatus}</Pill>
                {resume && <Pill>{resume.versionLabel}</Pill>}
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
            <p className="mt-3 text-sm text-slate-ink">
              Resume: {resume?.versionLabel ?? 'No resume attached'}
            </p>
            <p className="text-sm text-slate-ink">Added {formatDate(match.createdAt)}</p>
            {job.jobUrl && (
              <a className="mt-2 text-sm font-semibold text-pine" href={job.jobUrl} target="_blank" rel="noreferrer">
                Open posting
              </a>
            )}
          </div>
          <div className="mt-6 space-y-3">
            <Dimension label="Experience match" value={match.experienceMatch} />
            <Dimension label="Education match" value={match.educationMatch} />
            <Dimension label="Location match" value={match.locationMatch} />
          </div>
          <div className="mt-6 rounded-2xl bg-paper p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-ink">
              Work authorization considerations
            </p>
            <p className="mt-2 text-sm text-ink">
              {match.workAuthorizationNotes || 'Will be filled when the analysis API returns a result.'}
            </p>
          </div>
          {application && (
            <Button
              className="mt-5 w-full"
              variant="secondary"
              onClick={() => void updateApplication(application.id, { status: 'applied' })}
              disabled={application.status !== 'ready'}
            >
              Mark as applied
            </Button>
          )}
        </Card>

        <div className="space-y-6">
          <Card className="p-6">
            <h2 className="font-display text-2xl text-navy">Skills</h2>
            <div className="mt-5 grid gap-5 md:grid-cols-3">
              <SkillColumn title="Matched" tone="strong" items={match.skillsMatched} empty="None yet" />
              <SkillColumn title="Partially matched" tone="review" items={match.skillsPartial} empty="None yet" />
              <SkillColumn title="Missing" tone="skip" items={match.skillsMissing} empty="None listed" />
            </div>
          </Card>

          <div className="grid gap-6 md:grid-cols-2">
            <Card className="p-6">
              <h2 className="flex items-center gap-2 font-display text-2xl text-navy">
                <Sparkles size={18} className="text-pine" />
                Strengths
              </h2>
              <List items={match.strengths} empty="Strengths will appear after analysis." />
            </Card>
            <Card className="p-6">
              <h2 className="flex items-center gap-2 font-display text-2xl text-navy">
                <Ban size={18} className="text-clay" />
                Concerns
              </h2>
              <List items={match.concerns} empty="Concerns will appear after analysis." />
            </Card>
          </div>

          <Card className="p-6">
            <h2 className="font-display text-2xl text-navy">Job description</h2>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-ink">{job.description}</p>
          </Card>
        </div>
      </div>
    </div>
  )
}

function Dimension({ label, value }: { label: string; value: DimensionMatch | null }) {
  return (
    <div className="rounded-2xl border border-line px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold">{label}</p>
        <p className="font-display text-xl text-navy">{value?.score ?? '—'}</p>
      </div>
      <p className="mt-1 text-sm text-slate-ink">
        {value?.summary ?? 'Pending analysis API output.'}
      </p>
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
      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-slate-ink">{title}</p>
      <div className="flex flex-wrap gap-2">
        {items.length === 0 && <p className="text-sm text-slate-ink">{empty}</p>}
        {items.map((item) => (
          <span key={`${title}-${item.name}`} className="block">
            <Pill tone={tone}>{item.name}</Pill>
            {item.note && <p className="mt-1 text-xs text-slate-ink">{item.note}</p>}
          </span>
        ))}
      </div>
    </div>
  )
}

function List({ items, empty }: { items: string[]; empty: string }) {
  if (!items.length) return <p className="mt-3 text-sm text-slate-ink">{empty}</p>
  return (
    <ul className="mt-3 space-y-2 text-sm text-ink">
      {items.map((item) => (
        <li key={item} className="rounded-xl bg-paper px-3 py-2">
          {item}
        </li>
      ))}
    </ul>
  )
}
