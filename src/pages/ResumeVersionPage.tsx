import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Download, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card, PageHeader } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { ResumeDocument } from '@/components/resume/ResumeDocument'
import { useToast } from '@/context/ToastContext'
import { useWorkspace } from '@/context/WorkspaceContext'
import { downloadResumePdfRequest } from '@/lib/ai/client'
import { formatDate } from '@/lib/format'

export function ResumeVersionPage() {
  const { versionId } = useParams()
  const navigate = useNavigate()
  const { notify } = useToast()
  const { resumeVersions, resumes, jobs, deleteResumeVersion } = useWorkspace()
  const version = resumeVersions.find((item) => item.id === versionId)
  const source = version ? resumes.find((item) => item.id === version.sourceResumeId) : undefined
  const job = version?.jobId ? jobs.find((item) => item.id === version.jobId) : undefined

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
        title={version.versionName}
        description={`${source?.versionLabel ?? 'Source resume'} · ${job ? `${job.title} at ${job.company}` : 'Job-specific copy'} · ${formatDate(version.createdAt)}`}
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
                    link.download = `${version.versionName.replace(/[^\w.-]+/g, '_')}.pdf`
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
            <Button
              variant="ghost"
              onClick={() => {
                if (window.confirm('Delete this tailored version? The master resume stays.')) {
                  void deleteResumeVersion(version.id).then(() => navigate('/resume'))
                }
              }}
            >
              <Trash2 size={16} />
              Delete
            </Button>
          </div>
        }
      />

      <ResumeDocument title="Resume preview" resume={version.resumeContent} highlight />
    </div>
  )
}
