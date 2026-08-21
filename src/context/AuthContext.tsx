import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { DEMO_USER_ID } from '@/data/sample'

const DEMO_FLAG = 'jobpilot.demo'

export interface AuthUser {
  id: string
  email: string
  fullName?: string
}

interface AuthContextValue {
  loading: boolean
  isDemo: boolean
  supabaseEnabled: boolean
  user: AuthUser | null
  enterDemo: () => void
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string, fullName: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [isDemo, setIsDemo] = useState(() => sessionStorage.getItem(DEMO_FLAG) === '1')
  const [user, setUser] = useState<AuthUser | null>(null)

  useEffect(() => {
    if (isDemo) {
      setUser({ id: DEMO_USER_ID, email: 'alex.rivera@example.com', fullName: 'Alex Rivera' })
      setLoading(false)
      return
    }

    if (!supabase) {
      setUser(null)
      setLoading(false)
      return
    }

    let mounted = true
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return
      const sessionUser = data.session?.user
      setUser(
        sessionUser
          ? {
              id: sessionUser.id,
              email: sessionUser.email ?? '',
              fullName: sessionUser.user_metadata?.full_name as string | undefined,
            }
          : null,
      )
      setLoading(false)
    })

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const sessionUser = session?.user
      setUser(
        sessionUser
          ? {
              id: sessionUser.id,
              email: sessionUser.email ?? '',
              fullName: sessionUser.user_metadata?.full_name as string | undefined,
            }
          : null,
      )
    })

    return () => {
      mounted = false
      data.subscription.unsubscribe()
    }
  }, [isDemo])

  const value = useMemo<AuthContextValue>(
    () => ({
      loading,
      isDemo,
      supabaseEnabled: isSupabaseConfigured,
      user,
      enterDemo: () => {
        sessionStorage.setItem(DEMO_FLAG, '1')
        setIsDemo(true)
        setUser({ id: DEMO_USER_ID, email: 'alex.rivera@example.com', fullName: 'Alex Rivera' })
      },
      signIn: async (email, password) => {
        if (!supabase) throw new Error('Supabase is not configured. Use demo mode or add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
        sessionStorage.removeItem(DEMO_FLAG)
        setIsDemo(false)
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      },
      signUp: async (email, password, fullName) => {
        if (!supabase) throw new Error('Supabase is not configured. Use demo mode or add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
        sessionStorage.removeItem(DEMO_FLAG)
        setIsDemo(false)
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName } },
        })
        if (error) throw error
      },
      signOut: async () => {
        sessionStorage.removeItem(DEMO_FLAG)
        sessionStorage.removeItem('jobpilot.workspace')
        setIsDemo(false)
        setUser(null)
        if (supabase) await supabase.auth.signOut()
      },
    }),
    [isDemo, loading, user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
