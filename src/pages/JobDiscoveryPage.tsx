import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Compass, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card, PageHeader } from '@/components/ui/Card'
import { EmptyState, ErrorState, SkeletonBlock } from '@/components/ui/EmptyState'
import { Field, Select, TextInput } from '@/components/ui/Field'
import { Pill } from '@/components/ui/Badge'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { useWorkspace } from '@/context/WorkspaceContext'
import {
  getLiveJobRequest,
  listLiveJobsRequest,
  previewLiveJobRequest,
  type DiscoveredJobResult,
  type LiveTailorPreviewResult,
} from '@/lib/ai/client'
import { applyUrl, discoveredToJob, mergeLiveJob } from '@/lib/discovered-job'
import { formatDate } from '@/lib/format'
import {
  employerApplyHref,
  jobMetaLine,
  liveMatch,
  sortDiscoveredJobs,
  topSkills,
  type LiveJobSort,
} from '@/lib/live-job'
import { matchBandLabel, matchBandTone } from '@/lib/match-band'

const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA',
  'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK',
  'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC',
]

const SENIORITY_OPTIONS = ['Entry', 'Mid', 'Senior', 'Lead', 'Manager', 'Director', 'Intern', 'Executive']

function normalizeListedJob(job: DiscoveredJobResult): DiscoveredJobResult {
  const url = applyUrl(job)
  const match = liveMatch(job)
  return {
    ...job,
    jobUrl: url,
    url,
    providerJobId: job.providerJobId || job.sourceJobId || null,
    sourceJobId: job.sourceJobId || job.providerJobId || null,
    discoveredAt: job.discoveredAt || job.fetchedAt || job.discoveredAt,
    fetchedAt: job.fetchedAt || job.discoveredAt,
    match,
    matchScore: match.score,
    matchedSkills: match.matchedSkills,
    missingSkills: match.missingSkills,
    demo: false,
  }
}

function ScoreDisplay({ score, size = 'md' }: { score: number | null; size?: 'sm' | 'md' }) {
  const tone = matchBandTone(score)
  const toneClass =
    tone === 'strong'
      ? 'text-olive-dark'
      : tone === 'review'
        ? 'text-warning'
        : tone === 'skip'
          ? 'text-danger'
          : 'text-muted'
  return (
    <div className={size === 'sm' ? 'text-right' : ''}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Resume Match</p>
      <p className={`font-semibold leading-none ${size === 'sm' ? 'mt-1 text-2xl' : 'mt-1 text-3xl'} ${toneClass}`}>
        {score == null ? '—' : `${score}%`}
      </p>
      <p className="mt-1 text-xs font-semibold text-muted">{score == null ? 'Add a resume to score' : matchBandLabel(score)}</p>
    </div>
  )
}

function SkillLine({ label, skills }: { label: string; skills: string[] }) {
  if (!skills.length) return null
  return (
    <p className="text-sm text-charcoal">
      <span className="font-semibold">{label}: </span>
      {skills.join(' • ')}
    </p>
  )
}

function ApplyNowLink({ href, className = '' }: { href: string | null; className?: string }) {
  if (!href) {
    return (
      <Button type="button" disabled>
        Apply Now
      </Button>
    )
  }
  return (
    <a
      className={`inline-flex items-center justify-center rounded-xl bg-olive px-4 py-2.5 text-sm font-semibold text-white shadow-[0_8px_18px_rgb(85,99,56,0.16)] transition hover:bg-olive-dark ${className}`}
      href={href}
      target="_blank"
      rel="noreferrer"
    >
      Apply Now
    </a>
  )
}

export function JobDiscoveryPage() {
  const { user, isDemo } = useAuth()
  const { profile, preferences, jobs, savedJobIds, saveDiscoveredJob, masterResume, resumes, loading: workspaceLoading } =
    useWorkspace()
  const { notify } = useToast()
  const navigate = useNavigate()

  const resume = masterResume ?? resumes[0] ?? null
  const [query, setQuery] = useState(profile.targetJobTitles[0] || preferences.targetRoles[0] || 'Java Software Engineer')
  const [location, setLocation] = useState('')
  const [state, setState] = useState('')
  const [remote, setRemote] = useState('any')
  const [employmentType, setEmploymentType] = useState('any')
  const [seniority, setSeniority] = useState('any')
  const [sort, setSort] = useState<LiveJobSort>('match')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [listed, setListed] = useState<DiscoveredJobResult[] | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [hydratingId, setHydratingId] = useState<string | null>(null)
  const [reviewing, setReviewing] = useState<DiscoveredJobResult | null>(null)
  const [preview, setPreview] = useState<LiveTailorPreviewResult | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  const visibleJobs = useMemo(() => (listed ? sortDiscoveredJobs(listed, sort, query) : null), [listed, query, sort])

  async function onSearch() {
    setLoading(true)
    setError(null)
    setWarning(null)
    try {
      const response = await listLiveJobsRequest({
        q: query.trim() || undefined,
        country: 'US',
        location: location.trim() || undefined,
        state: state || undefined,
        remote,
        employment_type: employmentType,
        seniority,
        page: 1,
        limit: 25,
        sort,
        resumeText: resume?.parsedText || undefined,
        resumeVersionId: resume?.id,
      })
      const rows = sortDiscoveredJobs(response.jobs.map(normalizeListedJob), sort, query)
      setListed(rows)
      setWarning(response.warning?.message ?? null)
      if (!rows.length) setExpandedId(null)
    } catch (searchError) {
      setListed([])
      setExpandedId(null)
      setError(searchError instanceof Error ? searchError.message : 'Live job source temporarily unavailable.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (workspaceLoading) return
    void onSearch()
    // Search once workspace (and selected resume) is ready so list scores can be computed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceLoading, resume?.id])

  async function onSave(job: DiscoveredJobResult) {
    if (!user) return
    setSavingId(job.id)
    try {
      await saveDiscoveredJob(discoveredToJob(job, user.id), { resumeVersionId: resume?.id ?? null })
      notify('Job saved. No application was created.', 'success')
    } catch (saveError) {
      notify(saveError instanceof Error ? saveError.message : 'Could not save the job.', 'error')
    } finally {
      setSavingId(null)
    }
  }

  async function hydrateJob(job: DiscoveredJobResult): Promise<DiscoveredJobResult> {
    if (!job.providerJobId) return job
    if (job.provider !== 'job-opportunities' && job.description?.trim()) return job
    setHydratingId(job.id)
    try {
      const fresh = await getLiveJobRequest(job.provider, job.providerJobId)
      const merged = normalizeListedJob(mergeLiveJob(job, normalizeListedJob(fresh)))
      setListed((current) => current?.map((item) => (item.id === job.id ? merged : item)) ?? current)
      return merged
    } catch {
      return job
    } finally {
      setHydratingId(null)
    }
  }

  async function onToggleDetails(job: DiscoveredJobResult) {
    if (expandedId === job.id) {
      setExpandedId(null)
      return
    }
    setExpandedId(job.id)
    await hydrateJob(job)
  }

  async function onReview(job: DiscoveredJobResult) {
    setReviewing(job)
    setPreview(null)
    setPreviewError(null)
    const hydrated = await hydrateJob(job)
    setReviewing(hydrated)
    const resumeText = resume?.parsedText?.trim() ?? ''
    if (!resumeText || !hydrated.description?.trim()) {
      setPreviewError(
        !resumeText
          ? 'Select a master resume to score and tailor this job.'
          : 'This listing does not include a job description to review.',
      )
      return
    }
    setPreviewLoading(true)
    try {
      const result = await previewLiveJobRequest({
        resumeText,
        resumeVersionId: resume?.id,
        job: hydrated,
      })
      setPreview(result)
    } catch (reviewError) {
      setPreviewError(reviewError instanceof Error ? reviewError.message : 'Could not preview the tailored resume match.')
    } finally {
      setPreviewLoading(false)
    }
  }

  function closeReview() {
    setReviewing(null)
    setPreview(null)
    setPreviewError(null)
  }

  async function onUseCurrentResume() {
    if (!reviewing) return
    await onSave(reviewing)
    notify('Current resume kept. Open Apply Now to continue on the employer site.', 'success')
  }

  async function onTailorResume() {
    if (!reviewing) return
    const hydrated = await hydrateJob(reviewing)
    closeReview()
    navigate('/analyze', { state: { liveJob: hydrated } })
  }

  const saved = (jobId: string) => savedJobIds.includes(jobId) || jobs.some((item) => item.id === jobId && savedJobIds.includes(item.id))

  return (
    <div>
      <PageHeader
        eyebrow="Live jobs"
        title="Live Jobs"
        description="See how your current resume matches live openings, then apply on the employer site or review a tailored version first."
      />

      {isDemo && (
        <div className="mb-6 rounded-2xl border border-olive-border bg-olive-soft px-4 py-3 text-sm text-olive-dark">
          Demo Data is still labeled in the workspace. Live provider results below are marked Live.
        </div>
      )}

      <Card className="p-5">
        <form
          className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"
          onSubmit={(event) => {
            event.preventDefault()
            void onSearch()
          }}
        >
          <Field label="Search">
            <TextInput
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Title, company, or keyword"
            />
          </Field>
          <Field label="Location">
            <TextInput
              value={location}
              onChange={(event) => setLocation(event.target.value)}
              placeholder="City"
            />
          </Field>
          <Field label="State">
            <Select value={state} onChange={(event) => setState(event.target.value)}>
              <option value="">Any US state</option>
              {US_STATES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Remote">
            <Select value={remote} onChange={(event) => setRemote(event.target.value)}>
              <option value="any">Any</option>
              <option value="remote">Remote</option>
              <option value="hybrid">Hybrid</option>
              <option value="onsite">On-site</option>
            </Select>
          </Field>
          <Field label="Employment type">
            <Select value={employmentType} onChange={(event) => setEmploymentType(event.target.value)}>
              <option value="any">Any</option>
              <option value="full-time">Full-time</option>
              <option value="part-time">Part-time</option>
              <option value="contract">Contract</option>
              <option value="temporary">Temporary</option>
              <option value="internship">Internship</option>
            </Select>
          </Field>
          <Field label="Seniority">
            <Select value={seniority} onChange={(event) => setSeniority(event.target.value)}>
              <option value="any">Any</option>
              {SENIORITY_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-end">
            <Button type="submit" disabled={loading}>
              {loading ? 'Loading live jobs…' : 'Search live jobs'}
            </Button>
          </div>
        </form>
      </Card>

      {warning && !error && (
        <div className="mt-4 rounded-2xl border border-line bg-canvas px-4 py-3 text-sm text-muted">{warning}</div>
      )}

      {error && (
        <div className="mt-4">
          <ErrorState title="Live job source temporarily unavailable." description={error} onRetry={() => void onSearch()} />
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {resume ? `Scoring with ${resume.versionLabel}` : 'Upload a master resume to see match scores.'}
        </p>
        <label className="flex items-center gap-2 text-sm text-charcoal">
          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Sort</span>
          <Select
            value={sort}
            onChange={(event) => setSort(event.target.value as LiveJobSort)}
            className="min-w-48"
          >
            <option value="match">Match Score: High to Low</option>
            <option value="recent">Most Recent</option>
            <option value="relevance">Relevance</option>
          </Select>
        </label>
      </div>

      <div className="mt-4 space-y-3">
        {loading && (
          <>
            <SkeletonBlock className="h-28 rounded-2xl" />
            <SkeletonBlock className="h-28 rounded-2xl" />
            <SkeletonBlock className="h-28 rounded-2xl" />
          </>
        )}
        {!loading && visibleJobs && visibleJobs.length === 0 && !error && (
          <EmptyState
            icon={<Compass size={18} />}
            title="No live jobs matched your filters."
            description="Try a broader keyword, clear the state filter, or leave remote and seniority set to Any. Counts are not invented."
          />
        )}
        {!loading &&
          visibleJobs?.map((job) => {
            const match = liveMatch(job)
            const href = employerApplyHref(job)
            const expanded = expandedId === job.id
            return (
              <Card key={job.id} className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-semibold text-charcoal">{job.title}</h2>
                      <Pill tone="strong">● Live</Pill>
                    </div>
                    <p className="mt-1 text-sm text-muted">{job.company || 'Unknown company'}</p>
                    {jobMetaLine(job) ? <p className="mt-1 text-sm text-charcoal">{jobMetaLine(job)}</p> : null}
                    {job.postedAt ? <p className="mt-1 text-xs text-muted">Posted {formatDate(job.postedAt)}</p> : null}
                  </div>
                  <ScoreDisplay score={match.score} size="sm" />
                </div>
                <div className="mt-3 space-y-1">
                  <SkillLine label="Matched" skills={topSkills(match.matchedSkills)} />
                  <SkillLine label="Missing" skills={topSkills(match.missingSkills)} />
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <ApplyNowLink href={href} />
                  <Button type="button" variant="secondary" onClick={() => void onReview(job)}>
                    Review & Apply
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => void onSave(job)} disabled={savingId === job.id || saved(job.id)}>
                    {saved(job.id) ? 'Saved' : savingId === job.id ? 'Saving…' : 'Save Job'}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => void onToggleDetails(job)}>
                    {expanded ? 'Hide Details' : 'View Details'}
                  </Button>
                </div>
                {expanded && (
                  <div className="mt-4 rounded-2xl border border-line bg-canvas px-4 py-3">
                    {hydratingId === job.id && !job.description ? (
                      <p className="text-sm text-muted">Loading the full description when the provider supplies one…</p>
                    ) : (
                      <p className="whitespace-pre-wrap text-sm leading-6 text-charcoal">
                        {job.description || 'No description was supplied for this listing.'}
                      </p>
                    )}
                  </div>
                )}
              </Card>
            )
          })}
        {visibleJobs?.some((job) => job.provider === 'job-opportunities' || job.source === 'Job Opportunities API') && (
          <p className="text-xs text-muted">
            Job data provided by{' '}
            <a className="font-semibold text-olive" href="https://www.jobopportunitiesapi.org" target="_blank" rel="noreferrer">
              Job Opportunities API
            </a>
          </p>
        )}
      </div>

      {reviewing && (
        <div className="fixed inset-0 z-40 flex justify-end bg-charcoal/40" onClick={closeReview}>
          <aside
            className="flex h-full w-full max-w-xl flex-col overflow-y-auto bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-line px-6 py-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-olive">Review & Apply</p>
                <h2 className="mt-1 text-xl font-semibold text-charcoal">{reviewing.title}</h2>
                <p className="mt-1 text-sm text-muted">
                  {reviewing.company || 'Unknown company'}
                  {jobMetaLine(reviewing) ? ` · ${jobMetaLine(reviewing)}` : ''}
                </p>
              </div>
              <button type="button" className="rounded-lg p-1 text-muted hover:bg-olive-soft hover:text-olive-dark" onClick={closeReview} aria-label="Close review">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-5 px-6 py-5">
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="rounded-2xl border border-line bg-canvas p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Current Resume Match</p>
                  <p className="mt-2 text-3xl font-semibold text-charcoal">
                    {preview?.current.score ?? liveMatch(reviewing).score ?? '—'}
                    {(preview?.current.score ?? liveMatch(reviewing).score) != null ? '%' : ''}
                  </p>
                </div>
                <div className="rounded-2xl border border-line bg-canvas p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Tailored Resume Match</p>
                  <p className="mt-2 text-3xl font-semibold text-olive-dark">
                    {preview?.tailored.score ?? '—'}
                    {preview?.tailored.score != null ? '%' : ''}
                  </p>
                </div>
                <div className="rounded-2xl border border-line bg-canvas p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Improvement</p>
                  <p className="mt-2 text-3xl font-semibold text-charcoal">
                    {preview ? `${preview.improvement > 0 ? '+' : ''}${preview.improvement} points` : '—'}
                  </p>
                </div>
              </div>
              {previewLoading && <p className="text-sm text-muted">Calculating a truthful tailored preview with the Match Engine…</p>}
              {previewError && <p className="text-sm text-danger">{previewError}</p>}
              {preview?.cannotReachTargetReason && <p className="text-sm text-charcoal">{preview.cannotReachTargetReason}</p>}
              <div className="space-y-1">
                <SkillLine label="Matched" skills={topSkills(preview?.matchedSkills ?? liveMatch(reviewing).matchedSkills, 8)} />
                <SkillLine label="Still Missing" skills={topSkills(preview?.stillMissing ?? liveMatch(reviewing).missingSkills, 8)} />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Selected resume</p>
                <p className="mt-1 text-sm text-charcoal">{resume?.versionLabel ?? 'No master resume selected'}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Resume preview</p>
                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-2xl border border-line bg-canvas px-4 py-3 text-xs leading-5 text-charcoal">
                  {(preview?.previewText || resume?.parsedText || 'No resume text is available.').slice(0, 1800)}
                </pre>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Application readiness</p>
                <ul className="mt-2 space-y-1 text-sm text-charcoal">
                  <li>{resume?.parsedText?.trim() ? 'Current resume is ready to use.' : 'A master resume is required before applying.'}</li>
                  <li>{employerApplyHref(reviewing) ? 'Employer application URL is available.' : 'This listing does not include an employer application URL.'}</li>
                  <li>JobPilot does not submit the external application for you.</li>
                </ul>
              </div>
              {!resume?.parsedText?.trim() && (
                <p className="text-sm text-muted">Upload or select a master resume to tailor keywords that are already evidenced in your experience.</p>
              )}
            </div>
            <div className="mt-auto flex flex-wrap gap-2 border-t border-line px-6 py-4">
              <Button type="button" variant="secondary" onClick={() => void onUseCurrentResume()} disabled={!reviewing}>
                Use Current Resume
              </Button>
              <Button type="button" variant="secondary" onClick={() => void onTailorResume()} disabled={!resume?.parsedText?.trim()}>
                Tailor Resume
              </Button>
              <ApplyNowLink href={employerApplyHref(reviewing)} />
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}
