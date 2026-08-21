import { FormEvent, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { BrandMark } from '@/components/BrandMark'
import { Button } from '@/components/ui/Button'
import { Field, TextInput } from '@/components/ui/Field'
import { useAuth } from '@/context/AuthContext'

export function SignupPage() {
  const { user, loading, supabaseEnabled, signUp, enterDemo } = useAuth()
  const navigate = useNavigate()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (!loading && user) return <Navigate to="/" replace />

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    setMessage(null)
    try {
      await signUp(email, password, fullName)
      setMessage('Check your email to confirm the account, then sign in.')
    } catch (signUpError) {
      setError(signUpError instanceof Error ? signUpError.message : 'Could not create account')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="grid min-h-screen place-items-center px-6 py-12">
      <div className="w-full max-w-md">
        <BrandMark />
        <h1 className="mt-8 text-3xl font-semibold tracking-tight text-charcoal">Create your workspace</h1>
        <p className="mt-2 text-slate-ink">
          {supabaseEnabled
            ? 'JobPilot stores profiles, resumes, and applications in your Supabase project.'
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
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-ink">Or create an account</p>
          <Field label="Full name">
            <TextInput value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </Field>
          <Field label="Email">
            <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Password">
            <TextInput type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {error && <p className="text-sm text-danger">{error}</p>}
          {message && <p className="text-sm text-olive">{message}</p>}
          {!supabaseEnabled && (
            <p className="text-sm text-slate-ink">
              Account creation needs VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.
            </p>
          )}
          <Button type="submit" variant="secondary" className="w-full" disabled={submitting}>
            {submitting ? 'Creating account…' : 'Create account'}
          </Button>
        </form>
        <p className="mt-6 text-sm text-slate-ink">
          Already have an account?{' '}
          <Link className="font-semibold text-olive hover:text-olive-dark" to="/login">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
