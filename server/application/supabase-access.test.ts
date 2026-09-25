import { afterEach, describe, expect, it, vi } from 'vitest'
import { getServerConfig } from '../config'
import {
  FAKE_SUPABASE_URL,
  fakeSessionToken,
  installFakeSupabase,
  uninstallFakeSupabase,
} from '../testing/fake-supabase'
import {
  authenticateSupabaseUser,
  bearerToken,
  describeSupabaseServer,
  isSupabaseAuthConfigured,
  serviceRoleKeyState,
  supabaseDataClient,
} from './supabase-access'

const USER_ID = '88888888-8888-4888-8888-888888888888'

function jwtKey(payload: Record<string, unknown>) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.signature`
}

afterEach(() => {
  uninstallFakeSupabase()
  vi.restoreAllMocks()
})

describe('authenticateSupabaseUser', () => {
  it('requires a bearer session', async () => {
    installFakeSupabase({ users: [{ id: USER_ID }] })
    expect(bearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi')
    expect(bearerToken('Basic abc')).toBeNull()
    await expect(authenticateSupabaseUser(undefined, getServerConfig())).rejects.toMatchObject({
      code: 'AUTH_NOT_AVAILABLE',
      status: 401,
    })
  })

  it('resolves the authenticated user id from a valid Supabase session', async () => {
    installFakeSupabase({ users: [{ id: USER_ID }] })
    const token = fakeSessionToken(USER_ID)
    await expect(authenticateSupabaseUser(`Bearer ${token}`, getServerConfig())).resolves.toEqual({ id: USER_ID, accessToken: token })
  })

  it('still verifies sessions when Node.js has no built-in WebSocket (Node.js 20 and older)', async () => {
    installFakeSupabase({ users: [{ id: USER_ID }] })
    vi.stubGlobal('WebSocket', undefined)
    await expect(authenticateSupabaseUser(`Bearer ${fakeSessionToken(USER_ID)}`, getServerConfig())).resolves.toMatchObject({
      id: USER_ID,
    })
  })

  it('reports expired and unknown sessions as AUTH_NOT_AVAILABLE', async () => {
    installFakeSupabase({ users: [{ id: USER_ID }] })
    for (const token of [fakeSessionToken(USER_ID, { expired: true }), fakeSessionToken('99999999-9999-4999-8999-999999999999')]) {
      await expect(authenticateSupabaseUser(`Bearer ${token}`, getServerConfig())).rejects.toMatchObject({
        code: 'AUTH_NOT_AVAILABLE',
        status: 401,
      })
    }
  })

  it('reports a session from another Supabase project as SUPABASE_PROJECT_MISMATCH', async () => {
    installFakeSupabase({ users: [{ id: USER_ID }] })
    const token = fakeSessionToken(USER_ID, { projectRef: 'another-project' })
    await expect(authenticateSupabaseUser(`Bearer ${token}`, getServerConfig())).rejects.toMatchObject({
      code: 'SUPABASE_PROJECT_MISMATCH',
      message: expect.stringMatching(/different Supabase project/),
    })
  })

  it('reports missing or malformed server settings as SUPABASE_NOT_CONFIGURED', async () => {
    installFakeSupabase({ users: [{ id: USER_ID }] })
    const config = getServerConfig()
    const bearer = `Bearer ${fakeSessionToken(USER_ID)}`
    await expect(authenticateSupabaseUser(bearer, { ...config, supabaseUrl: '' })).rejects.toMatchObject({
      code: 'SUPABASE_NOT_CONFIGURED',
      status: 503,
      message: expect.stringMatching(/SUPABASE_URL is not set/),
    })
    await expect(
      authenticateSupabaseUser(bearer, { ...config, supabaseUrl: 'postgresql://postgres@db.fake-project.supabase.co:5432/postgres' }),
    ).rejects.toMatchObject({ code: 'SUPABASE_NOT_CONFIGURED', message: expect.stringMatching(/http\(s\) project URL/) })
    await expect(
      authenticateSupabaseUser(bearer, { ...config, supabaseServiceRoleKey: '', supabaseAnonKey: '' }),
    ).rejects.toMatchObject({ code: 'SUPABASE_NOT_CONFIGURED', message: expect.stringMatching(/cannot verify sign-ins/) })
  })

  it('reports network failures and Supabase outages as SUPABASE_UNREACHABLE with the cause', async () => {
    installFakeSupabase({ users: [{ id: USER_ID }], failures: { network: 'ENOTFOUND' } })
    const bearer = `Bearer ${fakeSessionToken(USER_ID)}`
    await expect(authenticateSupabaseUser(bearer, getServerConfig())).rejects.toMatchObject({
      code: 'SUPABASE_UNREACHABLE',
      status: 503,
      message: 'Supabase could not be reached to verify the sign-in (ENOTFOUND).',
    })
    uninstallFakeSupabase()
    installFakeSupabase({ users: [{ id: USER_ID }], failures: { auth: 503 } })
    await expect(authenticateSupabaseUser(bearer, getServerConfig())).rejects.toMatchObject({
      code: 'SUPABASE_UNREACHABLE',
      message: expect.stringMatching(/HTTP 503/),
    })
  })

  it("reports a rejected server API key as SUPABASE_NOT_CONFIGURED, not as the user's session", async () => {
    installFakeSupabase({ users: [{ id: USER_ID }], failures: { apiKey: true } })
    await expect(authenticateSupabaseUser(`Bearer ${fakeSessionToken(USER_ID)}`, getServerConfig())).rejects.toMatchObject({
      code: 'SUPABASE_NOT_CONFIGURED',
    })
  })

  it('verifies sessions with the anon key when the service-role key is missing', async () => {
    installFakeSupabase({ users: [{ id: USER_ID }] }, { serviceRoleKey: null })
    await expect(authenticateSupabaseUser(`Bearer ${fakeSessionToken(USER_ID)}`, getServerConfig())).resolves.toMatchObject({ id: USER_ID })
  })

  it('logs whether the authorization header was present without logging the token', async () => {
    installFakeSupabase({ users: [{ id: USER_ID }] })
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const token = fakeSessionToken(USER_ID)
    await authenticateSupabaseUser(`Bearer ${token}`, getServerConfig())
    await authenticateSupabaseUser(undefined, getServerConfig()).catch(() => undefined)
    const lines = info.mock.calls.map((call) => String(call[0]))
    expect(lines).toContain('[Auth] authorization header present=yes user resolved=yes')
    expect(lines.some((line) => line.startsWith('[Auth] authorization header present=no user resolved=no failure=AUTH_NOT_AVAILABLE'))).toBe(true)
    expect(lines.join('\n')).not.toContain(token)
    expect(lines.join('\n')).not.toContain(USER_ID)
  })
})

describe('Supabase server configuration', () => {
  it('detects missing, anon, and other-project service-role keys without exposing them', () => {
    const base = { ...getServerConfig(), supabaseUrl: 'https://abcdefgh.supabase.co' }
    expect(serviceRoleKeyState({ ...base, supabaseServiceRoleKey: '' })).toBe('missing')
    expect(serviceRoleKeyState({ ...base, supabaseServiceRoleKey: jwtKey({ role: 'anon', ref: 'abcdefgh' }) })).toBe('not_service_role')
    expect(serviceRoleKeyState({ ...base, supabaseServiceRoleKey: jwtKey({ role: 'service_role', ref: 'zzzzzzzz' }) })).toBe('project_mismatch')
    expect(serviceRoleKeyState({ ...base, supabaseServiceRoleKey: jwtKey({ role: 'service_role', ref: 'abcdefgh' }) })).toBe('present')
    expect(serviceRoleKeyState({ ...base, supabaseServiceRoleKey: 'sb_publishable_123' })).toBe('not_service_role')
    const described = describeSupabaseServer({
      ...base,
      supabaseServiceRoleKey: jwtKey({ role: 'service_role', ref: 'abcdefgh' }),
      frontendSupabaseUrl: 'https://abcdefgh.supabase.co',
      supabaseAnonKey: 'anon',
    })
    expect(described).toEqual({ urlConfigured: true, serviceRole: 'present', anonConfigured: true, frontendProject: 'matches' })
    expect(describeSupabaseServer({ ...base, frontendSupabaseUrl: 'https://other.supabase.co' }).frontendProject).toBe('differs')
    expect(JSON.stringify(described)).not.toContain('service_role')
  })

  it('treats the server as configured only with an http(s) URL and a key that can verify sign-ins', () => {
    const base = { ...getServerConfig(), supabaseUrl: 'https://abcdefgh.supabase.co', supabaseServiceRoleKey: '', supabaseAnonKey: 'anon' }
    expect(isSupabaseAuthConfigured(base)).toBe(true)
    expect(isSupabaseAuthConfigured({ ...base, supabaseAnonKey: '' })).toBe(false)
    expect(isSupabaseAuthConfigured({ ...base, supabaseUrl: '' })).toBe(false)
    expect(isSupabaseAuthConfigured({ ...base, supabaseUrl: 'db.abcdefgh.supabase.co' })).toBe(false)
  })

  it('reads with the service-role key when valid, otherwise as the signed-in user', () => {
    installFakeSupabase({}, { serviceRoleKey: null })
    const config = getServerConfig()
    expect(() => supabaseDataClient({ config })).toThrow(expect.objectContaining({ code: 'SUPABASE_NOT_CONFIGURED' }))
    expect(() => supabaseDataClient({ config, accessToken: fakeSessionToken(USER_ID) })).not.toThrow()
    expect(() => supabaseDataClient({ config: { ...config, supabaseAnonKey: '' }, accessToken: 'x.y.z' })).toThrow(/SUPABASE_SERVICE_ROLE_KEY is not set/)
    expect(config.supabaseUrl).toBe(FAKE_SUPABASE_URL)
  })
})
