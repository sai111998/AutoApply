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
        <h1 className="mt-8 font-display text-3xl text-navy">Create your workspace</h1>
        <p className="mt-2 text-slate-ink">
          JobPilot stores profiles, resumes, and applications in your Supabase project.
        </p>
        <form className="mt-8 space-y-4" onSubmit={(event) => void onSubmit(event)}>
          <Field label="Full name">
            <TextInput required value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </Field>
          <Field label="Email">
            <TextInput type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Password">
            <TextInput type="password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {error && <p className="text-sm text-clay">{error}</p>}
          {message && <p className="text-sm text-pine">{message}</p>}
          {!supabaseEnabled && (
            <p className="text-sm text-slate-ink">
              Supabase is not configured. You can still explore the product with sample data.
            </p>
          )}
          <Button type="submit" className="w-full" disabled={submitting || !supabaseEnabled}>
            {submitting ? 'Creating account…' : 'Create account'}
          </Button>
        </form>
        <Button
          type="button"
          variant="secondary"
          className="mt-3 w-full"
          onClick={() => {
            enterDemo()
            navigate('/')
          }}
        >
          Explore with sample data
        </Button>
        <p className="mt-6 text-sm text-slate-ink">
          Already have an account?{' '}
          <Link className="font-semibold text-pine" to="/login">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
