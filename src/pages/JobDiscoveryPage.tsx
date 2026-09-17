import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Compass, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card, PageHeader } from '@/components/ui/Card'
import { EmptyState, ErrorState, SkeletonBlock } from '@/components/ui/EmptyState'
import { Field, Select, TextInput } from '@/components/ui/Field'
import { Pill, ScoreBadge } from '@/components/ui/Badge'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { useWorkspace } from '@/context/WorkspaceContext'
import { getLiveJobRequest, listLiveJobsRequest, type DiscoveredJobResult } from '@/lib/ai/client'
import { applyUrl, discoveredToJob, listingSource, mergeLiveJob, providerLabel } from '@/lib/discovered-job'
import { formatDate } from '@/lib/format'

const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA',
  'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK',
  'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC',
]

const SENIORITY_OPTIONS = ['Entry', 'Mid', 'Senior', 'Lead', 'Manager', 'Director', 'Intern', 'Executive']

function normalizeListedJob(job: DiscoveredJobResult): DiscoveredJobResult {
  const url = applyUrl(job)
  return {
    ...job,
    jobUrl: url,
    url,
    providerJobId: job.providerJobId || job.sourceJobId || null,
    sourceJobId: job.sourceJobId || job.providerJobId || null,
    discoveredAt: job.discoveredAt || job.fetchedAt || job.discoveredAt,
    fetchedAt: job.fetchedAt || job.discoveredAt,
    matchScore: job.matchScore ?? null,
    matchedSkills: job.matchedSkills ?? [],
    demo: false,
  }
}

function remoteLabel(job: DiscoveredJobResult): string | null {
  if (job.workArrangement) return job.workArrangement
  if (job.remote === true) return 'remote'
  if (job.remote === false) return 'onsite'
  return null
}

export function JobDiscoveryPage() {
  const { user, isDemo } = useAuth()
  const { profile, preferences, matches, jobs, savedJobIds, saveDiscoveredJob } = useWorkspace()
  const { notify } = useToast()
  const navigate = useNavigate()

  const [query, setQuery] = useState(profile.targetJobTitles[0] || preferences.targetRoles[0] || 'Java Software Engineer')
  const [state, setState] = useState('')
  const [remote, setRemote] = useState('any')
  const [employmentType, setEmploymentType] = useState('any')
  const [seniority, setSeniority] = useState('any')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [listed, setListed] = useState<DiscoveredJobResult[] | null>(null)
  const [selected, setSelected] = useState<DiscoveredJobResult | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [hydratingId, setHydratingId] = useState<string | null>(null)

  const analyzedByJobId = useMemo(() => {
    const map = new Map<string, (typeof matches)[number]>()
    for (const match of matches) {
      if (match.analysisStatus === 'complete') map.set(match.jobId, match)
    }
    return map
  }, [matches])

  async function onSearch() {
    setLoading(true)
    setError(null)
    setWarning(null)
    try {
      const response = await listLiveJobsRequest({
        q: query.trim() || undefined,
        country: 'US',
        state: state || undefined,
        remote,
        employment_type: employmentType,
        seniority,
        page: 1,
        limit: 25,
      })
      const rows = response.jobs.map(normalizeListedJob)
      setListed(rows)
      setWarning(response.warning?.message ?? null)
      if (!rows.length) setSelected(null)
    } catch (searchError) {
      setListed([])
      setSelected(null)
      setError(searchError instanceof Error ? searchError.message : 'Live job source temporarily unavailable.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void onSearch()
    // Default US live listings on first visit. Later filter changes wait for Search.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function onSave(job: DiscoveredJobResult) {
    if (!user) return
    setSavingId(job.id)
    try {
      await saveDiscoveredJob(discoveredToJob(job, user.id))
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

  async function onView(job: DiscoveredJobResult) {
    setSelected(job)
    const hydrated = await hydrateJob(job)
    setSelected(hydrated)
  }

  async function goAnalyze(job: DiscoveredJobResult) {
    const hydrated = await hydrateJob(job)
    navigate('/analyze', { state: { liveJob: hydrated } })
  }

  function goTailor(job: DiscoveredJobResult) {
    const match = analyzedByJobId.get(job.id)
    if (match) {
      navigate(`/matches/${match.id}/tailor`)
      return
    }
    void goAnalyze(job)
  }

  const saved = (jobId: string) => savedJobIds.includes(jobId) || jobs.some((item) => item.id === jobId && savedJobIds.includes(item.id))

  return (
    <div>
      <PageHeader
        eyebrow="Live jobs"
        title="Live Jobs"
        description="Browse current US listings from Job Opportunities API. Analyze uses your selected resume and the existing Match Engine. Saving a job does not apply for you."
      />

      {isDemo && (
        <div className="mb-6 rounded-2xl border border-olive-border bg-olive-soft px-4 py-3 text-sm text-olive-dark">
          Demo Data is still labeled in the workspace. Live provider results below are marked Live.
        </div>
      )}

      <Card className="p-6">
        <form
          className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
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
              <option value="onsite">Onsite</option>
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

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-4">
          {loading && (
            <>
              <SkeletonBlock className="h-36 rounded-2xl" />
              <SkeletonBlock className="h-36 rounded-2xl" />
              <SkeletonBlock className="h-36 rounded-2xl" />
            </>
          )}
          {!loading && listed && listed.length === 0 && !error && (
            <EmptyState
              icon={<Compass size={18} />}
              title="No live jobs matched your filters."
              description="Try a broader keyword, clear the state filter, or leave remote and seniority set to Any. Counts are not invented."
            />
          )}
          {!loading &&
            listed?.map((job) => {
              const analysis = analyzedByJobId.get(job.id)
              const url = applyUrl(job)
              return (
                <Card key={job.id} className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-semibold text-charcoal">{job.title}</h2>
                      <p className="mt-1 text-sm text-muted">{job.company || 'Unknown company'}</p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <Pill tone="strong">● Live</Pill>
                      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
                        Source: {providerLabel(job.provider) || job.source}
                        {listingSource(job) ? ` · ${listingSource(job)}` : ''}
                      </p>
                      <ScoreBadge score={analysis?.overallScore ?? null} emptyLabel="Not analyzed" />
                    </div>
                  </div>
                  <dl className="mt-3 grid gap-1 text-sm text-charcoal sm:grid-cols-2">
                    {job.location ? (
                      <div>
                        <dt className="text-xs uppercase tracking-[0.12em] text-muted">Location</dt>
                        <dd>{job.location}</dd>
                      </div>
                    ) : null}
                    {remoteLabel(job) ? (
                      <div>
                        <dt className="text-xs uppercase tracking-[0.12em] text-muted">Remote</dt>
                        <dd>{remoteLabel(job)}</dd>
                      </div>
                    ) : null}
                    {job.employmentType ? (
                      <div>
                        <dt className="text-xs uppercase tracking-[0.12em] text-muted">Employment type</dt>
                        <dd>{job.employmentType}</dd>
                      </div>
                    ) : null}
                    {job.seniority ? (
                      <div>
                        <dt className="text-xs uppercase tracking-[0.12em] text-muted">Seniority</dt>
                        <dd>{job.seniority}</dd>
                      </div>
                    ) : null}
                    {job.postedAt ? (
                      <div>
                        <dt className="text-xs uppercase tracking-[0.12em] text-muted">Posted</dt>
                        <dd>{formatDate(job.postedAt)}</dd>
                      </div>
                    ) : null}
                  </dl>
                  {analysis && (
                    <div className="mt-3 space-y-1 text-sm text-charcoal">
                      {analysis.skillsMatched.length > 0 && (
                        <p>
                          <span className="font-semibold">Matched skills: </span>
                          {analysis.skillsMatched.map((item) => item.name).join(' · ')}
                        </p>
                      )}
                      {analysis.skillsMissing.length > 0 && (
                        <p>
                          <span className="font-semibold">Missing skills: </span>
                          {analysis.skillsMissing.map((item) => item.name).join(' · ')}
                        </p>
                      )}
                    </div>
                  )}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button type="button" variant="secondary" onClick={() => void goAnalyze(job)}>
                      Analyze Job
                    </Button>
                    <Button type="button" onClick={() => void onSave(job)} disabled={savingId === job.id || saved(job.id)}>
                      {saved(job.id) ? 'Saved' : savingId === job.id ? 'Saving…' : 'Save Job'}
                    </Button>
                    {url ? (
                      <a
                        className="inline-flex items-center justify-center rounded-xl border border-olive-border bg-white px-4 py-2.5 text-sm font-semibold text-olive transition hover:bg-olive-soft"
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Apply/View Job
                      </a>
                    ) : null}
                    <Button type="button" variant="ghost" onClick={() => void onView(job)}>
                      Details
                    </Button>
                    {analysis ? (
                      <>
                        <Link className="inline-flex items-center px-2 text-sm font-semibold text-olive" to={`/matches/${analysis.id}`}>
                          Match results
                        </Link>
                        <Button type="button" variant="secondary" onClick={() => goTailor(job)}>
                          Tailor Resume
                        </Button>
                      </>
                    ) : null}
                  </div>
                </Card>
              )
            })}
          {listed?.some((job) => job.provider === 'job-opportunities' || job.source === 'Job Opportunities API') && (
            <p className="text-xs text-muted">
              Job data provided by{' '}
              <a className="font-semibold text-olive" href="https://www.jobopportunitiesapi.org" target="_blank" rel="noreferrer">
                Job Opportunities API
              </a>
            </p>
          )}
        </div>

        <Card className="p-6">
          {!selected ? (
            <p className="text-sm text-muted">Open Details to read the posting and employer application URL.</p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-xl font-semibold text-charcoal">{selected.title}</h2>
                <Pill tone="strong">● Live</Pill>
              </div>
              <p className="text-sm text-muted">
                {selected.company || 'Unknown company'}
                {selected.location ? ` · ${selected.location}` : ''}
              </p>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
                Source: {providerLabel(selected.provider) || selected.source}
                {listingSource(selected) ? ` · ${listingSource(selected)}` : ''}
              </p>
              <ScoreBadge
                score={analyzedByJobId.get(selected.id)?.overallScore ?? null}
                emptyLabel="Not analyzed"
              />
              {remoteLabel(selected) && <p className="text-sm">Remote: {remoteLabel(selected)}</p>}
              {selected.employmentType && <p className="text-sm">Employment type: {selected.employmentType}</p>}
              {selected.seniority && <p className="text-sm">Seniority: {selected.seniority}</p>}
              {selected.postedAt && <p className="text-sm">Posted: {formatDate(selected.postedAt)}</p>}
              {hydratingId === selected.id && !selected.description ? (
                <p className="text-sm text-muted">Loading the full description when the provider supplies one…</p>
              ) : (
                <p className="whitespace-pre-wrap text-sm leading-6 text-charcoal">
                  {selected.description || 'No description was supplied for this listing.'}
                </p>
              )}
              {applyUrl(selected) && (
                <a
                  className="inline-flex items-center gap-1 text-sm font-semibold text-olive"
                  href={applyUrl(selected) ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                >
                  Apply/View Job <ExternalLink size={14} />
                </a>
              )}
              <div className="flex flex-wrap gap-2 pt-2">
                <Button type="button" onClick={() => void goAnalyze(selected)}>
                  Analyze Job
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void onSave(selected)}
                  disabled={saved(selected.id)}
                >
                  Save Job
                </Button>
                {analyzedByJobId.get(selected.id) ? (
                  <Button type="button" variant="secondary" onClick={() => goTailor(selected)}>
                    Tailor Resume
                  </Button>
                ) : null}
              </div>
              <p className="pt-2 text-xs text-muted">
                Job data provided by{' '}
                <a className="font-semibold text-olive" href="https://www.jobopportunitiesapi.org" target="_blank" rel="noreferrer">
                  Job Opportunities API
                </a>
              </p>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
