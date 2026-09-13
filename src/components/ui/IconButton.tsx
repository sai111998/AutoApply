import type { ButtonHTMLAttributes, ReactNode } from 'react'

export function IconButton({
  label,
  children,
  variant = 'secondary',
  className = '',
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  label: string
  children: ReactNode
  variant?: 'secondary' | 'ghost' | 'danger'
}) {
  const variants = {
    secondary: 'border border-line bg-white text-charcoal hover:border-olive-border hover:bg-olive-soft',
    ghost: 'border border-transparent text-muted hover:bg-olive-soft hover:text-olive-dark',
    danger: 'border border-transparent text-danger hover:bg-[#f7ece8]',
  }
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}
