import { describe, expect, it } from 'vitest'
import { normalizeAutoApplyResult, prepareErrorMessage } from './client'

describe('auto apply client result parsing', () => {
  const run = {
    id: 'run-1',
    userId: 'user-1',
    status: 'paused' as const,
    config: {
      maxJobs: 10,
      minimumMatchRate: 85,
      autoTailorResume: true,
      jobType: 'c2c' as const,
      remotePreference: 'any',
      keywords: [],
    },
    counts: {
      found: 1,
      eligible: 1,
      tailored: 0,
      ready: 1,
      needsInput: 0,
      submitted: 0,
      skipped: 0,
      failed: 0,
    },
    createdAt: '2026-09-18T00:00:00.000Z',
    updatedAt: '2026-09-18T00:00:00.000Z',
  }
  const item = {
    id: 'item-1',
    runId: 'run-1',
    jobId: 'job-1',
    identityKey: 'job-opportunities:job-1',
    applicationId: 'app-1',
    resumeVersionId: 'resume-1',
    resumeVersionName: 'Master',
    title: 'Java Engineer',
    company: 'Example',
    applicationUrl: 'https://jobs.example.com/job-1',
    initialMatchScore: 80,
    finalMatchScore: 86,
    c2cStatus: 'confirmed' as const,
    applicationStatus: 'ready_for_submission' as const,
    failureReason: null,
    questions: [],
  }

  it('accepts both items[] and a singular item from prepare', () => {
    expect(normalizeAutoApplyResult({ run, items: [item] })?.items).toHaveLength(1)
    expect(normalizeAutoApplyResult({ run, item })?.items[0].id).toBe('item-1')
    expect(normalizeAutoApplyResult({ run })).toBeNull()
  })

  it('maps structured prepare codes to user-facing messages', () => {
    expect(prepareErrorMessage({ code: 'RESUME_VERSION_NOT_READY' })).toMatch(/still being prepared/i)
    expect(prepareErrorMessage({ code: 'APPLICATION_URL_MISSING' })).toMatch(/application URL/i)
    expect(prepareErrorMessage({ error: 'service.role key leaked' })).toBe('Could not prepare the application.')
  })

  it('keeps sign-in, Supabase, and profile errors distinct without echoing credential names', () => {
    const fallback = 'Could not start Auto Apply.'
    const withheld = prepareErrorMessage(
      { code: 'SUPABASE_NOT_CONFIGURED', error: 'The server cannot read profiles: SUPABASE_SERVICE_ROLE_KEY is not set.' },
      fallback,
    )
    expect(withheld).toMatch(/SUPABASE_NOT_CONFIGURED/)
    expect(withheld).not.toMatch(/key|secret|service.role/i)
    expect(prepareErrorMessage({ code: 'PROFILE_DATABASE_ERROR', error: 'The profile query failed (42703).' }, fallback)).toBe(
      'The profile query failed (42703).',
    )
    expect(prepareErrorMessage({ code: 'AUTH_NOT_AVAILABLE', error: 'Your Supabase session is invalid or expired. Sign in again.' }, fallback)).toMatch(/sign in again/i)
    expect(prepareErrorMessage({ code: 'SUPABASE_UNREACHABLE', error: 'Supabase could not be reached to verify the sign-in (ENOTFOUND).' }, fallback)).toMatch(/ENOTFOUND/)
    expect(
      prepareErrorMessage(
        { code: 'SUPABASE_PROJECT_MISMATCH', error: "Your sign-in session comes from a different Supabase project than the server's SUPABASE_URL." },
        fallback,
      ),
    ).toMatch(/different Supabase project/)
    expect(prepareErrorMessage({ code: 'PROFILE_NOT_FOUND', error: 'No public.profiles row exists for the signed-in user.' }, fallback)).toMatch(/public\.profiles/)
    expect(prepareErrorMessage({ code: 'PROFILE_INCOMPLETE', error: 'Profile incomplete. Add lastName, phone on the Profile page.' }, fallback)).toMatch(/lastName, phone/)
  })
})
