import type { ButtonHTMLAttributes, ReactNode } from 'react'

const variants = {
  primary: 'bg-olive text-white hover:bg-olive-dark shadow-[0_8px_18px_rgb(85,99,56,0.16)]',
  secondary: 'bg-white text-charcoal border border-line hover:bg-olive-soft hover:border-olive-border',
  ghost: 'bg-transparent text-muted hover:bg-olive-soft hover:text-olive-dark',
  danger: 'bg-danger text-white hover:bg-[#7f3f32]',
}

export function Button({
  children,
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode
  variant?: keyof typeof variants
}) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}
