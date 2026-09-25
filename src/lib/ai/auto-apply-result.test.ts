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
})
