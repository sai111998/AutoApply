import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Card, PageHeader } from '@/components/ui/Card'
import { Field, Select, TextArea } from '@/components/ui/Field'
import { useWorkspace } from '@/context/WorkspaceContext'
import { getAnalysisHealth } from '@/lib/ai/client'

export function JobAnalysisPage() {
  const { analyzeJob, masterResume, resumes } = useWorkspace()
  const navigate = useNavigate()
  const defaultResumeId = masterResume?.id ?? resumes[0]?.id ?? ''
  const [resumeId, setResumeId] = useState(defaultResumeId)
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [llmConfigured, setLlmConfigured] = useState<boolean | null>(null)

  useEffect(() => {
    void getAnalysisHealth().then((health) => setLlmConfigured(health.llmConfigured))
  }, [])

  useEffect(() => {
    if (!resumeId && defaultResumeId) setResumeId(defaultResumeId)
  }, [defaultResumeId, resumeId])

  const selectedResume = useMemo(
    () => resumes.find((resume) => resume.id === resumeId) ?? null,
    [resumeId, resumes],
  )
  const selectedResumeText = selectedResume?.parsedText.trim() ?? ''

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (submitting) return
    const jobDescription = description.trim()
    if (!resumeId || !selectedResume) {
      setError('Select a stored resume before analyzing.')
      return
    }
    if (!selectedResumeText) {
      setError('The selected resume has no extracted text. Open Master Resume to upload a version with text.')
      return
    }
    if (!jobDescription) {
      setError('Paste a job description to analyze.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const matchId = await analyzeJob({
        description: jobDescription,
        resumeId,
      })
      navigate(`/matches/${matchId}`)
    } catch (analyzeError) {
      setError(analyzeError instanceof Error ? analyzeError.message : 'Could not analyze this job')
    } finally {
      setSubmitting(false)
    }
  }

  const canAnalyze = Boolean(resumeId && selectedResumeText && description.trim() && !submitting)

  return (
    <div>
      <PageHeader
        eyebrow="Intake"
        title="Job Analysis"
        description="Choose a stored resume and paste a job description. The selected resume’s extracted text is used automatically."
      />

      {resumes.length === 0 && (
        <Card className="mb-6 p-6">
          <h2 className="font-display text-2xl text-navy">Resume required</h2>
          <p className="mt-2 text-sm text-slate-ink">
            Upload a resume on the Master Resume page first. Job Analysis uses that stored file — there is no separate
            resume paste field here.
          </p>
          <Link className="mt-4 inline-block text-sm font-semibold text-pine" to="/resume">
            Go to Master Resume
          </Link>
        </Card>
      )}

      <Card className="max-w-3xl p-6">
        <form className="grid gap-5" onSubmit={(event) => void onSubmit(event)}>
          <Field label="Resume">
            <Select required value={resumeId} onChange={(event) => setResumeId(event.target.value)}>
              <option value="">Select a resume</option>
              {resumes.map((resume) => (
                <option key={resume.id} value={resume.id}>
                  {resume.versionLabel}
                  {resume.isMaster ? ' (master)' : ''}
                  {!resume.parsedText.trim() ? ' — no extracted text' : ''}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Job description">
            <TextArea
              required
              minLength={1}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Paste the full job posting."
            />
          </Field>

          {error && <p className="text-sm text-clay">{error}</p>}

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={!canAnalyze}>
              {submitting ? 'Analyzing…' : 'Analyze Job'}
            </Button>
            {submitting && (
              <span className="inline-flex items-center gap-2 text-sm text-slate-ink">
                <span className="spinner" />
                Using the selected resume’s stored text.
              </span>
            )}
          </div>

          {llmConfigured === false && (
            <p className="rounded-xl bg-[#fbf6ea] px-3 py-2 text-sm text-ink">
              LLM_API_KEY is not set on the server. Analyses will return an error until you add it to .env.local.
            </p>
          )}
        </form>
      </Card>
    </div>
  )
}
