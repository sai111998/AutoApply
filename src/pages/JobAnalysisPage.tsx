import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { FileText, Search, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card, PageHeader } from '@/components/ui/Card'
import { EmptyState, ErrorState, SkeletonBlock } from '@/components/ui/EmptyState'
import { Field, Select, TextArea, TextInput } from '@/components/ui/Field'
import { Pill, RecommendationBadge, ScoreBadge } from '@/components/ui/Badge'
import { Tabs } from '@/components/ui/Tabs'
import { useToast } from '@/context/ToastContext'
import { useWorkspace } from '@/context/WorkspaceContext'
import { getAnalysisHealth } from '@/lib/ai/client'
import { formatDate } from '@/lib/format'
import type { Job, JobMatch, Resume } from '@/types/domain'

const ANALYSIS_STEPS = ['Reading the posting', 'Comparing resume evidence', 'Scoring fit']

export function JobAnalysisPage() {
  const {
    analyzeJob,
    masterResume,
    resumes,
    profile,
    matches,
    jobs,
    historyLoading,
    historyError,
    refreshAnalyses,
    deleteAnalysis,
  } = useWorkspace()
  const navigate = useNavigate()
  const { notify } = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = searchParams.get('tab') === 'history' ? 'history' : 'new'

  const [title, setTitle] = useState('')
  const [company, setCompany] = useState('')
  const [location, setLocation] = useState('')
  const [jobUrl, setJobUrl] = useState('')
  const [description, setDescription] = useState('')
  const [resumeId, setResumeId] = useState(masterResume?.id ?? 'custom')
  const [resumeText, setResumeText] = useState(masterResume?.parsedText ?? '')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [progress, setProgress] = useState(8)
  const [step, setStep] = useState(0)
  const [llmConfigured, setLlmConfigured] = useState<boolean | null>(null)
  const [query, setQuery] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    void getAnalysisHealth().then((health) => setLlmConfigured(health.llmConfigured))
  }, [])

  useEffect(() => {
    void refreshAnalyses()
  }, [refreshAnalyses])

  useEffect(() => {
    if (resumeId === 'custom') return
    const selected = resumes.find((resume) => resume.id === resumeId)
    if (selected?.parsedText) setResumeText(selected.parsedText)
  }, [resumeId, resumes])

  useEffect(() => {
    if (!submitting) return
    setProgress(12)
    setStep(0)
    const timer = window.setInterval(() => {
      setStep((current) => (current < ANALYSIS_STEPS.length - 1 ? current + 1 : current))
      setProgress((current) => Math.min(90, current + 11))
    }, 900)
    return () => window.clearInterval(timer)
  }, [submitting])

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (submitting) return
    const jobDescription = description.trim()
    const resume = resumeText.trim()
    if (!jobDescription) {
      setError('Paste a job description to analyze.')
      return
    }
    if (!resume) {
      setError('Add resume text so the model has evidence to use.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const matchId = await analyzeJob({
        title,
        company,
        location,
        jobUrl,
        description: jobDescription,
        resumeText: resume,
        resumeId: resumeId === 'custom' ? null : resumeId,
      })
      notify('Analysis saved to your workspace.')
      navigate(`/matches/${matchId}`)
    } catch (analyzeError) {
      setError(analyzeError instanceof Error ? analyzeError.message : 'Could not analyze this job')
    } finally {
      setSubmitting(false)
    }
  }

  const history = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return [...matches]
      .sort((a, b) => (b.analyzedAt ?? b.createdAt).localeCompare(a.analyzedAt ?? a.createdAt))
      .map((match) => ({
        match,
        job: jobs.find((job) => job.id === match.jobId),
        resume: resumes.find((resume) => resume.id === match.resumeId),
      }))
      .filter((row) => row.job)
      .filter((row) => {
        if (!needle) return true
        return `${row.job?.title} ${row.job?.company} ${row.match.recommendation ?? ''}`.toLowerCase().includes(needle)
      })
  }, [jobs, matches, query, resumes])

  const resumeEmpty = !resumeText.trim()
  const jobEmpty = !description.trim()

  return (
    <div>
      <PageHeader
        eyebrow="Intake"
        title="Job Analysis"
        description="Compare a posting against resume text. Completed analyses are stored in Supabase and remain after you leave this page."
        actions={
          <Tabs
            value={tab}
            onChange={(next) => setSearchParams(next === 'history' ? { tab: 'history' } : {})}
            items={[
              { id: 'new', label: 'New analysis' },
              { id: 'history', label: 'History', count: matches.length },
            ]}
          />
        }
      />

      {historyError && (
        <div className="mb-6">
          <ErrorState title="Could not load or save history" description={historyError} onRetry={() => void refreshAnalyses()} />
        </div>
      )}

      {tab === 'history' ? (
        <HistoryPanel
          loading={historyLoading}
          error={historyError}
          rows={history}
          query={query}
          onQuery={setQuery}
          deletingId={deletingId}
          onDelete={async (matchId) => {
            setDeletingId(matchId)
            try {
              await deleteAnalysis(matchId)
              notify('Analysis removed.')
            } catch (deleteError) {
              notify(deleteError instanceof Error ? deleteError.message : 'Could not delete analysis', 'error')
            } finally {
              setDeletingId(null)
            }
          }}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1.4fr_0.8fr]">
          <Card className="p-6">
            {submitting && (
              <div className="mb-6 rounded-2xl border border-olive-border bg-olive-soft/70 p-4">
                <p className="text-sm font-semibold text-olive-dark">{ANALYSIS_STEPS[step]}</p>
                <p className="mt-1 text-sm text-muted">The model is using only the resume text you supplied.</p>
                <div className="progress-bar mt-3">
                  <span style={{ width: `${progress}%` }} />
                </div>
                <div className="mt-4 grid gap-2">
                  <SkeletonBlock className="h-3 w-5/6" />
                  <SkeletonBlock className="h-3 w-2/3" />
                </div>
              </div>
            )}
            <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => void onSubmit(event)}>
              <Field label="Job title">
                <TextInput required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Senior Frontend Engineer" />
              </Field>
              <Field label="Company">
                <TextInput required value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Acme" />
              </Field>
              <Field label="Location">
                <TextInput value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Remote (US)" />
              </Field>
              <Field label="Job URL">
                <TextInput type="url" value={jobUrl} onChange={(e) => setJobUrl(e.target.value)} placeholder="https://" />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Resume to compare">
                  <Select value={resumeId} onChange={(e) => setResumeId(e.target.value)}>
                    {resumes.map((resume) => (
                      <option key={resume.id} value={resume.id}>
                        {resume.versionLabel}
                        {resume.isMaster ? ' (master)' : ''}
                      </option>
                    ))}
                    <option value="custom">Paste custom resume text</option>
                  </Select>
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="Job description">
                  <TextArea
                    required
                    minLength={1}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Paste the full posting. Aim for the complete description rather than a one-line summary."
                  />
                </Field>
                <p className={`mt-1 text-xs ${description.trim().length < 120 ? 'text-warning' : 'text-muted'}`}>
                  {description.trim().length} characters
                  {description.trim().length < 120 ? ' — longer postings produce a more useful comparison.' : ''}
                </p>
              </div>
              <div className="sm:col-span-2">
                <Field label="Resume text">
                  <TextArea
                    required
                    minLength={1}
                    value={resumeText}
                    onChange={(e) => {
                      setResumeId('custom')
                      setResumeText(e.target.value)
                    }}
                    placeholder="Paste the resume text the model is allowed to use."
                  />
                </Field>
              </div>
              {error && <p className="sm:col-span-2 text-sm text-danger">{error}</p>}
              <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
                <Button type="submit" disabled={submitting || resumeEmpty || jobEmpty}>
                  {submitting ? 'Analyzing…' : 'Analyze'}
                </Button>
                {resumeEmpty && <span className="text-sm text-muted">Resume text is required before analysis.</span>}
              </div>
            </form>
          </Card>

          <div className="space-y-4">
            <Card className="p-6">
              <h2 className="text-lg font-semibold text-charcoal">Before you run it</h2>
              {resumeEmpty ? (
                <EmptyState
                  icon={<FileText size={18} />}
                  title="No resume text yet"
                  description="Select a stored resume with parsed text, or paste the resume content the model may use."
                />
              ) : (
                <div className="mt-3 space-y-3 text-sm text-muted">
                  <p>
                    Candidate: <span className="font-semibold text-charcoal">{profile.fullName || 'Unnamed'}</span>
                  </p>
                  <p>
                    Resume:{' '}
                    <span className="font-semibold text-charcoal">
                      {resumeId === 'custom'
                        ? 'Custom pasted text'
                        : resumes.find((resume) => resume.id === resumeId)?.versionLabel ?? masterResume?.versionLabel ?? 'None'}
                    </span>
                  </p>
                </div>
              )}
              <p
                className={`mt-4 rounded-xl px-3 py-2 text-sm ${
                  llmConfigured ? 'bg-olive-soft text-olive-dark' : 'bg-canvas text-charcoal'
                }`}
              >
                {llmConfigured
                  ? 'Server-side LLM key is configured.'
                  : llmConfigured === false
                    ? 'LLM_API_KEY is not set on the server. Analyses will return an error until you add it to .env.local.'
                    : 'Checking analysis API…'}
              </p>
            </Card>
            <Card className="p-6">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-charcoal">Recent history</h2>
                <button
                  type="button"
                  className="text-sm font-semibold text-olive hover:text-olive-dark"
                  onClick={() => setSearchParams({ tab: 'history' })}
                >
                  View all
                </button>
              </div>
              <div className="mt-4 space-y-2">
                {history.slice(0, 4).map(({ match, job }) => (
                  <Link
                    key={match.id}
                    to={`/matches/${match.id}`}
                    className="block rounded-xl border border-line px-3 py-3 transition hover:border-olive-border hover:bg-olive-soft/50"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-charcoal">{job?.title}</p>
                        <p className="text-xs text-muted">{job?.company}</p>
                      </div>
                      <ScoreBadge score={match.overallScore} />
                    </div>
                  </Link>
                ))}
                {history.length === 0 && (
                  <p className="text-sm text-muted">No saved analyses yet. Run one to build history.</p>
                )}
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}

function HistoryPanel({
  loading,
  error,
  rows,
  query,
  onQuery,
  deletingId,
  onDelete,
}: {
  loading: boolean
  error: string | null
  rows: { match: JobMatch; job?: Job; resume?: Resume }[]
  query: string
  onQuery: (value: string) => void
  deletingId: string | null
  onDelete: (matchId: string) => Promise<void>
}) {
  return (
    <div>
      <Card className="mb-5 p-4">
        <Field label="Search history">
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute top-3 left-3 text-muted" />
            <TextInput
              className="pl-9"
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              placeholder="Job title, company, or APPLY / REVIEW / SKIP"
            />
          </div>
        </Field>
      </Card>

      {loading && rows.length === 0 && (
        <div className="grid gap-3">
          <SkeletonBlock className="h-24" />
          <SkeletonBlock className="h-24" />
          <SkeletonBlock className="h-24" />
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <Card>
          <EmptyState
            icon={<FileText size={18} />}
            title="No analyses yet"
            description="Run a job analysis to store a match report. It will stay here after you switch pages, refresh, or sign back in."
            action={
              <Link to="/analyze" className="text-sm font-semibold text-olive">
                Start an analysis
              </Link>
            }
          />
        </Card>
      )}

      <div className="grid gap-3">
        {rows.map(({ match, job, resume }) => (
          <Card key={match.id} interactive className="p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">{job?.company}</p>
                <h2 className="mt-1 text-lg font-semibold text-charcoal">{job?.title}</h2>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
                  <span>{formatDate(match.analyzedAt ?? match.createdAt)}</span>
                  <span>·</span>
                  <span>{resume?.versionLabel ?? 'No stored resume'}</span>
                  {match.analysisSource === 'sample' && <Pill tone="review">Sample</Pill>}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <ScoreBadge score={match.overallScore} />
                <RecommendationBadge value={match.recommendation} />
                <Link
                  to={`/matches/${match.id}`}
                  className="inline-flex items-center rounded-xl bg-olive px-3 py-2 text-sm font-semibold text-white transition hover:bg-olive-dark"
                >
                  Open
                </Link>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={deletingId === match.id}
                  onClick={() => void onDelete(match.id)}
                >
                  <Trash2 size={15} />
                  {deletingId === match.id ? 'Removing…' : 'Delete'}
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
