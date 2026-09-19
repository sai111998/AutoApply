import { useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import { BrandMark } from '@/components/BrandMark'
import { Button } from '@/components/ui/Button'

const navLinks = [
  { hash: '#how-it-works', label: 'How It Works' },
  { hash: '#features', label: 'Features' },
  { hash: '#about', label: 'About' },
]

export function MarketingShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas text-charcoal">
      <MarketingNav />
      {children}
      <MarketingFooter />
    </div>
  )
}

export function MarketingNav() {
  const [open, setOpen] = useState(false)
  const location = useLocation()

  function sectionHref(hash: string) {
    return location.pathname === '/' ? hash : `/${hash}`
  }

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-white/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link to="/" aria-label="JobPilot AI home" onClick={() => setOpen(false)}>
          <BrandMark />
        </Link>
        <nav className="hidden items-center gap-6 text-sm font-medium text-muted md:flex">
          {navLinks.map((link) => (
            <a key={link.hash} href={sectionHref(link.hash)} className="transition hover:text-olive-dark">
              {link.label}
            </a>
          ))}
        </nav>
        <div className="hidden items-center gap-2 md:flex">
          <Link
            to="/login"
            className="rounded-xl px-3 py-2 text-sm font-semibold text-charcoal transition hover:bg-olive-soft"
          >
            Sign In
          </Link>
          <Link to="/signup">
            <Button type="button">Get Started</Button>
          </Link>
        </div>
        <button
          type="button"
          className="rounded-xl border border-line px-3 py-2 text-sm font-semibold md:hidden"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          aria-label="Toggle navigation"
        >
          {open ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>
      {open && (
        <div className="border-t border-line bg-white px-4 py-4 md:hidden">
          <div className="flex flex-col gap-3 text-sm font-medium">
            {navLinks.map((link) => (
              <a
                key={link.hash}
                href={sectionHref(link.hash)}
                className="rounded-lg px-2 py-2 text-muted hover:bg-olive-soft hover:text-olive-dark"
                onClick={() => setOpen(false)}
              >
                {link.label}
              </a>
            ))}
            <Link to="/login" className="rounded-lg px-2 py-2" onClick={() => setOpen(false)}>
              Sign In
            </Link>
            <Link to="/signup" onClick={() => setOpen(false)}>
              <Button type="button" className="w-full">
                Get Started
              </Button>
            </Link>
            {location.pathname !== '/' && (
              <Link to="/" className="px-2 text-olive" onClick={() => setOpen(false)}>
                Back to home
              </Link>
            )}
          </div>
        </div>
      )}
    </header>
  )
}

export function MarketingFooter() {
  return (
    <footer className="border-t border-line bg-white">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-[1.3fr_1fr_1fr]">
        <div>
          <Link to="/" aria-label="JobPilot AI home">
            <BrandMark />
          </Link>
          <p className="mt-4 max-w-sm text-sm leading-6 text-muted">
            JobPilot AI is a simple workspace for organizing your job search, reviewing role fit, and tracking
            applications — with you in control of every next step.
          </p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Product</p>
          <ul className="mt-3 space-y-2 text-sm">
            <li>
              <a className="text-charcoal hover:text-olive" href="/#how-it-works">
                How it works
              </a>
            </li>
            <li>
              <a className="text-charcoal hover:text-olive" href="/#features">
                Features
              </a>
            </li>
            <li>
              <Link className="text-charcoal hover:text-olive" to="/about">
                About
              </Link>
            </li>
          </ul>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Company</p>
          <ul className="mt-3 space-y-2 text-sm">
            <li>
              <Link className="text-charcoal hover:text-olive" to="/privacy">
                Privacy
              </Link>
            </li>
            <li>
              <Link className="text-charcoal hover:text-olive" to="/terms">
                Terms
              </Link>
            </li>
            <li>
              <Link className="text-charcoal hover:text-olive" to="/contact">
                Contact
              </Link>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-line">
        <p className="mx-auto max-w-6xl px-4 py-4 text-xs text-muted sm:px-6">
          © {new Date().getFullYear()} JobPilot AI. All rights reserved.
        </p>
      </div>
    </footer>
  )
}
