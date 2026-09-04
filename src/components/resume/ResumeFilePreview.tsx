import { Button } from '@/components/ui/Button'
import type { ResumePreview } from '@/lib/resume-storage'

export function ResumeFilePreview({
  preview,
  busy = false,
  onClose,
  onDownload,
  onRetry,
}: {
  preview: ResumePreview
  busy?: boolean
  onClose: () => void
  onDownload: () => void
  onRetry?: () => void
}) {
  const failed = Boolean(preview.error) && !preview.signedUrl && !preview.text

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgb(32,36,28,0.35)] p-4" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="resume-preview-title"
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-card"
        data-testid="resume-file-preview"
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 id="resume-preview-title" className="truncate text-lg font-semibold text-charcoal">
              {preview.fileName}
            </h2>
            {preview.error && <p className="mt-1 text-sm text-danger">{failed ? 'Unable to preview this resume.' : preview.error}</p>}
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            {preview.canDownload && (
              <Button type="button" variant="secondary" onClick={onDownload} disabled={busy}>
                Download Resume
              </Button>
            )}
            {failed && onRetry && (
              <Button type="button" variant="secondary" onClick={onRetry} disabled={busy}>
                Try Again
              </Button>
            )}
            <Button type="button" variant="secondary" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-canvas p-4">
          {preview.kind === 'pdf' && preview.signedUrl ? (
            <iframe title={`${preview.fileName} preview`} className="h-[70vh] w-full rounded-xl border border-line bg-white" src={preview.signedUrl} />
          ) : preview.text ? (
            <pre className="whitespace-pre-wrap rounded-xl border border-line bg-white p-4 text-sm leading-6 text-charcoal">
              {preview.text}
            </pre>
          ) : (
            <div className="grid h-48 place-items-center rounded-xl border border-line bg-white px-6 text-center text-sm text-muted">
              Unable to preview this resume.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
