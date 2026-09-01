import type { ReactNode } from 'react'
import { Button } from '@/components/ui/Button'

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  busy = false,
  onCancel,
  onConfirm,
}: {
  open: boolean
  title: string
  children: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  busy?: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgb(32,36,28,0.35)] p-4" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="w-full max-w-md rounded-2xl border border-line bg-white p-6 shadow-card"
      >
        <h2 id="confirm-dialog-title" className="text-lg font-semibold text-charcoal">
          {title}
        </h2>
        <div className="mt-2 text-sm leading-6 text-muted">{children}</div>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button type="button" variant="danger" onClick={onConfirm} disabled={busy}>
            {busy ? 'Deleting…' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
