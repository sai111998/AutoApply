import { FormEvent, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Card, PageHeader } from '@/components/ui/Card'
import { Field, Select, TextArea, TextInput } from '@/components/ui/Field'
import { useWorkspace } from '@/context/WorkspaceContext'
import { getAnalysisHealth } from '@/lib/ai/client'

export function JobAnalysisPage() {
  const { analyzeJob, masterResume, resumes, profile } = useWorkspace()
  const navigate = useNavigate()
  const usableResumes = resumes.filter((resume) => resume.parsedText.trim())
  const [title, setTitle] = useState('')
  const [company, setCompany] = useState('')
  const [location, setLocation] = useState('')
  const [jobUrl, setJobUrl] = useState('')
  const [description, setDescription] = useState('')
  const [resumeId, setResumeId] = useState(masterResume?.id ?? usableResumes[0]?.id ?? '')
  const [resumeText, setResumeText] = useState(masterResume?.parsedText ?? usableResumes[0]?.parsedText ?? '')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [llmConfigured, setLlmConfigured] = useState<boolean | null>(null)

  useEffect(() => {
    void getAnalysisHealth().then((health) => setLlmConfigured(health.llmConfigured))
  }, [])

  useEffect(() => {
    if (!resumeId && masterResume?.id) {
      setResumeId(masterResume.id)
      setResumeText(masterResume.parsedText)
    }
  }, [masterResume, resumeId])

  function onResumeSelect(nextId: string) {
    const selected = usableResumes.find((resume) => resume.id === nextId)
    setResumeId(nextId)
    setResumeText(selected?.parsedText ?? '')
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (submitting) return
    const jobDescription = description.trim()
    const resume = resumeText.trim()
    if (!title.trim() || !company.trim()) {
      setError('Job title and company are required.')
      return
    }
    if (!jobDescription) {
      setError('Paste a job description to analyze.')
      return
    }
    if (!resumeId || !resume) {
      setError('Select a resume with text before analyzing.')
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
        resumeId,
      })
      navigate(`/matches/${matchId}`)
    } catch (analyzeError) {
      setError(analyzeError instanceof Error ? analyzeError.message : 'Could not analyze this job')
    } finally {
      setSubmitting(false)
    }
  }

  const resumeEmpty = !resumeText.trim() || !resumeId
  const jobEmpty = !description.trim()

  return (
    <div>
      <PageHeader
        eyebrow="Intake"
        title="Job Analysis"
        description="Select a stored resume and paste a job description. The match engine uses only that resume text as evidence."
      />

      {usableResumes.length === 0 && (
        <Card className="mb-6 p-6">
          <h2 className="font-display text-2xl text-navy">Resume required</h2>
          <p className="mt-2 text-sm text-slate-ink">
            Add a master resume with parsed text before running an analysis. The model will not invent experience.
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
              <Field label="Resume">
                <Select required value={resumeId} onChange={(e) => onResumeSelect(e.target.value)}>
                  <option value="">Select a resume</option>
                  {usableResumes.map((resume) => (
                    <option key={resume.id} value={resume.id}>
                      {resume.versionLabel}
                      {resume.isMaster ? ' (master)' : ''}
                    </option>
                  ))}
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
                  placeholder="Paste the full posting. Required vs preferred language in the posting is used by the match engine."
                />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Resume text (from selected resume)">
                <TextArea
                  required
                  minLength={1}
                  value={resumeText}
                  onChange={(e) => setResumeText(e.target.value)}
                  placeholder="Select a stored resume. You can edit the text the model is allowed to use."
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
                  Extracting evidence, then scoring. Duplicate submissions are blocked.
                </span>
              )}
            </div>
          </form>
        </Card>

        <div className="space-y-4">
          <Card className="p-6">
            <h2 className="font-display text-2xl text-navy">How matching works</h2>
            <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm text-slate-ink">
              <li>The selected resume is turned into a grounded evidence profile (cached when unchanged).</li>
              <li>The job description is split into required vs preferred qualifications.</li>
              <li>A transparent score is calculated on the server. Preferred skills cannot hide a missing required skill.</li>
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
              Selected resume:{' '}
              <span className="font-semibold text-ink">
                {usableResumes.find((resume) => resume.id === resumeId)?.versionLabel ?? 'None selected'}
              </span>
            </p>
          </Card>
        </div>
      </div>
    </div>
  )
}
