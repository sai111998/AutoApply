import { afterEach, describe, expect, it } from 'vitest'
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
})

describe('authenticateSupabaseUser', () => {
  it('requires a bearer session', async () => {
    installFakeSupabase({ users: [{ id: USER_ID }] })
    expect(bearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi')
    expect(bearerToken('Basic abc')).toBeNull()
    await expect(authenticateSupabaseUser(undefined, getServerConfig())).rejects.toMatchObject({
      code: 'PROFILE_AUTH_REQUIRED',
      status: 401,
    })
  })

  it('resolves the authenticated user id from a valid Supabase session', async () => {
    installFakeSupabase({ users: [{ id: USER_ID }] })
    const token = fakeSessionToken(USER_ID)
    await expect(authenticateSupabaseUser(`Bearer ${token}`, getServerConfig())).resolves.toEqual({ id: USER_ID, accessToken: token })
  })

  it('rejects expired, unknown, and other-project sessions', async () => {
    installFakeSupabase({ users: [{ id: USER_ID }] })
    const config = getServerConfig()
    for (const token of [
      fakeSessionToken(USER_ID, { expired: true }),
      fakeSessionToken('99999999-9999-4999-8999-999999999999'),
      fakeSessionToken(USER_ID, { projectRef: 'another-project' }),
    ]) {
      await expect(authenticateSupabaseUser(`Bearer ${token}`, config)).rejects.toMatchObject({ code: 'PROFILE_AUTH_REQUIRED' })
    }
    await expect(
      authenticateSupabaseUser(`Bearer ${fakeSessionToken(USER_ID, { projectRef: 'another-project' })}`, config),
    ).rejects.toThrow(/different Supabase project/)
  })

  it('reports a server without Supabase as a database error, not a sign-in problem', async () => {
    const config = { ...getServerConfig(), supabaseUrl: '' }
    await expect(authenticateSupabaseUser(`Bearer ${fakeSessionToken(USER_ID)}`, config)).rejects.toMatchObject({
      code: 'PROFILE_DATABASE_ERROR',
      status: 503,
    })
  })

  it('verifies sessions with the anon key when the service-role key is missing', async () => {
    installFakeSupabase({ users: [{ id: USER_ID }] }, { serviceRoleKey: null })
    await expect(authenticateSupabaseUser(`Bearer ${fakeSessionToken(USER_ID)}`, getServerConfig())).resolves.toMatchObject({ id: USER_ID })
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

  it('reads with the service-role key when valid, otherwise as the signed-in user', () => {
    installFakeSupabase({}, { serviceRoleKey: null })
    const config = getServerConfig()
    expect(() => supabaseDataClient({ config })).toThrow(expect.objectContaining({ code: 'PROFILE_DATABASE_ERROR' }))
    expect(() => supabaseDataClient({ config, accessToken: fakeSessionToken(USER_ID) })).not.toThrow()
    expect(() => supabaseDataClient({ config: { ...config, supabaseAnonKey: '' }, accessToken: 'x.y.z' })).toThrow(/SUPABASE_SERVICE_ROLE_KEY is not set/)
    expect(config.supabaseUrl).toBe(FAKE_SUPABASE_URL)
  })
})
