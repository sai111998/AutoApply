import { describe, expect, it } from 'vitest'
import { backendOriginsFor, isJobPilotAppUrl, userIdFromStorageLike } from './page-session'

describe('extension page session', () => {
  it('tries the JobPilot origin first, then the local API', () => {
    expect(backendOriginsFor('http://localhost:5173/')).toEqual([
      'http://localhost:5173',
      'http://127.0.0.1:8787',
      'http://localhost:8787',
    ])
  })

  it('recognizes the JobPilot app tab so it is not treated as an employer application', () => {
    expect(isJobPilotAppUrl('http://localhost:5173/jobs')).toBe(true)
    expect(isJobPilotAppUrl('https://boards.greenhouse.io/gitlab')).toBe(false)
  })

  it('reads the JobPilot user from session or Supabase storage without inventing one', () => {
    expect(userIdFromStorageLike({})).toBeNull()
    expect(userIdFromStorageLike({ sessionUserId: 'user-1' })).toBe('user-1')
    expect(
      userIdFromStorageLike({
        localValues: { 'sb-test-auth-token': JSON.stringify({ user: { id: 'supabase-user' } }) },
      }),
    ).toBe('supabase-user')
  })
})
