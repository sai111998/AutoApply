import { FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Card, PageHeader } from '@/components/ui/Card'
import { Field, TextArea, TextInput } from '@/components/ui/Field'
import { useWorkspace } from '@/context/WorkspaceContext'
import { getJobAnalysisClient } from '@/lib/ai/client'

export function JobAnalysisPage() {
  const { analyzeJob, masterResume, profile } = useWorkspace()
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [company, setCompany] = useState('')
  const [location, setLocation] = useState('')
  const [jobUrl, setJobUrl] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const aiConfigured = getJobAnalysisClient().isConfigured()

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const matchId = await analyzeJob({ title, company, location, jobUrl, description })
      navigate(`/matches/${matchId}`)
    } catch (analyzeError) {
      setError(analyzeError instanceof Error ? analyzeError.message : 'Could not save this job')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Intake"
        title="Job Analysis"
        description="Paste a job description and save it against your master resume. Scoring happens only through a connected analysis API."
      />

      <div className="grid gap-6 lg:grid-cols-[1.4fr_0.8fr]">
        <Card className="p-6">
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
              <Field label="Job description">
                <TextArea
                  required
                  minLength={40}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Paste the full posting here. JobPilot will send this text, your profile, and master resume metadata to the analysis API."
                />
              </Field>
            </div>
            {error && <p className="sm:col-span-2 text-sm text-clay">{error}</p>}
            <div className="sm:col-span-2">
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Saving…' : 'Analyze'}
              </Button>
            </div>
          </form>
        </Card>

        <div className="space-y-4">
          <Card className="p-6">
            <h2 className="font-display text-2xl text-navy">What happens next</h2>
            <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm text-slate-ink">
              <li>The job is stored in Postgres (or demo session storage).</li>
              <li>A match record is created with status queued.</li>
              <li>
                If <code className="rounded bg-fog px-1">VITE_AI_API_URL</code> is set, JobPilot POSTs to{' '}
                <code className="rounded bg-fog px-1">/v1/analyze</code>.
              </li>
              <li>No local heuristic invents a production-looking score.</li>
            </ol>
            <p className={`mt-4 rounded-xl px-3 py-2 text-sm ${aiConfigured ? 'bg-emerald-50 text-pine' : 'bg-[#fbf6ea] text-ink'}`}>
              {aiConfigured
                ? 'An analysis API URL is configured in this environment.'
                : 'No analysis API is configured. New roles will appear as queued / unavailable.'}
            </p>
          </Card>
          <Card className="p-6">
            <h2 className="font-display text-xl text-navy">Attached context</h2>
            <p className="mt-2 text-sm text-slate-ink">
              Candidate: <span className="font-semibold text-ink">{profile.fullName || 'Unnamed'}</span>
            </p>
            <p className="mt-1 text-sm text-slate-ink">
              Master resume:{' '}
              <span className="font-semibold text-ink">
                {masterResume ? masterResume.versionLabel : 'None selected'}
              </span>
            </p>
            {!masterResume && (
              <p className="mt-3 text-sm text-clay">
                Upload and mark a master resume so the API receives a document reference.
              </p>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
