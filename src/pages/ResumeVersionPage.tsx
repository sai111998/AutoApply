import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Download, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card, PageHeader } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { ResumeDocument } from '@/components/resume/ResumeDocument'
import { useToast } from '@/context/ToastContext'
import { useWorkspace } from '@/context/WorkspaceContext'
import { downloadResumePdfRequest } from '@/lib/ai/client'
import { compactVersionName } from '@/lib/resume-names'
import { formatDate } from '@/lib/format'

export function ResumeVersionPage() {
  const { versionId } = useParams()
  const navigate = useNavigate()
  const { notify } = useToast()
  const { resumeVersions, resumes, jobs, deleteResumeVersion } = useWorkspace()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const version = resumeVersions.find((item) => item.id === versionId)
  const source = version ? resumes.find((item) => item.id === version.sourceResumeId) : undefined
  const job = version?.jobId ? jobs.find((item) => item.id === version.jobId) : undefined
  const displayName = version ? compactVersionName(version.versionName, job?.title) : ''

  if (!version) {
    return (
      <Card>
        <EmptyState
          title="Version not found"
          description="This tailored resume is not in your workspace."
          action={
            <Link to="/resume" className="text-sm font-semibold text-olive">
              Back to resumes
            </Link>
          }
        />
      </Card>
    )
  }

  return (
    <div>
      <PageHeader
        eyebrow="Saved version"
        title={displayName}
        description={`${job ? `${job.title} • ${job.company}` : source?.versionLabel ?? 'Source resume'} · ${formatDate(version.createdAt)}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => navigate('/resume')}>
              <ArrowLeft size={16} />
              All versions
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                void downloadResumePdfRequest(version.resumeContent, version.resumeContent.contact)
                  .then((blob) => {
                    const url = URL.createObjectURL(blob)
                    const link = document.createElement('a')
                    link.href = url
                    link.download = `${displayName.replace(/[^\w.-]+/g, '_')}.pdf`
                    link.click()
                    URL.revokeObjectURL(url)
                  })
                  .catch((error: unknown) => {
                    notify(error instanceof Error ? error.message : 'Could not generate the PDF.', 'error')
                  })
              }}
            >
              <Download size={16} />
              Download PDF
            </Button>
            <Button variant="ghost" onClick={() => setConfirmOpen(true)}>
              <Trash2 size={16} />
              Delete
            </Button>
          </div>
        }
      />

      <ResumeDocument title="Resume preview" resume={version.resumeContent} highlight />
      <ConfirmDialog
        open={confirmOpen}
        title="Delete this tailored version?"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          void deleteResumeVersion(version.id).then(() => navigate('/resume'))
        }}
      >
        The master resume stays. This only removes the tailored copy.
      </ConfirmDialog>
    </div>
  )
}
