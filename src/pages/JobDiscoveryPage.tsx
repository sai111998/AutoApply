import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Compass, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card, PageHeader } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Field, Select, TextInput } from '@/components/ui/Field'
import { Pill, ScoreBadge } from '@/components/ui/Badge'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { useWorkspace } from '@/context/WorkspaceContext'
import { discoverJobsRequest, getAnalysisHealth, type DiscoveredJobResult } from '@/lib/ai/client'
import { discoveredToJob, formatSalary, providerLabel } from '@/lib/discovered-job'
import { formatDate } from '@/lib/format'

export function JobDiscoveryPage() {
  const { user, isDemo } = useAuth()
  const { profile, preferences, masterResume, matches, jobs, savedJobIds, saveDiscoveredJob } = useWorkspace()
  const { notify } = useToast()
  const navigate = useNavigate()

  const [role, setRole] = useState(profile.targetJobTitles[0] || preferences.targetRoles[0] || 'Java Software Engineer')
  const [location, setLocation] = useState(profile.location || preferences.targetLocations[0] || 'United States')
  const [remote, setRemote] = useState('any')
  const [employmentType, setEmploymentType] = useState('any')
  const [datePostedDays, setDatePostedDays] = useState('30')
  const [minMatch, setMinMatch] = useState(String(preferences.minMatchScore || 0))
  const [provider, setProvider] = useState('any')
  const [onlySaved, setOnlySaved] = useState(false)
  const [onlyAnalyzed, setOnlyAnalyzed] = useState(false)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Awaited<ReturnType<typeof discoverJobsRequest>> | null>(null)
  const [selected, setSelected] = useState<DiscoveredJobResult | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [providerStatus, setProviderStatus] = useState<
    Array<{ name: string; label: string; connectionLabel: string }>
  >([])

  const analyzedJobIds = useMemo(() => new Set(matches.map((match) => match.jobId)), [matches])
  const statusRows = result?.providers ?? providerStatus

  useEffect(() => {
    void getAnalysisHealth().then((health) => setProviderStatus(health.jobProviders))
  }, [])

  async function onSearch(nextPage = 1) {
    setLoading(true)
    setError(null)
    setPage(nextPage)
    try {
      const response = await discoverJobsRequest({
        roles: role.trim() ? [role.trim()] : [],
        location: location.trim(),
        remote,
        employmentType,
        datePostedDays: Number(datePostedDays) || 30,
        page: nextPage,
        pageSize: 25,
        minMatchScore: Number(minMatch) || null,
        providers: provider === 'any' ? [] : [provider],
        resumeText: masterResume?.parsedText || undefined,
        userId: isDemo ? undefined : user?.id,
      })
      setResult(response)
      if (!response.jobs.length) setSelected(null)
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : 'Job discovery failed.')
    } finally {
      setLoading(false)
    }
  }

  const visibleJobs = useMemo(() => {
    const items = result?.jobs ?? []
    return items.filter((job) => {
      if (onlySaved && !savedJobIds.includes(job.id) && !jobs.some((item) => item.id === job.id && savedJobIds.includes(item.id))) {
        return false
      }
      if (onlyAnalyzed && !analyzedJobIds.has(job.id)) return false
      return true
    })
  }, [analyzedJobIds, jobs, onlyAnalyzed, onlySaved, result?.jobs, savedJobIds])

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

  function goAnalyze(job: DiscoveredJobResult) {
    navigate('/analyze', { state: { liveJob: job } })
  }

  function goTailor(job: DiscoveredJobResult) {
    const match = matches.find((item) => item.jobId === job.id && item.analysisStatus === 'complete')
    if (match) {
      navigate(`/matches/${match.id}/tailor`)
      return
    }
    goAnalyze(job)
  }

  return (
    <div>
      <PageHeader
        eyebrow="Live search"
        title="Job Discovery"
        description="Search Crucive, Jooble, and USAJOBS for currently posted roles. Match scores use your stored resume and the existing Match Engine — no auto-apply."
      />

      {isDemo && (
        <div className="mb-6 rounded-2xl border border-olive-border bg-olive-soft px-4 py-3 text-sm text-olive-dark">
          Demo Data is still labeled in the workspace. Live provider results below are marked Live.
        </div>
      )}

      <Card className="p-6">
        <form className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" onSubmit={(event) => { event.preventDefault(); void onSearch(1) }}>
          <Field label="Role">
            <TextInput value={role} onChange={(event) => setRole(event.target.value)} placeholder="Java Software Engineer" />
          </Field>
          <Field label="Location">
            <TextInput value={location} onChange={(event) => setLocation(event.target.value)} placeholder="United States" />
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
            </Select>
          </Field>
          <Field label="Date posted">
            <Select value={datePostedDays} onChange={(event) => setDatePostedDays(event.target.value)}>
              <option value="1">Last 24 hours</option>
              <option value="7">Last 7 days</option>
              <option value="14">Last 14 days</option>
              <option value="30">Last 30 days</option>
              <option value="60">Last 60 days</option>
            </Select>
          </Field>
          <Field label="Minimum match">
            <TextInput type="number" min={0} max={100} value={minMatch} onChange={(event) => setMinMatch(event.target.value)} />
          </Field>
          <Field label="Source">
            <Select value={provider} onChange={(event) => setProvider(event.target.value)}>
              <option value="any">All live providers</option>
              <option value="crucive">Crucive</option>
              <option value="jooble">Jooble</option>
              <option value="usajobs">USAJOBS</option>
            </Select>
          </Field>
          <div className="flex items-end gap-4">
            <label className="flex items-center gap-2 text-sm text-charcoal">
              <input type="checkbox" checked={onlySaved} onChange={(event) => setOnlySaved(event.target.checked)} />
              Saved
            </label>
            <label className="flex items-center gap-2 text-sm text-charcoal">
              <input type="checkbox" checked={onlyAnalyzed} onChange={(event) => setOnlyAnalyzed(event.target.checked)} />
              Analyzed
            </label>
          </div>
          <div className="flex items-end">
            <Button type="submit" disabled={loading}>
              {loading ? 'Finding jobs…' : 'Find Jobs'}
            </Button>
          </div>
        </form>
      </Card>

      {statusRows.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-3 text-sm text-charcoal">
          {statusRows.map((item) => (
            <p key={item.name}>
              <span className="font-semibold">{item.label}</span>
              {' — '}
              {item.connectionLabel}
            </p>
          ))}
        </div>
      )}

      {result?.warnings.length ? (
        <div className="mt-4 rounded-2xl border border-line bg-canvas px-4 py-3 text-sm text-muted">
          {result.warnings.map((warning) => (
            <p key={`${warning.provider}-${warning.code}`}>{warning.message}</p>
          ))}
        </div>
      ) : null}

      {error && <p className="mt-4 text-sm text-danger">{error}</p>}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-4">
          {!result && !loading ? (
            <EmptyState
              icon={<Compass size={18} />}
              title="Search live listings"
              description="Choose a role and location, then Find Jobs. Crucive can return live demo listings in development. Jooble and USAJOBS run when those keys are configured."
            />
          ) : visibleJobs.length === 0 && !loading ? (
            <EmptyState
              icon={<Compass size={18} />}
              title="No live jobs matched your criteria."
              description="Broaden the role, broaden the location, increase the date range, or lower the match threshold. Counts are not invented."
            />
          ) : (
            visibleJobs.map((job) => (
              <Card key={job.id} className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-charcoal">{job.title}</h2>
                    <p className="mt-1 text-sm text-muted">
                      {job.company || 'Unknown company'}
                      {job.location ? ` · ${job.location}` : ''}
                      {job.workArrangement ? ` · ${job.workArrangement}` : job.remote ? ' · Remote' : ''}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <Pill tone="strong">● Live</Pill>
                    {job.liveDemoProvider && <Pill>Live Demo Provider</Pill>}
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
                      Source: {providerLabel(job.provider)}
                    </p>
                    <ScoreBadge score={job.matchScore} emptyLabel="Not analyzed" />
                  </div>
                </div>
                {job.matchedSkills.length > 0 && (
                  <p className="mt-3 text-sm text-charcoal">
                    <span className="font-semibold">Top Matches: </span>
                    {job.matchedSkills.join(' · ')}
                  </p>
                )}
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button type="button" variant="secondary" onClick={() => setSelected(job)}>
                    View
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => goAnalyze(job)}>
                    Analyze
                  </Button>
                  <Button type="button" onClick={() => void onSave(job)} disabled={savingId === job.id || savedJobIds.includes(job.id)}>
                    {savedJobIds.includes(job.id) ? 'Saved' : savingId === job.id ? 'Saving…' : 'Save'}
                  </Button>
                </div>
              </Card>
            ))
          )}
          {result && (result.hasMore || page > 1) && (
            <div className="flex justify-between">
              <Button type="button" variant="ghost" disabled={page <= 1 || loading} onClick={() => void onSearch(page - 1)}>
                Previous
              </Button>
              <p className="text-sm text-muted">Page {page}</p>
              <Button type="button" variant="ghost" disabled={!result.hasMore || loading} onClick={() => void onSearch(page + 1)}>
                Load more
              </Button>
            </div>
          )}
        </div>

        <Card className="p-6">
          {!selected ? (
            <p className="text-sm text-muted">Select View to read the posting, salary, and original URL.</p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-xl font-semibold text-charcoal">{selected.title}</h2>
                <div className="flex flex-col items-end gap-2">
                  <Pill tone="strong">● Live</Pill>
                  {selected.liveDemoProvider && <Pill>Live Demo Provider</Pill>}
                </div>
              </div>
              <p className="text-sm text-muted">
                {selected.company || 'Unknown company'}
                {selected.location ? ` · ${selected.location}` : ''}
              </p>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
                Source: {providerLabel(selected.provider)}
              </p>
              <ScoreBadge score={selected.matchScore} emptyLabel="Not analyzed" />
              {selected.workArrangement && <p className="text-sm">Arrangement: {selected.workArrangement}</p>}
              {formatSalary(selected) && <p className="text-sm">Salary: {formatSalary(selected)}</p>}
              {selected.postedAt && <p className="text-sm">Posted: {formatDate(selected.postedAt)}</p>}
              {selected.lastVerifiedAt && (
                <p className="text-xs text-muted">Last verified with the provider: {formatDate(selected.lastVerifiedAt)}</p>
              )}
              <p className="whitespace-pre-wrap text-sm leading-6 text-charcoal">{selected.description || 'No description was supplied by the provider.'}</p>
              {selected.jobUrl && (
                <a className="inline-flex items-center gap-1 text-sm font-semibold text-olive" href={selected.jobUrl} target="_blank" rel="noreferrer">
                  Original listing <ExternalLink size={14} />
                </a>
              )}
              <div className="flex flex-wrap gap-2 pt-2">
                <Button type="button" onClick={() => goAnalyze(selected)}>
                  Analyze
                </Button>
                <Button type="button" variant="secondary" onClick={() => void onSave(selected)} disabled={savedJobIds.includes(selected.id)}>
                  Save Job
                </Button>
                <Button type="button" variant="secondary" onClick={() => goTailor(selected)}>
                  Tailor Resume
                </Button>
              </div>
              <Link className="block text-sm font-semibold text-olive" to="/analyze">
                Open Job Analysis
              </Link>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
