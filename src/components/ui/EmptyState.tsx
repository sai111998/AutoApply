import type { ReactNode } from 'react'
import { Button } from './Button'

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string
  description: string
  action?: ReactNode
  icon?: ReactNode
}) {
  return (
    <div className="grid place-items-center px-6 py-14 text-center">
      {icon && (
        <div className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-olive-soft text-olive">{icon}</div>
      )}
      <h2 className="text-lg font-semibold text-charcoal">{title}</h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-muted">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function ErrorState({
  title,
  description,
  onRetry,
}: {
  title: string
  description: string
  onRetry?: () => void
}) {
  return (
    <div className="rounded-2xl border border-[#ead5cf] bg-[#fdf7f5] px-5 py-4">
      <p className="text-sm font-semibold text-danger">{title}</p>
      <p className="mt-1 text-sm text-muted">{description}</p>
      {onRetry && (
        <Button type="button" variant="secondary" className="mt-3" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}

export function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} />
}
