import { FormEvent, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { Compass, ShieldCheck, Sparkles } from 'lucide-react'
import { BrandMark } from '@/components/BrandMark'
import { Button } from '@/components/ui/Button'
import { Field, TextInput } from '@/components/ui/Field'
import { useAuth } from '@/context/AuthContext'

export function LoginPage() {
  const { user, loading, supabaseEnabled, signIn, enterDemo } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (!loading && user) return <Navigate to="/" replace />

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await signIn(email, password)
      navigate('/')
    } catch (signInError) {
      setError(signInError instanceof Error ? signInError.message : 'Could not sign in')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="auth-grid">
      <section className="relative hidden overflow-hidden bg-navy px-10 py-12 text-white min-[901px]:flex min-[901px]:flex-col">
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              'radial-gradient(circle at 20% 20%, #2aa56c33, transparent 40%), radial-gradient(circle at 80% 80%, #c4a05622, transparent 42%)',
          }}
        />
        <BrandMark light />
        <div className="relative mt-auto max-w-md pb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-moss">Job search, instrumented</p>
          <h1 className="mt-3 font-display text-5xl leading-tight">See the fit before you apply.</h1>
          <p className="mt-4 text-white/70">
            Track roles, store resume versions, and route job descriptions through an analysis API when you connect one.
            This MVP does not auto-submit applications.
          </p>
          <ul className="mt-8 space-y-3 text-sm text-white/80">
            <li className="flex gap-3">
              <Sparkles size={18} className="text-moss" /> Transparent match scores from your analysis backend
            </li>
            <li className="flex gap-3">
              <ShieldCheck size={18} className="text-gold" /> Auth, Postgres, and resume storage on Supabase
            </li>
            <li className="flex gap-3">
              <Compass size={18} className="text-sky" /> A cockpit for ready, applied, and interview pipelines
            </li>
          </ul>
        </div>
      </section>
      <section className="grid place-items-center px-6 py-12">
        <div className="w-full max-w-md">
          <div className="mb-8 min-[901px]:hidden">
            <BrandMark />
          </div>
          <h2 className="font-display text-3xl text-navy">Welcome back</h2>
          <p className="mt-2 text-slate-ink">
            {supabaseEnabled
              ? 'Sign in to your workspace or explore the product with sample data.'
              : 'Supabase is not configured yet. Open the sample workspace to use the app immediately.'}
          </p>
          <Button
            type="button"
            className="mt-8 w-full"
            onClick={() => {
              enterDemo()
              navigate('/')
            }}
          >
            Explore with sample data
          </Button>
          <form className="mt-8 space-y-4" onSubmit={(event) => void onSubmit(event)}>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-ink">Or sign in</p>
            <Field label="Email">
              <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Password">
              <TextInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            {error && <p className="text-sm text-clay">{error}</p>}
            {!supabaseEnabled && (
              <p className="text-sm text-slate-ink">
                Email sign-in needs VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY. Until then, use the sample workspace
                above.
              </p>
            )}
            <Button type="submit" variant="secondary" className="w-full" disabled={submitting}>
              {submitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
          <p className="mt-6 text-sm text-slate-ink">
            No account?{' '}
            <Link className="font-semibold text-pine" to="/signup">
              Create one
            </Link>
          </p>
        </div>
      </section>
    </div>
  )
}
