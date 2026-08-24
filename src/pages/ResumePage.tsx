import { FormEvent, useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, FileText, Star, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card, PageHeader } from '@/components/ui/Card'
import { Field, TextInput } from '@/components/ui/Field'
import { Pill } from '@/components/ui/Badge'
import { useToast } from '@/context/ToastContext'
import { useAuth } from '@/context/AuthContext'
import { useWorkspace } from '@/context/WorkspaceContext'
import { downloadResumePdfRequest } from '@/lib/ai/client'
import { formatDate, formatFileSize } from '@/lib/format'

export function ResumePage() {
  const { isDemo } = useAuth()
  const { resumes, jobs, uploadResume, setMasterResume, resumeVersions = [], renameResumeVersion, deleteResumeVersion } =
    useWorkspace()
  const { notify } = useToast()
  const [file, setFile] = useState<File | null>(null)
  const [versionLabel, setVersionLabel] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!file) {
      setError('Choose a PDF or DOCX file.')
      return
    }
    setUploading(true)
    setError(null)
    setMessage(null)
    try {
      await uploadResume(file, versionLabel)
      setFile(null)
      setVersionLabel('')
      setMessage('Resume stored. Set a master version for future analyses.')
      notify('Resume stored.')
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Documents"
        title="Master Resume"
        description="Store PDF and DOCX versions, then mark one as master. Analyses use the master resume metadata when calling the AI API."
      />

      <div className="grid gap-6 lg:grid-cols-[0.9fr_1.3fr]">
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-charcoal">Upload a version</h2>
          <p className="mt-1 text-sm text-slate-ink">
            {isDemo
              ? 'Demo mode keeps file metadata in this browser session. Connect Supabase storage to persist files.'
              : 'Files are stored in the Supabase resumes bucket.'}
          </p>
          <form className="mt-5 space-y-4" onSubmit={(event) => void onSubmit(event)}>
            <Field label="Resume file">
              <input
                className="field"
                type="file"
                accept=".pdf,.docx,.txt,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </Field>
            <Field label="Version label">
              <TextInput
                placeholder="Master v5 — product-engineer"
                value={versionLabel}
                onChange={(e) => setVersionLabel(e.target.value)}
              />
            </Field>
            {file && (
              <p className="text-sm text-slate-ink">
                {file.name} · {formatFileSize(file.size)}
              </p>
            )}
            {error && <p className="text-sm text-danger">{error}</p>}
            {message && <p className="text-sm text-olive">{message}</p>}
            <Button type="submit" disabled={uploading}>
              {uploading ? 'Uploading…' : 'Store resume'}
            </Button>
          </form>
        </Card>

        <Card className="overflow-hidden">
          <div className="border-b border-line px-6 py-4">
            <h2 className="text-lg font-semibold text-charcoal">Resume versions</h2>
            <p className="text-sm text-slate-ink">{resumes.length} stored</p>
          </div>
          <ul className="divide-y divide-fog">
            {resumes.map((resume) => (
              <li key={resume.id} className="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-xl bg-olive-soft text-olive">
                    <FileText size={18} />
                  </div>
                  <div>
                    <p className="font-semibold text-ink">{resume.versionLabel}</p>
                    <p className="text-sm text-slate-ink">
                      {resume.fileName} · {formatFileSize(resume.fileSize)} · {formatDate(resume.createdAt)}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {resume.isMaster ? <Pill tone="strong">Master</Pill> : <Pill>Version</Pill>}
                      <Pill tone={resume.parsedText.trim() ? 'strong' : 'review'}>
                        {resume.parsedText.trim() ? 'Text ready' : 'No extracted text'}
                      </Pill>
                    </div>
                  </div>
                </div>
                {!resume.isMaster && (
                  <Button type="button" variant="secondary" onClick={() => void setMasterResume(resume.id)}>
                    <Star size={15} />
                    Set as master
                  </Button>
                )}
              </li>
            ))}
            {resumes.length === 0 && (
              <li className="px-6 py-12 text-center text-slate-ink">No resumes yet. Upload a PDF or DOCX to begin.</li>
            )}
          </ul>
        </Card>
      </div>

      <Card className="mt-6 overflow-hidden">
        <div className="border-b border-line px-6 py-4">
          <h2 className="text-lg font-semibold text-charcoal">Resume versions</h2>
          <p className="text-sm text-muted">
            Master files stay put. Tailored copies hang off the source resume and can be viewed, renamed, downloaded, or deleted independently.
          </p>
        </div>
        <ul className="divide-y divide-fog">
          {resumes.filter((item) => item.isMaster).map((master) => (
            <li key={`master-${master.id}`} className="px-6 py-4">
              <p className="font-semibold text-charcoal">Master Resume</p>
              <p className="text-sm text-muted">{master.versionLabel} · {master.fileName}</p>
            </li>
          ))}
          {resumeVersions.map((version) => {
            const source = resumes.find((item) => item.id === version.sourceResumeId)
            const job = jobs.find((item) => item.id === version.jobId)
            return (
              <li key={version.id} className="flex flex-col gap-3 px-6 py-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="pl-4">
                  <p className="font-semibold text-charcoal">└ {version.versionName}</p>
                  <p className="text-sm text-muted">
                    From {source?.versionLabel ?? 'master'} · {job ? `${job.title} at ${job.company}` : 'Saved copy'} ·{' '}
                    {formatDate(version.createdAt)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link
                    to={`/resume/versions/${version.id}`}
                    className="inline-flex items-center justify-center rounded-xl border border-line bg-white px-3 py-2 text-sm font-semibold text-charcoal hover:border-olive-border"
                  >
                    View
                  </Link>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      const next = window.prompt('Version name', version.versionName)
                      if (next?.trim()) void renameResumeVersion(version.id, next.trim())
                    }}
                  >
                    Rename
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      void downloadResumePdfRequest(version.resumeContent, version.resumeContent.contact)
                        .then((blob) => {
                          const url = URL.createObjectURL(blob)
                          const link = document.createElement('a')
                          link.href = url
                          link.download = `${version.versionName.replace(/[^\w.-]+/g, '_')}.pdf`
                          link.click()
                          URL.revokeObjectURL(url)
                        })
                        .catch((error: unknown) => {
                          notify(error instanceof Error ? error.message : 'Could not generate the PDF.', 'error')
                        })
                    }}
                  >
                    <Download size={15} />
                    Download
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      if (window.confirm('Delete this tailored version? The master resume stays.')) {
                        void deleteResumeVersion(version.id)
                      }
                    }}
                  >
                    <Trash2 size={15} />
                    Delete
                  </Button>
                </div>
              </li>
            )
          })}
          {resumeVersions.length === 0 && (
            <li className="px-6 py-10 text-sm text-muted">
              No tailored versions yet. Open a match report and choose Tailor Resume.
            </li>
          )}
        </ul>
      </Card>
    </div>
  )
}
