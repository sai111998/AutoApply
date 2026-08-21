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

  if (!loading && user) return <Navigate to="/dashboard" replace />

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await signIn(email, password)
      navigate('/dashboard')
    } catch (signInError) {
      setError(signInError instanceof Error ? signInError.message : 'Could not sign in')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="auth-grid">
      <section className="relative hidden overflow-hidden bg-olive-dark px-10 py-12 text-white min-[901px]:flex min-[901px]:flex-col">
        <Link to="/" aria-label="JobPilot AI home">
          <BrandMark light />
        </Link>
        <div className="relative mt-auto max-w-md pb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-olive-soft">Job search workspace</p>
          <h1 className="mt-3 text-4xl font-semibold leading-tight tracking-tight">See the fit before you apply.</h1>
          <p className="mt-4 text-sm leading-6 text-white/75">
            Track roles, store resume versions, and keep every analysis in your account. This MVP does not auto-submit
            applications.
          </p>
          <ul className="mt-8 space-y-3 text-sm text-white/85">
            <li className="flex gap-3">
              <Sparkles size={18} className="text-olive-soft" /> Match scores from a server-side analysis API
            </li>
            <li className="flex gap-3">
              <ShieldCheck size={18} className="text-olive-soft" /> Auth, Postgres, and resume storage on Supabase
            </li>
            <li className="flex gap-3">
              <Compass size={18} className="text-olive-soft" /> A calm cockpit for ready, applied, and interview work
            </li>
          </ul>
        </div>
      </section>
      <section className="grid place-items-center bg-canvas px-6 py-12">
        <div className="w-full max-w-md rounded-2xl border border-line bg-white p-8 shadow-card">
          <div className="mb-8 min-[901px]:hidden">
            <Link to="/" aria-label="JobPilot AI home">
              <BrandMark />
            </Link>
          </div>
          <h2 className="text-3xl font-semibold tracking-tight text-charcoal">Welcome back</h2>
          <p className="mt-2 text-sm text-muted">
            {supabaseEnabled
              ? 'Sign in to your workspace or explore the product with sample data.'
              : 'Supabase is not configured yet. Open the sample workspace to use the app immediately.'}
          </p>
          <Button
            type="button"
            className="mt-8 w-full"
            onClick={() => {
              enterDemo()
              navigate('/dashboard')
            }}
          >
            Explore with sample data
          </Button>
          <form className="mt-8 space-y-4" onSubmit={(event) => void onSubmit(event)}>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">Or sign in</p>
            <Field label="Email">
              <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Password">
              <TextInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            {error && <p className="text-sm text-danger">{error}</p>}
            {!supabaseEnabled && (
              <p className="text-sm text-muted">
                Email sign-in needs VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY. Until then, use the sample workspace
                above.
              </p>
            )}
            <Button type="submit" variant="secondary" className="w-full" disabled={submitting}>
              {submitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
          <p className="mt-6 text-sm text-muted">
            No account?{' '}
            <Link className="font-semibold text-olive hover:text-olive-dark" to="/signup">
              Create one
            </Link>
            {' · '}
            <Link className="font-semibold text-olive hover:text-olive-dark" to="/">
              Back to home
            </Link>
          </p>
        </div>
      </section>
    </div>
  )
}
