import { FormEvent, useState } from 'react'
import { FileText, Star } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card, PageHeader } from '@/components/ui/Card'
import { Field, TextInput } from '@/components/ui/Field'
import { Pill } from '@/components/ui/Badge'
import { useToast } from '@/context/ToastContext'
import { useAuth } from '@/context/AuthContext'
import { useWorkspace } from '@/context/WorkspaceContext'
import { formatDate, formatFileSize } from '@/lib/format'

export function ResumePage() {
  const { isDemo } = useAuth()
  const { resumes, uploadResume, setMasterResume } = useWorkspace()
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
                    <div className="mt-2">{resume.isMaster ? <Pill tone="strong">Master</Pill> : <Pill>Version</Pill>}</div>
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
    </div>
  )
}
