import { FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, Star } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card, PageHeader } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Field, TextInput } from '@/components/ui/Field'
import { Pill, ScoreBadge } from '@/components/ui/Badge'
import { ResumeVersionActions } from '@/components/resume/ResumeVersionActions'
import { useToast } from '@/context/ToastContext'
import { useAuth } from '@/context/AuthContext'
import { useWorkspace } from '@/context/WorkspaceContext'
import { downloadResumePdfRequest } from '@/lib/ai/client'
import { compactVersionName, versionTypeLabel } from '@/lib/resume-names'
import { matchForVersion } from '@/lib/application-selection'
import { formatDate, formatFileSize } from '@/lib/format'

export function ResumePage() {
  const navigate = useNavigate()
  const { isDemo } = useAuth()
  const { resumes, jobs, matches, uploadResume, setMasterResume, resumeVersions = [], renameResumeVersion, deleteResumeVersion } =
    useWorkspace()
  const { notify } = useToast()
  const [file, setFile] = useState<File | null>(null)
  const [versionLabel, setVersionLabel] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [renameId, setRenameId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

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

  const pendingDelete = resumeVersions.find((item) => item.id === pendingDeleteId)

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
            <h2 className="text-lg font-semibold text-charcoal">Stored files</h2>
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
                    <p className="font-semibold text-ink">{resume.isMaster ? 'Master' : resume.versionLabel}</p>
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

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {resumes
          .filter((item) => item.isMaster)
          .map((master) => (
            <Card key={`master-${master.id}`} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-charcoal">Master</p>
                  <p className="mt-1 text-sm text-muted">
                    {master.versionLabel} · {master.fileName}
                  </p>
                </div>
                <Pill tone="strong">Master</Pill>
              </div>
            </Card>
          ))}
        {resumeVersions
          .filter((item) => item.status !== 'generating')
          .map((version) => {
            const job = jobs.find((item) => item.id === version.jobId)
            const comparison = matchForVersion(matches, version)
            const displayName = compactVersionName(version.versionName, job?.title)
            return (
              <Card key={version.id} className="p-5" data-testid="resume-version-card">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-charcoal" title={displayName}>
                      {displayName}
                    </p>
                    <p className="mt-1 truncate text-sm text-muted">
                      {job ? `${job.title} • ${job.company}` : 'Saved copy'}
                    </p>
                  </div>
                  <ScoreBadge score={comparison?.overallScore ?? null} />
                </div>
                <p className="mt-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted">
                  {versionTypeLabel(version)}
                  {version.isSelected ? ' · Selected' : ''}
                </p>
                <ResumeVersionActions
                  onView={() => navigate(`/resume/versions/${version.id}`)}
                  onRename={() => {
                    setRenameId(version.id)
                    setRenameValue(displayName)
                  }}
                  onDownload={() => {
                    void downloadResumePdfRequest(version.resumeContent, version.resumeContent.contact)
                      .then((blob) => {
                        const url = URL.createObjectURL(blob)
                        const link = document.createElement('a')
                        link.href = url
                        link.download = `${displayName.replace(/[^\w.-]+/g, '_')}.pdf`
                        link.click()
                        URL.revokeObjectURL(url)
                      })
                      .catch((downloadError: unknown) => {
                        notify(downloadError instanceof Error ? downloadError.message : 'Could not generate the PDF.', 'error')
                      })
                  }}
                  onDelete={() => setPendingDeleteId(version.id)}
                />
              </Card>
            )
          })}
      </div>
      {resumeVersions.filter((item) => item.status !== 'generating').length === 0 && (
        <Card className="mt-4 p-6">
          <p className="text-sm text-muted">No tailored versions yet. Open a match report and choose Tailor Resume.</p>
        </Card>
      )}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete this tailored version?"
        onCancel={() => setPendingDeleteId(null)}
        onConfirm={() => {
          if (!pendingDeleteId) return
          void deleteResumeVersion(pendingDeleteId).then(() => {
            notify('Resume version deleted.')
            setPendingDeleteId(null)
          })
        }}
      >
        The master resume stays. This only removes the tailored copy.
      </ConfirmDialog>

      {renameId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgb(32,36,28,0.35)] p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="rename-title" className="w-full max-w-md rounded-2xl border border-line bg-white p-6 shadow-card">
            <h2 id="rename-title" className="text-lg font-semibold text-charcoal">
              Rename version
            </h2>
            <Field label="Version name">
              <TextInput value={renameValue} onChange={(event) => setRenameValue(event.target.value)} />
            </Field>
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setRenameId(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => {
                  if (!renameValue.trim()) return
                  void renameResumeVersion(renameId, renameValue.trim()).then(() => setRenameId(null))
                }}
              >
                Save
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
