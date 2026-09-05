import { Link } from 'react-router-dom'
import { MarketingShell } from '@/components/landing/MarketingChrome'

export function LegalPlaceholderPage({
  title,
  summary,
}: {
  title: string
  summary: string
}) {
  return (
    <MarketingShell>
      <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-olive">JobPilot AI</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-charcoal">{title}</h1>
        <p className="mt-4 text-sm leading-7 text-muted">{summary}</p>
        <p className="mt-6 rounded-2xl border border-line bg-white px-5 py-4 text-sm leading-6 text-muted">
          This page is a placeholder. Full language will be published here before a public launch. Nothing on this
          site is legal advice, and JobPilot AI does not guarantee interviews, offers, or job placement.
        </p>
        <Link to="/" className="mt-8 inline-block text-sm font-semibold text-olive hover:text-olive-dark">
          Back to home
        </Link>
      </main>
    </MarketingShell>
  )
}
