import { useState } from 'react'
import { Download, Eye, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { IconButton } from '@/components/ui/IconButton'

export function ResumeVersionActions({
  onView,
  onRename,
  onDownload,
  onDelete,
}: {
  onView: () => void
  onRename?: () => void
  onDownload: () => void
  onDelete?: () => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="mt-3">
      <div className="hidden flex-nowrap items-center gap-1.5 whitespace-nowrap sm:flex" data-testid="resume-actions-desktop">
        <IconButton label="View" onClick={onView}>
          <Eye size={16} />
        </IconButton>
        {onRename && (
          <IconButton label="Rename" onClick={onRename}>
            <Pencil size={16} />
          </IconButton>
        )}
        <IconButton label="Download" onClick={onDownload}>
          <Download size={16} />
        </IconButton>
        {onDelete && (
          <IconButton label="Delete" variant="danger" onClick={onDelete}>
            <Trash2 size={16} />
          </IconButton>
        )}
      </div>
      <div className="sm:hidden" data-testid="resume-actions-mobile">
        <IconButton label="Actions" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-haspopup="menu">
          <MoreHorizontal size={16} />
        </IconButton>
        {open && (
          <div className="mt-2 flex flex-col gap-1 rounded-xl border border-line bg-white p-1">
            <MobileAction label="View" onClick={() => { setOpen(false); onView() }} />
            {onRename && <MobileAction label="Rename" onClick={() => { setOpen(false); onRename() }} />}
            <MobileAction label="Download" onClick={() => { setOpen(false); onDownload() }} />
            {onDelete && <MobileAction label="Delete" onClick={() => { setOpen(false); onDelete() }} danger />}
          </div>
        )}
      </div>
    </div>
  )
}

function MobileAction({
  label,
  onClick,
  danger,
}: {
  label: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      className={`rounded-lg px-3 py-2 text-left text-sm font-semibold ${danger ? 'text-danger' : 'text-charcoal hover:bg-olive-soft'}`}
      onClick={onClick}
    >
      {label}
    </button>
  )
}
