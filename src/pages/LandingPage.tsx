import { useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  Briefcase,
  Check,
  FileText,
  FolderOpen,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  Target,
} from 'lucide-react'
import { MarketingShell } from '@/components/landing/MarketingChrome'
import { Button } from '@/components/ui/Button'
import { Pill, RecommendationBadge, ScoreBadge, StatusBadge } from '@/components/ui/Badge'
import { ScoreRing } from '@/components/ui/ScoreRing'

const values = [
  {
    title: 'Find better matches',
    body: 'Understand which opportunities actually fit your skills and experience before you invest an evening in the application.',
    icon: Target,
  },
  {
    title: 'Apply smarter',
    body: 'Analyze job descriptions, identify strengths and gaps, and prepare applications with less manual copy-paste work.',
    icon: ScanSearch,
  },
  {
    title: 'Stay organized',
    body: 'Keep jobs, resumes, analyses, and application status in one place instead of spreading them across notes and tabs.',
    icon: FolderOpen,
  },
  {
    title: 'Keep it simple',
    body: 'A straightforward workflow designed to stay approachable — without the overhead of complicated, high-priced job-search services.',
    icon: Sparkles,
  },
]

const steps = [
  {
    title: 'Add your resume',
    body: 'Store a version and mark one as master so later analyses have a consistent baseline.',
    icon: FileText,
  },
  {
    title: 'Analyze a job',
    body: 'Paste a posting and the resume text the model is allowed to use. Nothing else is treated as experience.',
    icon: ScanSearch,
  },
  {
    title: 'Understand your match',
    body: 'Review score, recommendation, skills, and a short summary — then decide what to do next.',
    icon: Target,
  },
  {
    title: 'Prepare and track your application',
    body: 'Mark applications ready, applied, or interview. You review every status change.',
    icon: Briefcase,
  },
]

const whyItems = [
  'One place for roles, resumes, analyses, and follow-ups',
  'Clear AI-assisted job analysis based on the resume text you provide',
  'Resume-aware matching with strong, partial, and missing skill signals',
  'Application organization you can update yourself',
  'A simple workflow — AI assists, you stay in control',
]

export function LandingPage() {
  const location = useLocation()

  useEffect(() => {
    if (!location.hash) return
    const id = location.hash.replace('#', '')
    const element = document.getElementById(id)
    if (!element) return
    element.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [location.hash])

  return (
    <MarketingShell>
      <main>
        <section className="landing-reveal mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-14 sm:px-6 sm:pb-24 sm:pt-20 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-olive">Job search workspace</p>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight text-charcoal sm:text-5xl sm:leading-[1.12]">
              Applying for jobs shouldn’t feel like a full-time job.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-muted sm:text-lg">
              JobPilot AI helps you organize your job search, understand how well each role matches your experience,
              prepare stronger applications, and keep everything in one simple place.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link to="/signup">
                <Button type="button" className="px-5 py-3">
                  Get Started
                </Button>
              </Link>
              <a href="#how-it-works">
                <Button type="button" variant="secondary" className="px-5 py-3">
                  See How It Works
                </Button>
              </a>
            </div>
          </div>
          <HeroPreview />
        </section>

        <section id="features" className="landing-reveal scroll-mt-24 border-t border-line bg-white py-16 sm:py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <h2 className="text-2xl font-semibold tracking-tight text-charcoal sm:text-3xl">What JobPilot is for</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted sm:text-base">
              A practical cockpit for people who already know how to apply — and want less chaos around the process.
            </p>
            <div className="mt-10 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {values.map((item) => (
                <article key={item.title} className="card card-interactive p-5">
                  <div className="grid h-10 w-10 place-items-center rounded-xl bg-olive-soft text-olive">
                    <item.icon size={18} />
                  </div>
                  <h3 className="mt-4 text-base font-semibold text-charcoal">{item.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted">{item.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="how-it-works" className="landing-reveal scroll-mt-24 py-16 sm:py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <h2 className="text-2xl font-semibold tracking-tight text-charcoal sm:text-3xl">How it works</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted sm:text-base">
              Four steps. No browser automation, and no unreviewed submissions on your behalf.
            </p>
            <div className="relative mt-12 grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
              <div className="pointer-events-none absolute top-8 right-[7%] left-[7%] hidden h-px bg-olive-border xl:block" />
              {steps.map((step, index) => (
                <article key={step.title} className="relative rounded-2xl border border-line bg-white p-5 transition hover:border-olive-border">
                  <div className="flex items-center gap-3">
                    <div className="relative grid h-12 w-12 place-items-center rounded-2xl bg-olive-soft text-olive">
                      <step.icon size={20} />
                      <span className="absolute -top-1 -left-1 grid h-5 w-5 place-items-center rounded-full bg-olive text-[11px] font-semibold text-white">
                        {index + 1}
                      </span>
                    </div>
                  </div>
                  <h3 className="mt-4 text-base font-semibold text-charcoal">{step.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted">{step.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="landing-reveal border-t border-line bg-white py-16 sm:py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <h2 className="text-2xl font-semibold tracking-tight text-charcoal sm:text-3xl">A quieter way to see fit</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted sm:text-base">
              Preview of the workspace. Sample labels are for layout only — not live user results.
            </p>
            <ProductPreview />
          </div>
        </section>

        <section id="about" className="landing-reveal scroll-mt-24 py-16 sm:py-20">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-charcoal sm:text-3xl">Why JobPilot AI</h2>
              <p className="mt-4 text-lg leading-7 text-charcoal">
                Less time managing applications. More time preparing for the opportunities that matter.
              </p>
              <p className="mt-4 text-sm leading-6 text-muted">
                AI assists your review. It does not decide where you work, and it does not send applications unless you
                do.
              </p>
            </div>
            <ul className="space-y-3">
              {whyItems.map((item) => (
                <li key={item} className="flex gap-3 rounded-2xl border border-line bg-white px-4 py-3 text-sm text-charcoal">
                  <Check size={18} className="mt-0.5 shrink-0 text-olive" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="landing-reveal px-4 pb-4 sm:px-6">
          <div className="mx-auto max-w-6xl overflow-hidden rounded-[1.6rem] bg-olive-dark px-6 py-14 text-white sm:px-12">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-olive-soft">Designed to stay approachable</p>
            <h2 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
              Powerful job-search tools shouldn’t have to be complicated or expensive.
            </h2>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-white/75 sm:text-base">
              JobPilot AI is built around simple workflows, transparent features, and affordable access — without extra
              process for the sake of it. Pricing will be published here when it is ready; this page does not quote a
              plan or a discount.
            </p>
            <Link to="/signup" className="mt-8 inline-block">
              <Button type="button" className="bg-white text-olive-dark hover:bg-olive-soft">
                Start Organizing Your Job Search
              </Button>
            </Link>
          </div>
        </section>

        <section className="landing-reveal mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="rounded-3xl border border-line bg-white p-6 sm:p-10">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-1 text-olive" size={22} />
              <div>
                <h2 className="text-xl font-semibold tracking-tight text-charcoal">Your applications stay under your control.</h2>
                <ul className="mt-4 grid gap-3 text-sm leading-6 text-muted sm:grid-cols-2">
                  <li>You review analyses before you treat them as a decision.</li>
                  <li>Sign-in is tied to your own account.</li>
                  <li>Application history is visible in your workspace so you can update status yourself.</li>
                  <li>JobPilot AI does not guarantee interviews, offers, or jobs. Suggestions are for you to check.</li>
                </ul>
              </div>
            </div>
          </div>
        </section>
      </main>
    </MarketingShell>
  )
}

function HeroPreview() {
  return (
    <div className="card card-interactive hidden overflow-hidden lg:block">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <p className="text-sm font-semibold text-charcoal">Match preview</p>
        <Pill tone="review">Sample layout</Pill>
      </div>
      <div className="px-6 py-6">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Example role</p>
        <h3 className="mt-2 text-lg font-semibold text-charcoal">Product Engineer</h3>
        <p className="text-sm text-muted">Northwind Labs · Hybrid</p>
        <div className="mt-5 flex justify-center">
          <ScoreRing score={84} size={112} />
        </div>
        <div className="mt-4 flex justify-center">
          <RecommendationBadge value="APPLY" />
        </div>
      </div>
    </div>
  )
}

function ProductPreview() {
  return (
    <div className="card mt-10 overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <p className="text-sm font-semibold text-charcoal">Workspace preview</p>
        <Pill tone="review">Sample layout</Pill>
      </div>
      <div className="grid gap-0 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="border-b border-line p-6 lg:border-r lg:border-b-0">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Example role</p>
          <h3 className="mt-2 text-lg font-semibold text-charcoal">Product Engineer</h3>
          <p className="text-sm text-muted">Northwind Labs · Hybrid</p>
          <div className="mt-5 flex justify-center">
            <ScoreRing score={84} size={120} />
          </div>
          <div className="mt-4 flex justify-center">
            <RecommendationBadge value="APPLY" />
          </div>
          <div className="mt-6 space-y-3 text-sm">
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-muted">Strong</p>
              <div className="flex flex-wrap gap-1.5">
                {['React', 'TypeScript', 'Accessibility'].map((skill) => (
                  <Pill key={skill} tone="strong">
                    {skill}
                  </Pill>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-muted">Partial</p>
              <Pill tone="review">Payments domain</Pill>
            </div>
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-muted">Missing</p>
              <Pill tone="skip">Kotlin</Pill>
            </div>
          </div>
        </div>
        <div className="p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Recent analyses</p>
          <ul className="mt-4 space-y-3">
            {[
              { company: 'Northwind Labs', title: 'Product Engineer', score: 84, rec: 'APPLY' as const },
              { company: 'Harbor Studio', title: 'Frontend Engineer', score: 71, rec: 'REVIEW' as const },
              { company: 'Cedar Analytics', title: 'Full-stack Engineer', score: 58, rec: 'SKIP' as const },
            ].map((row) => (
              <li key={row.title} className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-3">
                <div>
                  <p className="text-sm font-semibold text-charcoal">{row.title}</p>
                  <p className="text-xs text-muted">{row.company}</p>
                </div>
                <div className="flex items-center gap-2">
                  <ScoreBadge score={row.score} />
                  <RecommendationBadge value={row.rec} />
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-5 rounded-xl bg-canvas px-4 py-3">
            <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-charcoal">
              <Briefcase size={16} className="text-olive" />
              Application tracking
            </p>
            <div className="flex flex-wrap gap-2">
              <StatusBadge status="ready" />
              <StatusBadge status="applied" />
              <StatusBadge status="interview" />
            </div>
            <p className="mt-2 text-xs text-muted">Statuses are updated by you — not submitted automatically.</p>
          </div>
        </div>
      </div>
    </div>
  )
}
