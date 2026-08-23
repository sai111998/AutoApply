import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Ban, CircleAlert, LoaderCircle, Sparkles } from 'lucide-react'
import { Card, PageHeader } from '@/components/ui/Card'
import { Pill, RecommendationBadge } from '@/components/ui/Badge'
import { ScoreRing } from '@/components/ui/ScoreRing'
import { Button } from '@/components/ui/Button'
import { useWorkspace } from '@/context/WorkspaceContext'
import { formatDate } from '@/lib/format'
import type { MatchReport, SkillAssessment } from '@/lib/ai/types'
import type { DimensionMatch, SkillSignal } from '@/types/domain'

export function MatchResultsPage() {
  const { matchId } = useParams()
  const navigate = useNavigate()
  const { matches, jobs, resumes, applications, updateApplication } = useWorkspace()
  const match = matches.find((item) => item.id === matchId)
  const job = match ? jobs.find((item) => item.id === match.jobId) : undefined
  const resume = match?.resumeId ? resumes.find((item) => item.id === match.resumeId) : undefined
  const application = match ? applications.find((item) => item.matchId === match.id) : undefined
  const report = match?.report ?? null

  if (!match || !job) {
    return (
      <Card className="p-10 text-center">
        <h2 className="font-display text-2xl text-navy">No match result yet</h2>
        <p className="mt-2 text-slate-ink">That analysis is empty or was not found in this workspace.</p>
        <Link className="mt-4 inline-block font-semibold text-pine" to="/analyze">
          Analyze a job
        </Link>
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

      {loading && (
        <Card className="mb-6 p-6">
          <div className="flex items-start gap-3">
            <LoaderCircle className="animate-spin text-pine" />
            <div>
              <h2 className="font-semibold text-navy">Analyzing</h2>
              <p className="mt-1 max-w-3xl text-sm text-slate-ink">
                Extracting resume and job evidence, then scoring. No substitute score is invented while this runs.
              </p>
            </div>
          </div>
        </Card>
      )}

      {failed && (
        <Card className="mb-6 p-6">
          <div className="flex items-start gap-3">
            <CircleAlert className="text-clay" />
            <div>
              <h2 className="font-semibold text-navy">Analysis did not complete</h2>
              <p className="mt-1 max-w-3xl text-sm text-slate-ink">
                {match.errorMessage || 'The analysis API returned an error. No substitute score was invented.'}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Pill tone="skip">{match.analysisStatus}</Pill>
                <Link className="text-sm font-semibold text-pine" to="/analyze">
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
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-ink">Match score</p>
            <p className="font-display text-4xl text-navy">
              {match.overallScore ?? '—'} <span className="text-2xl text-slate-ink">/ 100</span>
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-sm text-slate-ink">Recommendation</span>
              <RecommendationBadge value={match.recommendation} />
              <span className="text-sm text-slate-ink">Confidence</span>
              <Pill tone={match.confidence === 'HIGH' ? 'strong' : match.confidence === 'MEDIUM' ? 'review' : 'pending'}>
                {match.confidence ?? '—'}
              </Pill>
            </div>
            <p className="mt-3 text-sm text-slate-ink">
              Resume: {resume?.versionLabel ?? 'No resume attached'} · Added {formatDate(match.createdAt)}
            </p>
            <p className="mt-2 max-w-2xl text-xs text-slate-ink">
              This is a fit recommendation from the supplied resume and job description. It is not a hiring or interview
              prediction.
            </p>
            {job.jobUrl && (
              <a className="mt-2 inline-block text-sm font-semibold text-pine" href={job.jobUrl} target="_blank" rel="noreferrer">
                Open posting
              </a>
            )}
          </div>
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
            report
              ? [...report.requiredSkills.missing, ...report.preferredSkills.missing]
              : match.skillsMissing
          }
          empty="No missing requirements were listed."
        />

        <Card className="p-6">
          <h2 className="font-display text-2xl text-navy">Experience fit</h2>
          <ExperienceBlock report={report} fallback={match.experienceMatch} />
        </Card>

        <Card className="p-6">
          <h2 className="font-display text-2xl text-navy">Responsibility fit</h2>
          {report ? (
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <MiniList title="Strongly aligned" items={report.responsibilities.strongMatches} empty="None evidenced." />
              <MiniList title="Partially aligned" items={report.responsibilities.partialMatches} empty="None evidenced." />
              <MiniList title="Major gaps" items={report.responsibilities.gaps} empty="None listed." />
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-ink">
              This older record does not include a structured responsibility comparison.
            </p>
          )}
        </Card>

        <div className="grid gap-6 md:grid-cols-2">
          <Card className="p-6">
            <h2 className="flex items-center gap-2 font-display text-2xl text-navy">
              <Sparkles size={18} className="text-pine" />
              Strengths
            </h2>
            <List items={match.strengths.slice(0, 5)} empty="No strengths returned yet." />
          </Card>
          <Card className="p-6">
            <h2 className="flex items-center gap-2 font-display text-2xl text-navy">
              <Ban size={18} className="text-clay" />
              Concerns
            </h2>
            <List items={match.concerns} empty="No concerns returned yet." />
          </Card>
        </div>

        <Card className="p-6">
          <h2 className="font-display text-2xl text-navy">Education and certifications</h2>
          <p className="mt-3 text-sm text-ink">{report?.education.details || match.educationMatch?.summary || 'Not included in this record.'}</p>
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
            <h2 className="font-display text-2xl text-navy">Insufficient evidence</h2>
            <List items={report?.missingEvidence ?? []} empty="" />
          </Card>
        )}

        {match.summary && (
          <Card className="p-6">
            <h2 className="font-display text-2xl text-navy">AI summary</h2>
            <p className="mt-3 text-sm leading-6 text-ink">{match.summary}</p>
          </Card>
        )}

        <Card className="p-6">
          <h2 className="font-display text-2xl text-navy">Job description</h2>
          {job.description.trim() ? (
            <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-ink">{job.description}</p>
          ) : (
            <p className="mt-3 text-sm text-slate-ink">No job description was stored for this role.</p>
          )}
          {application && (
            <Button
              className="mt-5"
              variant="secondary"
              onClick={() => void updateApplication(application.id, { status: 'applied' })}
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
    return <p className="mt-3 text-sm text-slate-ink">{fallback?.summary ?? 'Pending analysis output.'}</p>
  }
  return (
    <dl className="mt-4 grid gap-3 text-sm md:grid-cols-3">
      <div className="rounded-2xl bg-paper px-4 py-3">
        <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-ink">Job requirement</dt>
        <dd className="mt-1 text-ink">{report.experience.jobRequirement || '—'}</dd>
      </div>
      <div className="rounded-2xl bg-paper px-4 py-3">
        <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-ink">Candidate evidence</dt>
        <dd className="mt-1 text-ink">{report.experience.candidateEvidence || '—'}</dd>
      </div>
      <div className="rounded-2xl bg-paper px-4 py-3">
        <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-ink">Gap</dt>
        <dd className="mt-1 text-ink">{report.experience.gap || report.experience.status.replaceAll('_', ' ')}</dd>
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
      <h2 className="font-display text-2xl text-navy">{title}</h2>
      <div className="mt-4 space-y-3">
        {items.length === 0 && <p className="text-sm text-slate-ink">{empty}</p>}
        {items.map((item) => {
          const name = item.name
          const source = 'source' in item ? item.source : undefined
          const evidence = 'evidence' in item ? item.evidence : item.note
          return (
            <div key={`${title}-${name}-${source ?? ''}`} className="rounded-2xl border border-line px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold text-navy">{name}</p>
                <Pill tone={tone}>{tone === 'strong' ? 'Strong match' : tone === 'review' ? 'Partial match' : 'Missing'}</Pill>
                {source && <Pill tone={source === 'required' ? 'info' : 'neutral'}>{source === 'required' ? 'Required' : 'Preferred'}</Pill>}
              </div>
              {evidence && <p className="mt-2 text-sm text-slate-ink">Evidence: {evidence}</p>}
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
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-ink">{title}</p>
      {items.length === 0 ? (
        <p className="text-sm text-slate-ink">{empty}</p>
      ) : (
        <ul className="space-y-2 text-sm text-ink">
          {items.map((item) => (
            <li key={item.name} className="rounded-xl bg-paper px-3 py-2">
              <p>{item.name}</p>
              {item.evidence && <p className="mt-1 text-xs text-slate-ink">Evidence: {item.evidence}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function List({ items, empty }: { items: string[]; empty: string }) {
  if (!items.length) return empty ? <p className="mt-3 text-sm text-slate-ink">{empty}</p> : null
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
