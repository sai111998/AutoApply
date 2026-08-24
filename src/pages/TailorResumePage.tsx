import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Download, Pencil, RefreshCw, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card, PageHeader } from '@/components/ui/Card'
import { EmptyState, ErrorState } from '@/components/ui/EmptyState'
import { Pill, RecommendationBadge, ScoreBadge } from '@/components/ui/Badge'
import { Tabs } from '@/components/ui/Tabs'
import { ResumeDocument } from '@/components/resume/ResumeDocument'
import { ResumeEditor } from '@/components/resume/ResumeEditor'
import { useToast } from '@/context/ToastContext'
import { useAuth } from '@/context/AuthContext'
import { useWorkspace } from '@/context/WorkspaceContext'
import { downloadResumePdfRequest } from '@/lib/ai/client'
import { formatDate } from '@/lib/format'
import { planFromMatch } from '@/lib/tailor-plan'
import {
  findActiveVersion,
  getInflightGeneration,
  isStaleGenerating,
  markGeneratingFailed,
  shouldStartGeneration,
  startTailorGeneration,
  tailorSessionKey,
  USER_TAILOR_ERROR,
} from '@/lib/tailor-session'
import { scoreChange, sanitizeTailoredContent } from '@/lib/tailored-text'
import type { JobMatch, ResumeVersion, TailoredResumeContent } from '@/types/domain'

const PROGRESS_STEPS = [
  'Reading resume',
  'Reviewing job requirements',
  'Optimizing relevant experience',
  'Preparing tailored version',
]

export function TailorResumePage() {
  const { matchId } = useParams()
  const navigate = useNavigate()
  const { notify } = useToast()
  const { user, isDemo } = useAuth()
  const {
    matches,
    jobs,
    resumes,
    resumeVersions = [],
    saveResumeVersion,
    selectResumeVersion,
    analyzeTailoredVersion,
  } = useWorkspace()

  const match = matches.find((item) => item.id === matchId)
  const job = match ? jobs.find((item) => item.id === match.jobId) : undefined
  const resume = match?.resumeId
    ? resumes.find((item) => item.id === match.resumeId)
    : resumes.find((item) => item.isMaster)

  const [tick, setTick] = useState(0)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<TailoredResumeContent | null>(null)
  const [compare, setCompare] = useState<'original' | 'tailored' | 'split'>('split')
  const [busy, setBusy] = useState<'keep' | 'save' | 'analyze' | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [updatedMatch, setUpdatedMatch] = useState<JobMatch | null>(null)
  const bootstrapped = useRef<string | null>(null)

  const canTailor = Boolean(resume?.parsedText.trim() && job?.description.trim() && match?.analysisStatus === 'complete')
  const sessionKey = user && resume && job ? tailorSessionKey(user.id, resume.id, job.id) : ''
  const inflight = sessionKey ? getInflightGeneration(sessionKey) : null
  const version = resume && job ? findActiveVersion(resumeVersions, resume.id, job.id) : null
  const comparisonMatch =
    updatedMatch ??
    (version?.comparisonAnalysisId
      ? matches.find((item) => item.id === version.comparisonAnalysisId) ?? null
      : null)

  const previewPlan = useMemo(
    () =>
      match && resume
        ? planFromMatch(match, resume.parsedText)
        : { skillsToEmphasize: [], relatedSkills: [], missingSkills: [], experienceToEmphasize: [] },
    [match, resume],
  )
  const plan = version?.tailoringSummary?.skillsToEmphasize?.length ? version.tailoringSummary : previewPlan
  const tailored = draft ?? (version?.status === 'generating' ? null : version?.resumeContent ?? null)
  const original = version?.originalContent ?? null
  const staleGenerating = isStaleGenerating(version)
  const generating = Boolean(inflight) || (version?.status === 'generating' && !staleGenerating)
  const failed = (version?.status === 'failed' || staleGenerating) && !inflight
  const complete = Boolean(tailored && (version?.status === 'completed' || version?.status === 'kept') && !editing)

  const requestPayload = useMemo(
    () => ({
      resumeText: resume?.parsedText ?? '',
      jobDescription: job?.description ?? '',
      userId: isDemo ? undefined : user?.id,
      resumeId: resume?.id,
      jobId: job?.id,
      matchId: match?.id,
      matchReport: match?.report ?? null,
      matchSignals: match
        ? {
            matched: match.skillsMatched.map((item) => item.name),
            partial: match.skillsPartial.map((item) => item.name),
            missing: match.skillsMissing.map((item) => item.name),
            strengths: match.strengths,
            experienceThemes: match.experienceMatch?.summary ? [match.experienceMatch.summary] : [],
          }
        : undefined,
    }),
    [isDemo, job, match, resume, user],
  )

  function startGeneration(force: boolean) {
    if (!user || !resume || !job || !match || !canTailor) return
    if (!force && inflight) return
    const existing = findActiveVersion(resumeVersions, resume.id, job.id)
    if (!shouldStartGeneration(existing, force) && !force) return
    startTailorGeneration({
      userId: user.id,
      sourceResumeId: resume.id,
      jobId: job.id,
      analysisId: match.id,
      versionName: `Tailored — ${job.title} — ${job.company}`,
      payload: requestPayload,
      persist: saveResumeVersion,
      force,
      existingVersionId: force ? undefined : existing?.status === 'generating' ? existing.id : undefined,
      existingGenerationId: force ? undefined : existing?.status === 'generating' ? existing.generationId : undefined,
    })
    setEditing(false)
    setDraft(null)
    setMessage(null)
    setTick((value) => value + 1)
  }

  useEffect(() => {
    if (!user || !resume || !job || !match || !canTailor) return
    const key = `${match.id}:${resume.id}`
    if (bootstrapped.current === key) return
    bootstrapped.current = key
    const existing = findActiveVersion(resumeVersions, resume.id, job.id)
    if (existing?.status === 'generating' && isStaleGenerating(existing) && !getInflightGeneration(sessionKey)) {
      void saveResumeVersion(markGeneratingFailed(existing))
      return
    }
    if (shouldStartGeneration(existing, false) || (existing?.status === 'generating' && !getInflightGeneration(sessionKey))) {
      startGeneration(false)
    }
    // startGeneration reads latest workspace via persist callback
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canTailor, job?.id, match?.id, resume?.id, user?.id])

  useEffect(() => {
    if (!inflight) return
    let cancelled = false
    const timer = window.setInterval(() => setTick((value) => value + 1), 700)
    void inflight.promise.finally(() => {
      if (!cancelled) {
        setTick((value) => value + 1)
        setDraft(null)
      }
    })
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [inflight])

  if (!match || !job) {
    return (
      <ErrorState
        title="Analyze a job before tailoring your resume."
        description="Open a completed match report, then choose Tailor Resume."
      />
    )
  }

  if (!resume?.parsedText.trim()) {
    return (
      <Card>
        <EmptyState
          title="Upload a resume before tailoring."
          description="Job Analysis uses a stored resume. Add one on Master Resume, then return here."
          action={
            <Link to="/resume" className="text-sm font-semibold text-olive">
              Go to Master Resume
            </Link>
          }
        />
      </Card>
    )
  }

  const activeContent = draft ?? tailored
  const comparison = scoreChange(match.overallScore, comparisonMatch?.overallScore ?? null)
  const stepIndex = inflight ? Math.min(PROGRESS_STEPS.length - 1, Math.floor((Date.now() - inflight.startedAt) / 900)) : generating ? 1 : 0

  async function onKeep() {
    if (!version || !match || version.status === 'generating') return
    setBusy('keep')
    setMessage(null)
    try {
      await selectResumeVersion(version.id)
      setBusy('analyze')
      const next = await analyzeTailoredVersion(version.id, match.id, { select: true })
      setUpdatedMatch(next)
      notify('Tailored resume kept. Master resume is unchanged.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not keep this resume.')
    } finally {
      setBusy(null)
    }
  }

  async function onSaveEdits() {
    if (!version || !draft || !resume || !match) return
    setBusy('save')
    setMessage(null)
    try {
      const saved: ResumeVersion = {
        ...version,
        resumeContent: sanitizeTailoredContent(draft),
        createdBy: 'user',
        status: version.isSelected ? 'kept' : 'completed',
        warnings: [...version.warnings.filter((item) => item !== 'user-edited'), 'user-edited'],
        updatedAt: new Date().toISOString(),
      }
      await saveResumeVersion(saved)
      setEditing(false)
      setDraft(null)
      setBusy('analyze')
      const next = await analyzeTailoredVersion(saved.id, match.id, {
        select: saved.isSelected,
        version: saved,
      })
      setUpdatedMatch(next)
      notify('Edited tailored resume saved. Master resume is unchanged.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save your edits.')
    } finally {
      setBusy(null)
    }
  }

  async function onDownload() {
    const content = activeContent ? sanitizeTailoredContent(activeContent) : null
    if (!content) return
    try {
      const blob = await downloadResumePdfRequest(content, content.contact)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${(content.contact.name || 'resume').replace(/\s+/g, '_')}_tailored.pdf`
      link.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not generate the PDF.', 'error')
    }
  }

  void tick

  return (
    <div>
      <PageHeader
        eyebrow="Resume studio"
        title="AI Resume Tailoring"
        description="A job-specific version of your stored resume. The master file is never replaced unless you keep a version."
        actions={
          <Button variant="secondary" onClick={() => navigate(`/matches/${match.id}`)}>
            <ArrowLeft size={16} />
            Match results
          </Button>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Job</p>
          <h2 className="mt-2 text-lg font-semibold text-charcoal">{job.title}</h2>
          <p className="text-sm text-muted">{job.company}</p>
          <p className="text-sm text-muted">{job.location || 'Location not specified'}</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Source resume</p>
          <h2 className="mt-2 text-lg font-semibold text-charcoal">{resume.versionLabel}</h2>
          <p className="text-sm text-muted">{resume.fileName}</p>
          <p className="text-sm text-muted">Updated {formatDate(resume.createdAt)}</p>
          {resume.isMaster && <p className="mt-2 text-xs font-semibold text-olive">Master — will not be overwritten</p>}
        </Card>
        <Card className="p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Original match</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <ScoreBadge score={match.overallScore} />
            <RecommendationBadge value={match.recommendation} />
          </div>
          {version?.createdBy === 'user' && <p className="mt-3 text-xs font-semibold text-olive">User-edited version</p>}
        </Card>
      </div>

      <Card className="mt-6 p-6">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-charcoal">
          <Sparkles size={18} className="text-olive" />
          Tailoring summary
        </h2>
        <p className="mt-1 text-sm text-muted">Missing job requirements stay gaps. They are not added to the resume.</p>
        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <PlanList title="Skills to emphasize" items={plan.skillsToEmphasize} tone="strong" empty="No overlapping skills yet." />
          <PlanList title="Related skills" items={plan.relatedSkills} tone="info" empty="No related skills listed." />
          <PlanList title="Experience to emphasize" items={plan.experienceToEmphasize} tone="info" empty="No overlapping themes yet." />
          <PlanList title="Potential gaps" items={plan.missingSkills} tone="review" empty="No unsupported requirements listed." />
        </div>
      </Card>

      {generating && (
        <Card className="mt-6 p-6">
          <p className="text-sm font-semibold text-olive-dark">Generating your tailored resume...</p>
          <p className="mt-1 text-sm text-muted">This usually takes less than a minute. Switching pages in JobPilot keeps this request running.</p>
          <ol className="mt-5 space-y-3">
            {PROGRESS_STEPS.map((label, index) => {
              const done = index < stepIndex
              const current = index === stepIndex
              return (
                <li key={label} className="flex items-center gap-3 text-sm">
                  <span
                    className={`grid h-6 w-6 place-items-center rounded-full text-xs font-semibold ${
                      done ? 'bg-olive text-white' : current ? 'border border-olive text-olive' : 'border border-line text-muted'
                    }`}
                  >
                    {done ? '✓' : current ? '●' : '○'}
                  </span>
                  <span className={done || current ? 'text-charcoal' : 'text-muted'}>{label}</span>
                </li>
              )
            })}
          </ol>
        </Card>
      )}

      {busy === 'analyze' && (
        <div className="mt-6 rounded-2xl border border-olive-border bg-olive-soft px-4 py-3 text-sm text-olive-dark">
          Your resume has been updated. Re-analyzing your match...
        </div>
      )}

      {message && (
        <div className="mt-6 rounded-2xl border border-[#ead5cf] bg-[#fdf7f5] px-4 py-3 text-sm text-danger">{message}</div>
      )}

      {failed && (
        <Card className="mt-6 p-6">
          <h2 className="text-lg font-semibold text-charcoal">Resume tailoring failed.</h2>
          <p className="mt-2 text-sm text-muted">{version?.warnings[0] || USER_TAILOR_ERROR}</p>
          <Button className="mt-4" onClick={() => startGeneration(true)}>
            <RefreshCw size={16} />
            Try Again
          </Button>
        </Card>
      )}

      {comparisonMatch && comparison && (
        <Card className="mt-6 p-6">
          <h2 className="text-lg font-semibold text-charcoal">Updated match score</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <ScoreStat label="Original match" value={comparison.previous} />
            <ScoreStat label="Updated match" value={comparison.updated} highlight />
            <ScoreStat
              label="Change"
              value={comparison.delta}
              prefix={comparison.delta > 0 ? '+' : ''}
              suffix=" points"
            />
          </div>
          <Button className="mt-5" onClick={() => navigate(`/matches/${comparisonMatch.id}`)}>
            View updated match results
          </Button>
          {match.analysisSource === 'sample' && (
            <p className="mt-3 text-xs text-muted">
              The original score is from the saved match report. The updated score is from the live match engine on this tailored resume.
            </p>
          )}
        </Card>
      )}

      {(complete || editing) && activeContent && (
        <>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-charcoal">Tailored resume</h2>
            {!editing && (
              <Tabs
                value={compare}
                onChange={(next) => setCompare(next as typeof compare)}
                items={[
                  { id: 'split', label: 'Compare' },
                  { id: 'original', label: 'Original' },
                  { id: 'tailored', label: 'Tailored' },
                ]}
              />
            )}
          </div>

          {editing && draft ? (
            <div className="mt-4 space-y-4">
              <ResumeEditor resume={draft} onChange={setDraft} />
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void onSaveEdits()} disabled={busy !== null}>
                  Save Changes
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setEditing(false)
                    setDraft(null)
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className={`mt-4 grid gap-4 ${compare === 'split' && original ? 'lg:grid-cols-2' : ''}`}>
                {(compare === 'split' || compare === 'original') && original && (
                  <ResumeDocument title="Original resume" resume={original} muted />
                )}
                {(compare === 'split' || compare === 'tailored') && (
                  <ResumeDocument title="Tailored resume" resume={activeContent} highlight />
                )}
              </div>
              <div className="mt-6 flex flex-wrap items-center gap-2">
                {version?.isSelected ? (
                  <span className="inline-flex items-center rounded-xl bg-olive-soft px-3 py-2 text-sm font-semibold text-olive-dark">
                    Selected for this job
                  </span>
                ) : (
                  <Button onClick={() => void onKeep()} disabled={busy !== null}>
                    Keep This Resume
                  </Button>
                )}
                <Button
                  variant="secondary"
                  onClick={() => {
                    setDraft(structuredClone(activeContent))
                    setEditing(true)
                  }}
                >
                  <Pencil size={16} />
                  Edit Resume
                </Button>
                <Button variant="secondary" onClick={() => startGeneration(true)} disabled={Boolean(inflight)}>
                  <RefreshCw size={16} />
                  Regenerate
                </Button>
                <Button variant="secondary" onClick={() => void onDownload()}>
                  <Download size={16} />
                  Download PDF
                </Button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

function ScoreStat({
  label,
  value,
  highlight,
  prefix = '',
  suffix = ' / 100',
}: {
  label: string
  value: number
  highlight?: boolean
  prefix?: string
  suffix?: string
}) {
  return (
    <div className={`rounded-2xl px-4 py-3 ${highlight ? 'bg-olive-soft' : 'bg-canvas'}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">{label}</p>
      <p className="mt-1 font-display text-3xl text-charcoal">
        {prefix}
        {value}
        {suffix}
      </p>
    </div>
  )
}

function PlanList({
  title,
  items,
  tone,
  empty,
}: {
  title: string
  items: string[]
  tone: 'strong' | 'review' | 'info'
  empty: string
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">{title}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {items.length === 0 && <p className="text-sm text-muted">{empty}</p>}
        {items.map((item) => (
          <Pill key={item} tone={tone}>
            {item}
          </Pill>
        ))}
      </div>
    </div>
  )
}
