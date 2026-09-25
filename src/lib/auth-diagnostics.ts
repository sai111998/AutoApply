import type { SupabaseClient } from '@supabase/supabase-js'
import { apiUrl } from '@/lib/ai/client'
import { supabase } from '@/lib/supabase'

export interface BackendAuthHealth {
  supabaseConfigured: boolean
  sessionAvailable: boolean
  userAvailable: boolean
  profileAvailable: boolean
  failure: string | null
  detail: string | null
}

export interface AuthDiagnostics {
  urlConfigured: boolean
  anonKeyConfigured: boolean
  clientInitialized: boolean
  sessionExists: boolean
  userExists: boolean
  userIdAvailable: boolean
  supabaseRequest: string
  authHeaderSent: boolean
  backend: BackendAuthHealth | { error: string }
}

export interface AuthDiagnosticsInput {
  client: Pick<SupabaseClient, 'auth'> | null
  url?: string
  anonKey?: string
  healthUrl: string
  fetchImpl?: typeof fetch
}

function supabaseRequestCategory(error: { name?: string; status?: number; message?: string } | null): string {
  if (!error) return 'OK'
  if (error.name === 'AuthSessionMissingError') return 'NO_SESSION'
  if (/api key/i.test(error.message ?? '')) return 'INVALID_ANON_KEY'
  const status = error.status ?? 0
  if (status === 0) return 'NETWORK_OR_CORS'
  if (status === 401 || status === 403) return `SESSION_REJECTED_HTTP_${status}`
  return `HTTP_${status}`
}

export async function diagnoseSupabaseAuth(input: AuthDiagnosticsInput): Promise<AuthDiagnostics> {
  const result: AuthDiagnostics = {
    urlConfigured: Boolean(input.url?.trim()),
    anonKeyConfigured: Boolean(input.anonKey?.trim()),
    clientInitialized: Boolean(input.client),
    sessionExists: false,
    userExists: false,
    userIdAvailable: false,
    supabaseRequest: 'CLIENT_NOT_INITIALIZED',
    authHeaderSent: false,
    backend: { error: 'NOT_CHECKED' },
  }
  let token: string | null = null
  if (input.client) {
    const { data: sessionData } = await input.client.auth.getSession()
    token = sessionData.session?.access_token ?? null
    result.sessionExists = Boolean(token)
    const { data: userData, error } = await input.client.auth.getUser()
    result.userExists = Boolean(userData.user)
    result.userIdAvailable = Boolean(userData.user?.id)
    result.supabaseRequest = supabaseRequestCategory(error)
  }
  result.authHeaderSent = Boolean(token)
  try {
    const response = await (input.fetchImpl ?? fetch)(input.healthUrl, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    result.backend = response.ok ? ((await response.json()) as BackendAuthHealth) : { error: `HTTP_${response.status}` }
  } catch {
    result.backend = { error: 'API_UNREACHABLE' }
  }
  return result
}

declare global {
  interface Window {
    jobpilotAuthCheck?: () => Promise<AuthDiagnostics>
  }
}

export function registerAuthDiagnostics() {
  window.jobpilotAuthCheck = () =>
    diagnoseSupabaseAuth({
      client: supabase,
      url: import.meta.env.VITE_SUPABASE_URL,
      anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      healthUrl: apiUrl('/api/auth/health'),
    })
}
