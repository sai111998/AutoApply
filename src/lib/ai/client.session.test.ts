import { afterEach, describe, expect, it, vi } from 'vitest'

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }))

vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession } }, isSupabaseConfigured: true }))

import { startAutoApplyRequest } from './client'

const payload: Parameters<typeof startAutoApplyRequest>[0] = {
  userId: 'ignored-by-the-server',
  resumeText: 'resume',
  profile: {
    fullName: '',
    email: '',
    location: '',
    yearsOfExperience: null,
    workAuthorization: null,
    sponsorshipRequired: false,
    preferredWorkArrangement: null,
    targetSalaryMin: null,
    targetSalaryMax: null,
  },
  config: { maxJobs: 1, minimumMatchRate: 70, autoTailorResume: false, jobType: 'all', remotePreference: 'any', keywords: [] },
}

function respond(body: unknown, status = 200) {
  const fetchMock = vi.fn<typeof fetch>(
    async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function sentAuthorization(fetchMock: ReturnType<typeof respond>) {
  return new Headers(fetchMock.mock.calls[0][1]?.headers).get('Authorization')
}

afterEach(() => {
  vi.unstubAllGlobals()
  getSession.mockReset()
})

describe('Start Auto Apply authentication', () => {
  it('sends the Supabase session as a bearer token', async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: 'session-token' } }, error: null })
    const fetchMock = respond({ run: { id: 'run-1', status: 'running' }, items: [] })
    await expect(startAutoApplyRequest(payload)).resolves.toMatchObject({ run: { id: 'run-1' } })
    expect(sentAuthorization(fetchMock)).toBe('Bearer session-token')
  })

  it('sends no Authorization header without a session and shows the server sign-in error', async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null })
    const fetchMock = respond(
      { success: false, code: 'AUTH_NOT_AVAILABLE', error: 'Sign in again: the request did not include a Supabase session.' },
      401,
    )
    await expect(startAutoApplyRequest(payload)).rejects.toThrow('Sign in again: the request did not include a Supabase session.')
    expect(sentAuthorization(fetchMock)).toBeNull()
  })

  it('shows an unreachable Supabase as its own error instead of a profile error', async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: 'session-token' } }, error: null })
    respond({ success: false, code: 'SUPABASE_UNREACHABLE', error: 'Supabase could not be reached to verify the sign-in (ENOTFOUND).' }, 503)
    await expect(startAutoApplyRequest(payload)).rejects.toThrow(/could not be reached to verify the sign-in \(ENOTFOUND\)/)
  })
})
