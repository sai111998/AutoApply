import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Check, Download, Pencil, RefreshCw, Sparkles } from 'lucide-react'
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
import {
  MASTER_RESUME_OPTION_ID,
  buildSelectableResumeOptions,
  createEditedResumeVersion,
  formatScoreDelta,
  nextTailoredVersionName,
  pdfContentForSelection,
  scoreChangeMessage,
} from '@/lib/application-selection'
import { formatDate } from '@/lib/format'
import { planFromMatch } from '@/lib/tailor-plan'
import {
  claimAutoStart,
  findActiveVersion,
  getInflightGeneration,
  isStaleGenerating,
  markGeneratingFailed,
  releaseAutoStart,
  shouldAutoStartGeneration,
  startTailorGeneration,
  tailorSessionKey,
  USER_TAILOR_ERROR,
} from '@/lib/tailor-session'
import { userFacingPersistError } from '@/lib/persist-errors'
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
    applications,
    resumeVersions = [],
    saveResumeVersion,
    selectResumeForJob,
    analyzeTailoredVersion,
    historyError,
  } = useWorkspace()

  const match = matches.find((item) => item.id === matchId)
  const job = match ? jobs.find((item) => item.id === match.jobId) : undefined
  const resume = match?.resumeId
    ? resumes.find((item) => item.id === match.resumeId)
    : resumes.find((item) => item.isMaster)
  const application = job ? applications.find((item) => item.jobId === job.id) : undefined

  const [tick, setTick] = useState(0)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<TailoredResumeContent | null>(null)
  const [compare, setCompare] = useState<'original' | 'tailored' | 'split'>('split')
  const [busy, setBusy] = useState<'keep' | 'save' | 'analyze' | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [updatedMatch, setUpdatedMatch] = useState<JobMatch | null>(null)
  const [previewOptionId, setPreviewOptionId] = useState<string | null>(null)
  const scoringIds = useRef(new Set<string>())

  const canTailor = Boolean(resume?.parsedText.trim() && job?.description.trim() && match?.analysisStatus === 'complete')
  const sessionKey = user && resume && job ? tailorSessionKey(user.id, resume.id, job.id) : ''
  const inflight = sessionKey ? getInflightGeneration(sessionKey) : null
  const storedVersion = resume && job ? findActiveVersion(resumeVersions, resume.id, job.id) : null
  const version =
    inflight != null
      ? resumeVersions.find((item) => item.id === inflight.versionId) ?? storedVersion
      : storedVersion

  const previewPlan = useMemo(
    () =>
      match && resume
        ? planFromMatch(match, resume.parsedText)
        : { skillsToEmphasize: [], relatedSkills: [], missingSkills: [], experienceToEmphasize: [] },
    [match, resume],
  )
  const plan = version?.tailoringSummary?.skillsToEmphasize?.length ? version.tailoringSummary : previewPlan
  const staleGenerating = isStaleGenerating(version)
  const generating = Boolean(inflight) || (version?.status === 'generating' && !staleGenerating)
  const failed = (version?.status === 'failed' || staleGenerating) && !inflight

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

  const options = useMemo(
    () =>
      resume && job
        ? buildSelectableResumeOptions({
            masterResume: resume,
            versions: resumeVersions,
            matches,
            sourceResumeId: resume.id,
            jobId: job.id,
            application,
            originalMatch: match ?? null,
          })
        : [],
    [application, job, match, matches, resume, resumeVersions],
  )

  const selectedOption = options.find((item) => item.isSelected) ?? options[0] ?? null
  const previewOption =
    options.find((item) => item.id === previewOptionId) ??
    options.find((item) => item.id === (inflight?.versionId ?? version?.id)) ??
    selectedOption
  const previewVersion = previewOption?.version ?? null
  const tailored = draft ?? previewOption?.content ?? null
  const original = previewVersion?.originalContent ?? options.find((item) => item.content)?.content ?? null
  const complete = Boolean(options.some((item) => item.versionId) && !editing)
  const previewComparisonMatch =
    updatedMatch && updatedMatch.resumeVersionId === previewVersion?.id
      ? updatedMatch
      : previewOption?.matchId
        ? matches.find((item) => item.id === previewOption.matchId) ?? null
        : null
  const selectedComparisonMatch = selectedOption?.matchId
    ? matches.find((item) => item.id === selectedOption.matchId) ?? null
    : null

  function startGeneration(force: boolean) {
    if (!user || !resume || !job || !match || !canTailor) return
    if (!force && inflight) return
    const existing = findActiveVersion(resumeVersions, resume.id, job.id)
    if (!force && !shouldAutoStartGeneration(resumeVersions, resume.id, job.id, user.id)) return
    if (force) releaseAutoStart(sessionKey)
    else claimAutoStart(sessionKey)
    const jobVersions = resumeVersions.filter((item) => item.sourceResumeId === resume.id && item.jobId === job.id)
    startTailorGeneration({
      userId: user.id,
      sourceResumeId: resume.id,
      jobId: job.id,
      analysisId: match.id,
      versionName: nextTailoredVersionName(jobVersions, job.title),
      payload: requestPayload,
      persist: saveResumeVersion,
      force,
      existingVersionId: force ? undefined : existing?.status === 'generating' ? existing.id : undefined,
      existingGenerationId: force ? undefined : existing?.status === 'generating' ? existing.generationId : undefined,
    })
    setEditing(false)
    setDraft(null)
    setMessage(null)
    setPreviewOptionId(null)
    setTick((value) => value + 1)
  }

  useEffect(() => {
    if (!user || !resume || !job || !match || !canTailor) return
    if (historyError?.startsWith('resume versions:')) return
    const existing = findActiveVersion(resumeVersions, resume.id, job.id)
    if (existing?.status === 'generating' && isStaleGenerating(existing) && !getInflightGeneration(sessionKey)) {
      void saveResumeVersion(markGeneratingFailed(existing))
      return
    }
    if (shouldAutoStartGeneration(resumeVersions, resume.id, job.id, user.id)) {
      startGeneration(false)
    }
    // startGeneration reads latest workspace via persist callback
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canTailor, job?.id, match?.id, resume?.id, user?.id, historyError])

  useEffect(() => {
    if (!inflight) return
    let cancelled = false
    const timer = window.setInterval(() => setTick((value) => value + 1), 700)
    void inflight.promise.finally(() => {
      if (!cancelled) {
        setTick((value) => value + 1)
        setDraft(null)
        setPreviewOptionId(inflight.versionId)
      }
    })
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [inflight])

  useEffect(() => {
    if (!match || !job || busy === 'analyze') return
    const pending = resumeVersions.filter(
      (item) =>
        item.jobId === job.id &&
        (item.status === 'completed' || item.status === 'kept' || item.status === 'edited') &&
        !item.comparisonAnalysisId &&
        item.resumeContent?.summary &&
        !scoringIds.current.has(item.id),
    )
    if (!pending.length) return
    for (const item of pending) {
      scoringIds.current.add(item.id)
      void analyzeTailoredVersion(item.id, match.id, { select: false, version: item })
        .then((next) => setUpdatedMatch(next))
        .catch((error: unknown) => {
          setMessage(userFacingPersistError(error, 'The match score could not be updated.'))
        })
    }
  }, [analyzeTailoredVersion, busy, job, match, resumeVersions])

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
  const previewScore = previewOption?.matchScore ?? previewComparisonMatch?.overallScore ?? null
  const comparison = scoreChange(match.overallScore, previewScore)
  const comparisonLabel = previewOption?.isSelected ? 'Selected resume match' : `${previewOption?.name ?? 'Resume'} match`
  const stepIndex = inflight ? Math.min(PROGRESS_STEPS.length - 1, Math.floor((Date.now() - inflight.startedAt) / 900)) : generating ? 1 : 0
  const selectedLabel = selectedOption?.name ?? 'Master Resume'

  async function onUseVersion(optionId: string) {
    if (!job) return
    const option = options.find((item) => item.id === optionId)
    if (!option) return
    setBusy('keep')
    setMessage(null)
    setPreviewOptionId(option.id)
    try {
      if (option.version && option.matchScore == null && match) {
        setBusy('analyze')
        const next = await analyzeTailoredVersion(option.version.id, match.id, { select: false, version: option.version })
        setUpdatedMatch(next)
      }
      await selectResumeForJob({
        jobId: job.id,
        resumeVersionId: option.versionId,
      })
      notify('Resume saved.')
    } catch (error) {
      setMessage(userFacingPersistError(error, 'Could not keep the resume.'))
    } finally {
      setBusy(null)
    }
  }

  async function onSaveEdits() {
    if (!previewVersion || !draft || !resume || !match || !job) return
    setBusy('save')
    setMessage(null)
    try {
      const siblings = resumeVersions.filter((item) => item.sourceResumeId === resume.id && item.jobId === job.id)
      const saved: ResumeVersion = createEditedResumeVersion(previewVersion, draft, job.title, siblings)
      await saveResumeVersion(saved)
      setEditing(false)
      setDraft(null)
      setPreviewOptionId(saved.id)
      setBusy('analyze')
      const next = await analyzeTailoredVersion(saved.id, match.id, { select: false, version: saved })
      setUpdatedMatch(next)
      notify('Edited tailored resume saved. Master resume is unchanged.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save your edits.')
    } finally {
      setBusy(null)
    }
  }

  async function onDownload() {
    const content = pdfContentForSelection(options, activeContent ? sanitizeTailoredContent(activeContent) : null)
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
          <Button type="button" variant="secondary" onClick={() => navigate(`/matches/${match.id}`)}>
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
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Original match</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <ScoreBadge score={match.overallScore} />
            <RecommendationBadge value={match.recommendation} />
          </div>
          <p className="mt-3 text-sm text-muted">{match.overallScore ?? '—'} / 100</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Current / selected resume</p>
          <h2 className="mt-2 text-lg font-semibold text-charcoal">{selectedLabel}</h2>
          <p className="text-sm text-muted">{resume.fileName}</p>
          <p className="text-sm text-muted">Updated {formatDate(resume.createdAt)}</p>
          {resume.isMaster && <p className="mt-2 text-xs font-semibold text-olive">Master — will not be overwritten</p>}
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
          Your resume has been updated. Recalculating your match...
        </div>
      )}

      {message && (
        <div className="mt-6 rounded-2xl border border-[#ead5cf] bg-[#fdf7f5] px-4 py-3 text-sm text-danger">{message}</div>
      )}

      {failed && !options.some((item) => item.versionId) && (
        <Card className="mt-6 p-6">
          <h2 className="text-lg font-semibold text-charcoal">Resume tailoring failed.</h2>
          <p className="mt-2 text-sm text-muted">{version?.warnings[0] || USER_TAILOR_ERROR}</p>
          <Button type="button" className="mt-4" onClick={() => startGeneration(true)}>
            <RefreshCw size={16} />
            Try Again
          </Button>
        </Card>
      )}

      {comparison && options.some((item) => item.versionId) && (
        <Card className="mt-6 p-6">
          <h2 className="text-lg font-semibold text-charcoal">Match comparison</h2>
          <p className="mt-1 text-sm text-muted">Scores come from the match engine. A tailored resume is not assumed to be better.</p>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <ScoreStat label="Original match" value={comparison.previous} />
            <ScoreStat label={comparisonLabel} value={comparison.updated} highlight />
            <ScoreStat
              label="Change"
              value={comparison.delta}
              display={formatScoreDelta(comparison.delta)}
              suffix=""
            />
          </div>
          <p className="mt-4 text-sm text-charcoal">{scoreChangeMessage(comparison.delta)}</p>
          {selectedComparisonMatch && (
            <Button type="button" className="mt-5" variant="secondary" onClick={() => navigate(`/matches/${selectedComparisonMatch.id}`)}>
              View selected match results
            </Button>
          )}
          {match.analysisSource === 'sample' && (
            <p className="mt-3 text-xs text-muted">
              The original score is from the saved match report. The updated score is from the live match engine on this tailored resume.
            </p>
          )}
        </Card>
      )}

      {(complete || options.length > 1) && (
        <Card className="mt-6 overflow-hidden">
          <div className="border-b border-line px-6 py-4">
            <h2 className="text-lg font-semibold text-charcoal">Resume versions</h2>
            <p className="text-sm text-muted">Every version stays available until you delete it. Choose which one this application should use.</p>
          </div>
          <ul className="divide-y divide-fog">
            {options.map((option) => (
              <li
                key={option.id}
                className={`flex flex-col gap-3 px-6 py-4 lg:flex-row lg:items-center lg:justify-between ${
                  option.isSelected ? 'bg-olive-soft/70' : previewOption?.id === option.id ? 'bg-canvas' : 'bg-white'
                }`}
              >
                <button type="button" className="text-left" onClick={() => setPreviewOptionId(option.id)}>
                  <p className="flex items-center gap-2 font-semibold text-charcoal">
                    {option.isSelected && <Check size={16} className="text-olive" />}
                    {option.name}
                  </p>
                  <p className="mt-1 text-sm text-muted">Match {option.matchScore != null ? `${option.matchScore}%` : 'Pending'}</p>
                  <p className="mt-1 text-xs font-semibold uppercase tracking-[0.12em] text-muted">{option.origin}</p>
                </button>
                <div className="flex flex-wrap items-center gap-2">
                  {option.isSelected ? (
                    <span className="inline-flex items-center rounded-xl bg-olive px-3 py-2 text-sm font-semibold text-white">
                      Selected
                    </span>
                  ) : (
                    <Button type="button" onClick={() => void onUseVersion(option.id)} disabled={busy !== null}>
                      Use This Resume
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {(complete || editing) && activeContent && (
        <>
          {!editing && (
            <div className="sticky top-3 z-10 mt-6 rounded-2xl border border-line bg-white/95 p-4 shadow-[0_8px_18px_rgb(85,99,56,0.08)] backdrop-blur">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Primary actions</p>
                  <p className="mt-1 text-sm text-charcoal">
                    Previewing {previewOption?.name ?? 'resume'}. Use This Resume updates the application.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {previewOption?.isSelected ? (
                    <span className="inline-flex items-center rounded-xl bg-olive px-3 py-2 text-sm font-semibold text-white">
                      Keep This Resume
                    </span>
                  ) : (
                    <Button type="button" onClick={() => void onUseVersion(previewOption?.id ?? MASTER_RESUME_OPTION_ID)} disabled={busy !== null}>
                      Keep This Resume
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={!previewVersion}
                    onClick={() => {
                      if (!activeContent) return
                      setDraft(structuredClone(activeContent))
                      setEditing(true)
                    }}
                  >
                    <Pencil size={16} />
                    Edit Resume
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => startGeneration(true)} disabled={Boolean(inflight)}>
                    <RefreshCw size={16} />
                    Regenerate
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => void onDownload()}>
                    <Download size={16} />
                    Download PDF
                  </Button>
                </div>
              </div>
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-charcoal">Tailored resume preview</h2>
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
                <Button type="button" onClick={() => void onSaveEdits()} disabled={busy !== null}>
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
            <div className={`mt-4 grid gap-4 ${compare === 'split' && original ? 'lg:grid-cols-2' : ''}`}>
              {(compare === 'split' || compare === 'original') && original && (
                <ResumeDocument title="Original resume" resume={original} muted />
              )}
              {(compare === 'split' || compare === 'tailored') && (
                <ResumeDocument
                  title={previewOption?.id === MASTER_RESUME_OPTION_ID ? 'Master resume' : 'Tailored resume'}
                  resume={activeContent}
                  highlight={previewOption?.id !== MASTER_RESUME_OPTION_ID}
                />
              )}
            </div>
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
  display,
}: {
  label: string
  value: number
  highlight?: boolean
  prefix?: string
  suffix?: string
  display?: string
}) {
  return (
    <div className={`rounded-2xl px-4 py-3 ${highlight ? 'bg-olive-soft' : 'bg-canvas'}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">{label}</p>
      <p className="mt-1 font-display text-3xl text-charcoal">
        {display ?? `${prefix}${value}${suffix}`}
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
