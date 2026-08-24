import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Download, Pencil, RefreshCw, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card, PageHeader } from '@/components/ui/Card'
import { EmptyState, ErrorState, SkeletonBlock } from '@/components/ui/EmptyState'
import { Pill, RecommendationBadge, ScoreBadge } from '@/components/ui/Badge'
import { Tabs } from '@/components/ui/Tabs'
import { TextArea, TextInput } from '@/components/ui/Field'
import { useToast } from '@/context/ToastContext'
import { useAuth } from '@/context/AuthContext'
import { useWorkspace } from '@/context/WorkspaceContext'
import { ResumeDocument } from '@/components/resume/ResumeDocument'
import { downloadResumePdfRequest, tailorResumeRequest, validateTailoredResumeRequest } from '@/lib/ai/client'
import { createId, formatDate } from '@/lib/format'
import { planFromMatch } from '@/lib/tailor-plan'
import type { TailoredResumeContent, TailoringPlan } from '@/types/domain'

export function TailorResumePage() {
  const { matchId } = useParams()
  const navigate = useNavigate()
  const { notify } = useToast()
  const { user, isDemo } = useAuth()
  const { matches, jobs, resumes, saveResumeVersion, resumeVersions = [] } = useWorkspace()
  const match = matches.find((item) => item.id === matchId)
  const job = match ? jobs.find((item) => item.id === match.jobId) : undefined
  const resume = match?.resumeId ? resumes.find((item) => item.id === match.resumeId) : resumes.find((item) => item.isMaster)

  const previewPlan = useMemo(
    () => (match && resume ? planFromMatch(match, resume.parsedText) : {
      skillsToEmphasize: [],
      relatedSkills: [],
      missingSkills: [],
      experienceToEmphasize: [],
    }),
    [match, resume],
  )
  const [plan, setPlan] = useState<TailoringPlan>(previewPlan)
  const [original, setOriginal] = useState<TailoredResumeContent | null>(null)
  const [tailored, setTailored] = useState<TailoredResumeContent | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'complete' | 'invalid' | 'failed'>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [compare, setCompare] = useState<'original' | 'tailored' | 'split'>('split')
  const [saving, setSaving] = useState(false)

  const canTailor = Boolean(resume?.parsedText.trim() && job?.description.trim() && match?.analysisStatus === 'complete')

  const requestPayload = useMemo(
    () => ({
      resumeText: resume?.parsedText ?? '',
      jobDescription: job?.description ?? '',
      userId: isDemo ? undefined : user?.id,
      resumeId: resume?.id,
      jobId: job?.id,
      matchId: match?.id,
      candidateName: undefined,
      candidateEmail: undefined,
      candidateLocation: undefined,
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

  async function generate() {
    if (!canTailor) return
    setStatus('loading')
    setMessage(null)
    setEditing(false)
    try {
      const result = await tailorResumeRequest(requestPayload)
      setPlan((result.plan as TailoringPlan) ?? previewPlan)
      setOriginal((result.original as TailoredResumeContent) ?? null)
      setTailored((result.tailored as TailoredResumeContent) ?? null)
      setStatus((result.status as typeof status) || 'failed')
      setMessage(typeof result.message === 'string' ? result.message : null)
    } catch (error) {
      setStatus('failed')
      setMessage(error instanceof Error ? error.message : 'Resume tailoring failed.')
    }
  }

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

  async function onSave() {
    if (!tailored || !resume || !user || !job || !match || status !== 'complete') return
    setSaving(true)
    try {
      const check = await validateTailoredResumeRequest({ ...requestPayload, tailored })
      if (!check.ok) {
        setStatus('invalid')
        setMessage(
          typeof check.body.message === 'string'
            ? check.body.message
            : 'Some generated content could not be verified against your master resume. Please review and regenerate.',
        )
        return
      }
      const now = new Date().toISOString()
      await saveResumeVersion({
        id: createId(),
        userId: user.id,
        sourceResumeId: resume.id,
        jobId: job.id,
        analysisId: match.id,
        versionName: `Tailored — ${job.title} — ${job.company}`,
        resumeContent: tailored,
        tailoringSummary: plan,
        changes: tailored.changes,
        warnings: tailored.warnings,
        createdAt: now,
        updatedAt: now,
      })
      notify('Tailored resume saved as a new version. Master resume is unchanged.')
      navigate('/resume')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save this version.')
    } finally {
      setSaving(false)
    }
  }

  async function onDownload() {
    if (!tailored) return
    try {
      const blob = await downloadResumePdfRequest(tailored, tailored.contact)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${(tailored.contact.name || 'resume').replace(/\s+/g, '_')}_tailored.pdf`
      link.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not generate the PDF.', 'error')
    }
  }

  const savedCount = resumeVersions.filter((item) => item.analysisId === match.id).length

  return (
    <div>
      <PageHeader
        eyebrow="Resume studio"
        title="AI Resume Tailoring"
        description="Rewrite emphasis and wording from your stored resume. Nothing is invented, and the master file stays put until you save a version."
        actions={
          <Button variant="secondary" onClick={() => navigate(`/matches/${match.id}`)}>
            <ArrowLeft size={16} />
            Match results
          </Button>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Job information</p>
          <h2 className="mt-2 text-lg font-semibold text-charcoal">{job.title}</h2>
          <p className="text-sm text-muted">{job.company}</p>
          <p className="text-sm text-muted">{job.location || 'Location not specified'}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <ScoreBadge score={match.overallScore} />
            <RecommendationBadge value={match.recommendation} />
          </div>
        </Card>
        <Card className="p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Source resume</p>
          <h2 className="mt-2 text-lg font-semibold text-charcoal">{resume.versionLabel}</h2>
          <p className="text-sm text-muted">{resume.fileName}</p>
          <p className="text-sm text-muted">Updated {formatDate(resume.createdAt)}</p>
          {resume.isMaster && <p className="mt-2 text-xs font-semibold text-olive">Master — will not be overwritten</p>}
        </Card>
        <Card className="p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Versions for this role</p>
          <p className="mt-2 text-3xl font-semibold text-charcoal">{savedCount}</p>
          <p className="text-sm text-muted">Saved tailored copies. Master remains separate.</p>
        </Card>
      </div>

      <Card className="mt-6 p-6">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-charcoal">
          <Sparkles size={18} className="text-olive" />
          Tailoring summary
        </h2>
        <p className="mt-1 text-sm text-muted">Missing job requirements are listed as gaps, not as content to add.</p>
        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <PlanList title="Skills to emphasize" items={status === 'idle' ? previewPlan.skillsToEmphasize : plan.skillsToEmphasize} tone="strong" empty="No overlapping skills yet." />
          <PlanList title="Related skills" items={status === 'idle' ? previewPlan.relatedSkills : plan.relatedSkills} tone="info" empty="No related skills listed." />
          <PlanList title="Experience to emphasize" items={status === 'idle' ? previewPlan.experienceToEmphasize : plan.experienceToEmphasize} tone="info" empty="No overlapping themes yet." />
          <PlanList title="Potential gaps" items={status === 'idle' ? previewPlan.missingSkills : plan.missingSkills} tone="review" empty="No unsupported requirements listed." />
        </div>
        {status === 'idle' && (
          <div className="mt-6">
            <Button onClick={() => void generate()} disabled={!canTailor}>
              <Sparkles size={16} />
              Generate tailored resume
            </Button>
            <p className="mt-2 text-xs text-muted">
              The master resume is not changed until you approve and save a version.
            </p>
          </div>
        )}
      </Card>

      {status === 'loading' && (
        <Card className="mt-6 p-6">
          <p className="text-sm font-semibold text-olive-dark">Tailoring from the stored resume…</p>
          <div className="mt-4 grid gap-3">
            <SkeletonBlock className="h-4 w-5/6" />
            <SkeletonBlock className="h-4 w-2/3" />
            <SkeletonBlock className="h-40" />
          </div>
        </Card>
      )}

      {message && (
        <div className="mt-6 rounded-2xl border border-[#ead5cf] bg-[#fdf7f5] px-4 py-3 text-sm text-danger">{message}</div>
      )}

      {original && tailored && status === 'complete' && (
        <>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-charcoal">Preview</h2>
            <Tabs
              value={compare}
              onChange={(next) => setCompare(next as typeof compare)}
              items={[
                { id: 'split', label: 'Compare' },
                { id: 'original', label: 'Original' },
                { id: 'tailored', label: 'Tailored' },
              ]}
            />
          </div>

          <div className={`mt-4 grid gap-4 ${compare === 'split' ? 'lg:grid-cols-2' : ''}`}>
            {(compare === 'split' || compare === 'original') && (
              <ResumeDocument title="Original resume" resume={original} muted />
            )}
            {(compare === 'split' || compare === 'tailored') && (
              editing ? (
                <ResumeEditor resume={tailored} onChange={setTailored} />
              ) : (
                <ResumeDocument
                  title="Tailored resume"
                  resume={tailored}
                  highlight
                  changedSections={changedSections(original, tailored)}
                />
              )
            )}
          </div>

          <Card className="mt-6 p-6">
            <h2 className="text-lg font-semibold text-charcoal">Changes</h2>
            <ul className="mt-4 space-y-3">
              {tailored.changes.map((change) => (
                <li key={`${change.kind}-${change.label}`} className="rounded-2xl border border-line px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-olive">
                    {change.kind === 'emphasis' ? 'Added emphasis' : change.kind}
                  </p>
                  <p className="mt-1 text-sm text-charcoal">{change.label}</p>
                  {change.before && <p className="mt-1 text-sm text-muted">“{change.before}”</p>}
                  {change.after && <p className="text-sm text-charcoal">→ “{change.after}”</p>}
                </li>
              ))}
              {tailored.omissions.map((item) => (
                <li key={item} className="rounded-2xl border border-line px-4 py-3 text-sm text-muted">
                  Omitted from the resume: {item} (not supported by the master resume)
                </li>
              ))}
              {tailored.changes.length === 0 && tailored.omissions.length === 0 && (
                <li className="text-sm text-muted">No tracked edits yet.</li>
              )}
            </ul>
          </Card>

          <div className="mt-6 flex flex-wrap gap-2">
            <Button onClick={() => void onSave()} disabled={saving}>
              Approve & Save Version
            </Button>
            <Button variant="secondary" onClick={() => void generate()}>
              <RefreshCw size={16} />
              Regenerate
            </Button>
            <Button variant="secondary" onClick={() => setEditing((value) => !value)}>
              <Pencil size={16} />
              {editing ? 'Done editing' : 'Edit'}
            </Button>
            <Button variant="secondary" onClick={() => void onDownload()}>
              <Download size={16} />
              Download PDF
            </Button>
            <Button variant="ghost" onClick={() => navigate(`/matches/${match.id}`)}>
              Cancel
            </Button>
          </div>
        </>
      )}

      {(status === 'invalid' || status === 'failed') && (
        <div className="mt-6 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void generate()}>
            <RefreshCw size={16} />
            Regenerate
          </Button>
          <Button variant="ghost" onClick={() => navigate(`/matches/${match.id}`)}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  )
}

function changedSections(original: TailoredResumeContent, tailored: TailoredResumeContent): string[] {
  const sections: string[] = []
  if (original.summary !== tailored.summary) sections.push('summary')
  if (original.skills.join('|') !== tailored.skills.join('|')) sections.push('skills')
  if (JSON.stringify(original.experience) !== JSON.stringify(tailored.experience)) sections.push('experience')
  return sections
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

function ResumeEditor({
  resume,
  onChange,
}: {
  resume: TailoredResumeContent
  onChange: (next: TailoredResumeContent) => void
}) {
  return (
    <Card className="p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-olive">Edit tailored resume</p>
      <div className="mt-4 space-y-4">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Summary</span>
          <TextArea rows={4} value={resume.summary} onChange={(e) => onChange({ ...resume, summary: e.target.value })} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Skills (comma separated)</span>
          <TextInput
            value={resume.skills.join(', ')}
            onChange={(e) =>
              onChange({
                ...resume,
                skills: e.target.value.split(',').map((item) => item.trim()).filter(Boolean),
              })
            }
          />
        </label>
        {resume.experience.map((role, index) => (
          <label key={`${role.company}-${index}`} className="block text-sm">
            <span className="mb-1 block font-medium">
              {role.title} · {role.company}
            </span>
            <TextArea
              rows={5}
              value={role.bullets.join('\n')}
              onChange={(e) => {
                const experience = resume.experience.map((item, itemIndex) =>
                  itemIndex === index ? { ...item, bullets: e.target.value.split('\n').map((line) => line.trim()).filter(Boolean) } : item,
                )
                onChange({ ...resume, experience })
              }}
            />
          </label>
        ))}
      </div>
    </Card>
  )
}
