import type { ButtonHTMLAttributes, ReactNode } from 'react'

const variants = {
  primary:
    'bg-pine text-white hover:bg-[#16573c] shadow-[0_8px_20px_rgb(28,107,74,0.18)]',
  secondary: 'bg-white text-ink border border-line hover:bg-fog/60',
  ghost: 'bg-transparent text-slate-ink hover:bg-fog/80',
  danger: 'bg-clay text-white hover:bg-[#a84b32]',
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
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}
