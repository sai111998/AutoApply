import { FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, Star } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card, PageHeader } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Field, TextInput } from '@/components/ui/Field'
import { Pill, ScoreBadge } from '@/components/ui/Badge'
import { ResumeFilePreview } from '@/components/resume/ResumeFilePreview'
import { ResumeVersionActions } from '@/components/resume/ResumeVersionActions'
import { useToast } from '@/context/ToastContext'
import { useAuth } from '@/context/AuthContext'
import { useWorkspace } from '@/context/WorkspaceContext'
import { downloadResumePdfRequest } from '@/lib/ai/client'
import { supabase } from '@/lib/supabase'
import { compactVersionName, versionTypeLabel } from '@/lib/resume-names'
import { matchForVersion } from '@/lib/application-selection'
import { formatDate, formatFileSize } from '@/lib/format'
import {
  createResumeSignedUrl,
  resolveResumePreview,
  resumeFileKind,
  resumeFileKindLabel,
  userFacingStorageError,
  type ResumePreview,
} from '@/lib/resume-storage'
import type { Resume } from '@/types/domain'

function triggerDownload(href: string, fileName: string) {
  const link = document.createElement('a')
  link.href = href
  link.download = fileName
  link.rel = 'noopener'
  link.click()
}

export function ResumePage() {
  const navigate = useNavigate()
  const { user, isDemo } = useAuth()
  const {
    resumes,
    jobs,
    matches,
    uploadResume,
    setMasterResume,
    renameStoredResume,
    deleteStoredResume,
    resumeVersions = [],
    renameResumeVersion,
    deleteResumeVersion,
  } = useWorkspace()
  const { notify } = useToast()
  const [file, setFile] = useState<File | null>(null)
  const [versionLabel, setVersionLabel] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<{ kind: 'version' | 'stored'; id: string } | null>(null)
  const [renameTarget, setRenameTarget] = useState<{ kind: 'version' | 'stored'; id: string; value: string } | null>(null)
  const [preview, setPreview] = useState<ResumePreview | null>(null)
  const [previewBusy, setPreviewBusy] = useState(false)

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

  async function openStoredResume(resume: Resume) {
    setPreviewBusy(true)
    try {
      const next = await resolveResumePreview({
        client: supabase,
        userId: user?.id,
        resume,
        isDemo,
      })
      setPreview(next)
    } catch (openError) {
      setPreview({
        resumeId: resume.id,
        fileName: resume.fileName,
        kind: resumeFileKind(resume.fileName, resume.fileType),
        signedUrl: null,
        text: resume.parsedText.trim() || null,
        canDownload: Boolean(resume.storagePath || resume.parsedText.trim()),
        error: userFacingStorageError(openError, 'Unable to preview this resume.'),
      })
    } finally {
      setPreviewBusy(false)
    }
  }

  async function downloadStoredResume(resume: Resume) {
    try {
      if (!isDemo && supabase && user?.id && resume.storagePath) {
        const url = await createResumeSignedUrl(supabase, resume.storagePath, user.id, { download: resume.fileName })
        triggerDownload(url, resume.fileName)
        return
      }
      if (resume.parsedText.trim()) {
        const blob = new Blob([resume.parsedText], { type: 'text/plain;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        triggerDownload(url, resume.fileName.replace(/\.[^.]+$/, '') + '.txt')
        URL.revokeObjectURL(url)
        return
      }
      notify('Unable to download this resume.', 'error')
    } catch (downloadError) {
      notify(userFacingStorageError(downloadError, 'Unable to download this resume.'), 'error')
    }
  }

  const pendingVersion = pendingDelete?.kind === 'version' ? resumeVersions.find((item) => item.id === pendingDelete.id) : null
  const pendingStored = pendingDelete?.kind === 'stored' ? resumes.find((item) => item.id === pendingDelete.id) : null

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
            {resumes.map((resume) => {
              const kind = resumeFileKind(resume.fileName, resume.fileType)
              return (
                <li key={resume.id} className="flex flex-col gap-3 px-6 py-4" data-testid="stored-resume-row">
                  <div className="flex items-start gap-3">
                    <div className="grid h-10 w-10 place-items-center rounded-xl bg-olive-soft text-olive">
                      <FileText size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-ink">{resume.isMaster ? 'Master Resume' : resume.versionLabel}</p>
                      <p className="text-sm text-slate-ink">
                        {resumeFileKindLabel(kind)} • Updated {formatDate(resume.createdAt)}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {resume.isMaster ? <Pill tone="strong">Master</Pill> : <Pill>Version</Pill>}
                        <Pill tone={resume.parsedText.trim() ? 'strong' : 'review'}>
                          {resume.parsedText.trim() ? 'Text ready' : 'No extracted text'}
                        </Pill>
                      </div>
                    </div>
                    {!resume.isMaster && (
                      <Button type="button" variant="secondary" onClick={() => void setMasterResume(resume.id)}>
                        <Star size={15} />
                        Set as master
                      </Button>
                    )}
                  </div>
                  <ResumeVersionActions
                    onView={() => void openStoredResume(resume)}
                    onRename={() => setRenameTarget({ kind: 'stored', id: resume.id, value: resume.isMaster ? 'Master Resume' : resume.versionLabel })}
                    onDownload={() => void downloadStoredResume(resume)}
                    onDelete={resume.isMaster ? undefined : () => setPendingDelete({ kind: 'stored', id: resume.id })}
                  />
                </li>
              )
            })}
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
                    {resumeFileKindLabel(resumeFileKind(master.fileName, master.fileType))} • Updated {formatDate(master.createdAt)}
                  </p>
                </div>
                <Pill tone="strong">Master</Pill>
              </div>
              <ResumeVersionActions
                onView={() => void openStoredResume(master)}
                onDownload={() => void downloadStoredResume(master)}
              />
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
                  onRename={() => setRenameTarget({ kind: 'version', id: version.id, value: displayName })}
                  onDownload={() => {
                    void downloadResumePdfRequest(version.resumeContent, version.resumeContent.contact)
                      .then((blob) => {
                        const url = URL.createObjectURL(blob)
                        triggerDownload(url, `${displayName.replace(/[^\w.-]+/g, '_')}.pdf`)
                        URL.revokeObjectURL(url)
                      })
                      .catch((downloadError: unknown) => {
                        notify(downloadError instanceof Error ? downloadError.message : 'Could not generate the PDF.', 'error')
                      })
                  }}
                  onDelete={() => setPendingDelete({ kind: 'version', id: version.id })}
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
        open={Boolean(pendingVersion || pendingStored)}
        title={pendingStored ? 'Delete this stored resume?' : 'Delete this tailored version?'}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (!pendingDelete) return
          const action =
            pendingDelete.kind === 'version'
              ? deleteResumeVersion(pendingDelete.id).then(() => notify('Resume version deleted.'))
              : deleteStoredResume(pendingDelete.id).then(() => notify('Resume deleted.'))
          void action
            .catch((deleteError: unknown) => {
              notify(deleteError instanceof Error ? deleteError.message : 'Could not delete that resume.', 'error')
            })
            .finally(() => setPendingDelete(null))
        }}
      >
        {pendingStored
          ? 'This removes the stored file. Tailored copies are not deleted unless they belong only to this file.'
          : 'The master resume stays. This only removes the tailored copy.'}
      </ConfirmDialog>

      {renameTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgb(32,36,28,0.35)] p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="rename-title" className="w-full max-w-md rounded-2xl border border-line bg-white p-6 shadow-card">
            <h2 id="rename-title" className="text-lg font-semibold text-charcoal">
              Rename version
            </h2>
            <Field label="Version name">
              <TextInput
                value={renameTarget.value}
                onChange={(event) => setRenameTarget({ ...renameTarget, value: event.target.value })}
              />
            </Field>
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setRenameTarget(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => {
                  if (!renameTarget.value.trim()) return
                  const save =
                    renameTarget.kind === 'version'
                      ? renameResumeVersion(renameTarget.id, renameTarget.value.trim())
                      : renameStoredResume(renameTarget.id, renameTarget.value.trim())
                  void save.then(() => setRenameTarget(null))
                }}
              >
                Save
              </Button>
            </div>
          </div>
        </div>
      )}

      {preview && (
        <ResumeFilePreview
          preview={preview}
          busy={previewBusy}
          onClose={() => setPreview(null)}
          onDownload={() => {
            const resume = resumes.find((item) => item.id === preview.resumeId)
            if (resume) void downloadStoredResume(resume)
          }}
          onRetry={() => {
            const resume = resumes.find((item) => item.id === preview.resumeId)
            if (resume) void openStoredResume(resume)
          }}
        />
      )}
    </div>
  )
}
