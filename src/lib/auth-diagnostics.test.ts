import { describe, expect, it, vi } from 'vitest'
import { diagnoseSupabaseAuth, type AuthDiagnosticsInput } from './auth-diagnostics'

const TOKEN = 'header.payload.signature'
const HEALTH = {
  supabaseConfigured: true,
  sessionAvailable: true,
  userAvailable: true,
  profileAvailable: true,
  failure: null,
  detail: null,
}
const configured = { url: 'https://abcdefghijklmnopqrst.supabase.co', anonKey: 'anon-key', healthUrl: '/api/auth/health' }

type AuthErrorShape = { name?: string; status?: number; message?: string }

function fakeClient(options: { session: boolean; user: boolean; userError?: AuthErrorShape }): AuthDiagnosticsInput['client'] {
  return {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: options.session ? { access_token: TOKEN } : null }, error: null })),
      getUser: vi.fn(async () => ({ data: { user: options.user ? { id: 'user-id' } : null }, error: options.userError ?? null })),
    },
  } as unknown as AuthDiagnosticsInput['client']
}

function healthFetch(body: unknown = HEALTH, status = 200) {
  return vi.fn<typeof fetch>(
    async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  )
}

function sentAuthorization(fetchImpl: ReturnType<typeof healthFetch>) {
  return new Headers(fetchImpl.mock.calls[0][1]?.headers).get('Authorization')
}

describe('diagnoseSupabaseAuth', () => {
  it('reports a missing Supabase URL or anon key as an uninitialized client', async () => {
    const fetchImpl = healthFetch({ ...HEALTH, sessionAvailable: false, userAvailable: false, profileAvailable: false })
    const noUrl = await diagnoseSupabaseAuth({ client: null, url: '', anonKey: 'anon-key', healthUrl: '/api/auth/health', fetchImpl })
    expect(noUrl).toMatchObject({
      urlConfigured: false,
      anonKeyConfigured: true,
      clientInitialized: false,
      sessionExists: false,
      userExists: false,
      userIdAvailable: false,
      supabaseRequest: 'CLIENT_NOT_INITIALIZED',
      authHeaderSent: false,
    })
    expect(sentAuthorization(fetchImpl)).toBeNull()
    const noAnonKey = await diagnoseSupabaseAuth({ ...configured, anonKey: ' ', client: null, fetchImpl })
    expect(noAnonKey).toMatchObject({ urlConfigured: true, anonKeyConfigured: false, clientInitialized: false })
  })

  it('reports a signed-out browser and sends no session to the API', async () => {
    const fetchImpl = healthFetch({ ...HEALTH, sessionAvailable: false, userAvailable: false, profileAvailable: false, failure: 'AUTH_NOT_AVAILABLE' })
    const result = await diagnoseSupabaseAuth({
      ...configured,
      client: fakeClient({ session: false, user: false, userError: { name: 'AuthSessionMissingError', status: 400 } }),
      fetchImpl,
    })
    expect(result).toMatchObject({
      clientInitialized: true,
      sessionExists: false,
      userExists: false,
      userIdAvailable: false,
      supabaseRequest: 'NO_SESSION',
      authHeaderSent: false,
      backend: { failure: 'AUTH_NOT_AVAILABLE' },
    })
    expect(sentAuthorization(fetchImpl)).toBeNull()
  })

  it('sends the session to the API and reports the signed-in user without exposing the token', async () => {
    const fetchImpl = healthFetch()
    const result = await diagnoseSupabaseAuth({ ...configured, client: fakeClient({ session: true, user: true }), fetchImpl })
    expect(result).toEqual({
      urlConfigured: true,
      anonKeyConfigured: true,
      clientInitialized: true,
      sessionExists: true,
      userExists: true,
      userIdAvailable: true,
      supabaseRequest: 'OK',
      authHeaderSent: true,
      backend: HEALTH,
    })
    expect(sentAuthorization(fetchImpl)).toBe(`Bearer ${TOKEN}`)
    expect(JSON.stringify(result)).not.toContain(TOKEN)
  })

  it('names the failure category when the browser cannot use its session', async () => {
    const cases: Array<[AuthErrorShape, string]> = [
      [{ name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' }, 'NETWORK_OR_CORS'],
      [{ name: 'AuthApiError', status: 403, message: 'invalid JWT' }, 'SESSION_REJECTED_HTTP_403'],
      [{ name: 'AuthApiError', status: 401, message: 'Invalid API key' }, 'INVALID_ANON_KEY'],
      [{ name: 'AuthApiError', status: 500, message: 'unexpected failure' }, 'HTTP_500'],
    ]
    for (const [userError, category] of cases) {
      const result = await diagnoseSupabaseAuth({
        ...configured,
        client: fakeClient({ session: true, user: false, userError }),
        fetchImpl: healthFetch(),
      })
      expect(result).toMatchObject({ sessionExists: true, userExists: false, supabaseRequest: category })
    }
  })

  it('reports an unreachable or failing API separately from Supabase', async () => {
    const client = fakeClient({ session: true, user: true })
    const down = vi.fn<typeof fetch>(async () => {
      throw new TypeError('Failed to fetch')
    })
    expect((await diagnoseSupabaseAuth({ ...configured, client, fetchImpl: down })).backend).toEqual({ error: 'API_UNREACHABLE' })
    expect((await diagnoseSupabaseAuth({ ...configured, client, fetchImpl: healthFetch({}, 502) })).backend).toEqual({ error: 'HTTP_502' })
  })
})
