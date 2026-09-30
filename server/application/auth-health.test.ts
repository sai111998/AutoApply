import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../app'
import { getServerConfig } from '../config'
import { fakeSessionToken, installFakeSupabase, uninstallFakeSupabase, type FakeSupabaseData } from '../testing/fake-supabase'

const USER_ID = '66666666-6666-4666-8666-666666666666'

function profileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: USER_ID,
    full_name: 'Grace Hopper',
    first_name: 'Grace',
    last_name: 'Hopper',
    email: 'grace@example.com',
    phone: '555-0199',
    ...overrides,
  }
}

function seed(data: FakeSupabaseData = {}) {
  installFakeSupabase({ users: [{ id: USER_ID }], profiles: [profileRow()], ...data })
}

async function health(authorization?: string, config = getServerConfig()) {
  const call = request(createApp({ config })).get('/api/auth/health')
  const response = await (authorization ? call.set('Authorization', authorization) : call)
  expect(response.status).toBe(200)
  return response.body as Record<string, unknown>
}

const bearer = (options?: Parameters<typeof fakeSessionToken>[1]) => `Bearer ${fakeSessionToken(USER_ID, options)}`

afterEach(() => {
  uninstallFakeSupabase()
})

describe('GET /api/auth/health', () => {
  it('reports a server without Supabase settings before looking at the session', async () => {
    const unconfigured = { ...getServerConfig(), supabaseUrl: '', supabaseServiceRoleKey: '', supabaseAnonKey: '' }
    expect(await health(bearer(), unconfigured)).toEqual({
      supabaseConfigured: false,
      sessionAvailable: true,
      userAvailable: false,
      profileAvailable: false,
      failure: 'SUPABASE_NOT_CONFIGURED',
      detail: expect.stringMatching(/SUPABASE_URL is not set/),
    })
  })

  it('reports a missing session as AUTH_NOT_AVAILABLE', async () => {
    seed()
    expect(await health()).toMatchObject({
      supabaseConfigured: true,
      sessionAvailable: false,
      userAvailable: false,
      profileAvailable: false,
      failure: 'AUTH_NOT_AVAILABLE',
    })
  })

  it('resolves the signed-in user and the public.profiles row without returning tokens or values', async () => {
    seed()
    const token = fakeSessionToken(USER_ID)
    const body = await health(`Bearer ${token}`)
    expect(body).toEqual({
      supabaseConfigured: true,
      sessionAvailable: true,
      userAvailable: true,
      profileAvailable: true,
      failure: null,
      detail: null,
    })
    expect(JSON.stringify(body)).not.toMatch(new RegExp([token, USER_ID, 'Grace', 'Hopper', 'grace@example.com', '555-0199'].join('|')))
  })

  it('keeps a missing profile row and an incomplete profile distinct from sign-in failures', async () => {
    seed({ profiles: [] })
    expect(await health(bearer())).toMatchObject({ userAvailable: true, profileAvailable: false, failure: 'PROFILE_NOT_FOUND' })
    uninstallFakeSupabase()
    seed({ profiles: [profileRow({ last_name: null, full_name: 'Grace', phone: null })] })
    expect(await health(bearer())).toMatchObject({
      userAvailable: true,
      profileAvailable: true,
      failure: 'PROFILE_INCOMPLETE',
      detail: 'Missing on the Profile page: lastName, phone.',
    })
  })

  it('reports an unreachable Supabase and a project mismatch as their own failures', async () => {
    seed({ failures: { network: 'ETIMEDOUT' } })
    expect(await health(bearer())).toMatchObject({
      sessionAvailable: true,
      userAvailable: false,
      failure: 'SUPABASE_UNREACHABLE',
      detail: expect.stringMatching(/ETIMEDOUT/),
    })
    uninstallFakeSupabase()
    seed()
    expect(await health(bearer({ projectRef: 'another-project' }))).toMatchObject({
      userAvailable: false,
      failure: 'SUPABASE_PROJECT_MISMATCH',
    })
  })

  it('works on Node.js versions without a built-in WebSocket', async () => {
    seed()
    vi.stubGlobal('WebSocket', undefined)
    expect(await health(bearer())).toMatchObject({ userAvailable: true, profileAvailable: true, failure: null })
  })
})
