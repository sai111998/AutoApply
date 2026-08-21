import { FormEvent, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Card, PageHeader } from '@/components/ui/Card'
import { Field, TextArea, TextInput } from '@/components/ui/Field'
import { useWorkspace } from '@/context/WorkspaceContext'
import { getAnalysisHealth } from '@/lib/ai/client'

export function JobAnalysisPage() {
  const { analyzeJob, masterResume, profile } = useWorkspace()
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [company, setCompany] = useState('')
  const [location, setLocation] = useState('')
  const [jobUrl, setJobUrl] = useState('')
  const [description, setDescription] = useState('')
  const [resumeText, setResumeText] = useState(masterResume?.parsedText ?? '')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [llmConfigured, setLlmConfigured] = useState<boolean | null>(null)

  useEffect(() => {
    void getAnalysisHealth().then((health) => setLlmConfigured(health.llmConfigured))
  }, [])

  useEffect(() => {
    setResumeText((current) => current || masterResume?.parsedText || '')
  }, [masterResume])

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    const jobDescription = description.trim()
    const resume = resumeText.trim()
    if (!jobDescription) {
      setError('jobDescription must not be empty')
      return
    }
    if (!resume) {
      setError('resumeText must not be empty')
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
      })
      navigate(`/matches/${matchId}`)
    } catch (analyzeError) {
      setError(analyzeError instanceof Error ? analyzeError.message : 'Could not analyze this job')
    } finally {
      setSubmitting(false)
    }
  }

  const resumeEmpty = !resumeText.trim()
  const jobEmpty = !description.trim()

  return (
    <div>
      <PageHeader
        eyebrow="Intake"
        title="Job Analysis"
        description="Paste a job description and the resume text to send. The browser never sees the LLM API key; scoring runs on POST /api/jobs/analyze."
      />

      {resumeEmpty && (
        <Card className="mb-6 p-6">
          <h2 className="font-display text-2xl text-navy">Resume text needed</h2>
          <p className="mt-2 text-sm text-slate-ink">
            Analysis only uses the resume text you supply. Add text below, or set a master resume that includes parsed
            text. The model will not invent experience that is not in this text.
          </p>
        </Card>
      )}

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
                  minLength={1}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Paste the full posting. This is sent as jobDescription to the analysis API."
                />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Resume text">
                <TextArea
                  required
                  minLength={1}
                  value={resumeText}
                  onChange={(e) => setResumeText(e.target.value)}
                  placeholder="Paste the resume text the model is allowed to use. Nothing outside this text will be treated as candidate experience."
                />
              </Field>
            </div>
            {error && <p className="sm:col-span-2 text-sm text-clay">{error}</p>}
            <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={submitting || resumeEmpty || jobEmpty}>
                {submitting ? 'Analyzing…' : 'Analyze'}
              </Button>
              {submitting && (
                <span className="inline-flex items-center gap-2 text-sm text-slate-ink">
                  <span className="spinner" />
                  Sending job description and resume to the server-side LLM…
                </span>
              )}
            </div>
          </form>
        </Card>

        <div className="space-y-4">
          <Card className="p-6">
            <h2 className="font-display text-2xl text-navy">What happens next</h2>
            <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm text-slate-ink">
              <li>The UI POSTs <code className="rounded bg-fog px-1">jobDescription</code> and <code className="rounded bg-fog px-1">resumeText</code> to <code className="rounded bg-fog px-1">/api/jobs/analyze</code>.</li>
              <li>The API key stays on the server and the model may only use the resume text you sent.</li>
              <li>The structured result is stored in Postgres when Supabase is configured, then shown on Match Results.</li>
            </ol>
            <p className={`mt-4 rounded-xl px-3 py-2 text-sm ${llmConfigured ? 'bg-emerald-50 text-pine' : 'bg-[#fbf6ea] text-ink'}`}>
              {llmConfigured
                ? 'Server-side LLM_API_KEY is configured.'
                : llmConfigured === false
                  ? 'LLM_API_KEY is not set on the server. Analyses will return an error until you add it to .env.local.'
                  : 'Checking analysis API…'}
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
                Upload a master resume if you want a stored version linked to this analysis.
              </p>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
