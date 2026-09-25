import { afterEach, describe, expect, it } from 'vitest'
import {
  applyConfirmationToQueueItem,
  buildConfirmedApplicationRecord,
  findConfirmedApplication,
  persistConfirmedSubmission,
  rememberConfirmedApplication,
  resetConfirmedApplicationsForTests,
  shouldPersistConfirmedApplication,
} from './confirmed'
import type { AutoApplyQueueItem } from './types'

function item(overrides: Partial<AutoApplyQueueItem> = {}): AutoApplyQueueItem {
  return {
    id: 'item-1',
    runId: 'run-1',
    jobId: '3b9f0c2a-7d11-4c3a-9f12-8a1b2c3d4e60',
    identityKey: 'job-opportunities:java',
    applicationId: '3b9f0c2a-7d11-4c3a-9f12-8a1b2c3d4e61',
    resumeVersionId: '3b9f0c2a-7d11-4c3a-9f12-8a1b2c3d4e62',
    resumeVersionName: 'Submitted — Java Engineer',
    title: 'Java Engineer',
    company: 'Acme',
    applicationUrl: 'https://jobs.example.com/apply',
    initialMatchScore: 80,
    finalMatchScore: 87,
    c2cStatus: 'confirmed',
    c2cEvidence: [],
    applicationStatus: 'submitted',
    failureReason: null,
    questions: [],
    tailoredResumeText: 'Exact submitted Java resume',
    jobDescriptionSnapshot: 'Java Spring Boot C2C corp to corp',
    location: 'Austin, TX',
    confirmationNumber: 'ABC12345',
    confirmationText: 'Your application was submitted',
    submittedAt: '2026-09-20T12:00:00.000Z',
    masterResumeUnchanged: true,
    sessionId: null,
    createdAt: '2026-09-20T11:00:00.000Z',
    updatedAt: '2026-09-20T12:00:00.000Z',
    ...overrides,
  }
}

afterEach(() => {
  resetConfirmedApplicationsForTests()
})

describe('confirmed Auto Apply submissions', () => {
  it('does not persist Applications until confirmed submission', () => {
    expect(shouldPersistConfirmedApplication(item({ applicationStatus: 'queued' }))).toBe(false)
    expect(shouldPersistConfirmedApplication(item({ applicationStatus: 'opening' }))).toBe(false)
    expect(shouldPersistConfirmedApplication(item({ applicationStatus: 'filling' }))).toBe(false)
    expect(shouldPersistConfirmedApplication(item({ applicationStatus: 'ready_for_submission' }))).toBe(false)
    expect(shouldPersistConfirmedApplication(item({ applicationStatus: 'captcha_required' }))).toBe(false)
    expect(shouldPersistConfirmedApplication(item({ applicationStatus: 'needs_confirmation' }))).toBe(false)
    expect(shouldPersistConfirmedApplication(item({ applicationStatus: 'submitted' }))).toBe(true)
    expect(buildConfirmedApplicationRecord({ userId: 'user-1', item: item({ applicationStatus: 'queued' }) })).toBeNull()
  })

  it('stores the JD snapshot, submitted resume id, and confirmation on the Applications record', async () => {
    const queued = item({ applicationStatus: 'submitting', confirmationNumber: null, submittedAt: null })
    applyConfirmationToQueueItem(queued, {
      success: true,
      confirmed: true,
      detected: true,
      confirmationNumber: 'ABC12345',
      confirmationText: 'Your application was submitted',
      finalUrl: 'https://jobs.example.com/confirm',
    }, '2026-09-20T12:05:00.000Z')
    expect(queued.applicationStatus).toBe('submitted')
    const stored = await persistConfirmedSubmission({ userId: 'user-1', item: queued })
    expect(stored?.status).toBe('applied')
    expect(stored?.isConfirmedSubmission).toBe(true)
    expect(stored?.submittedJobDescriptionSnapshot).toContain('Spring Boot')
    expect(stored?.submittedResumeVersionId).toBe(queued.resumeVersionId)
    expect(stored?.applicationUrl).toBe('https://jobs.example.com/confirm')
    expect(stored?.confirmationNumber).toBe('ABC12345')
    expect(findConfirmedApplication('user-1', queued)?.applicationId).toBe(stored?.applicationId)
  })

  it('does not create a duplicate Applications record for the same job', async () => {
    const first = await persistConfirmedSubmission({ userId: 'user-1', item: item() })
    const second = await persistConfirmedSubmission({
      userId: 'user-1',
      item: item({ applicationId: '3b9f0c2a-7d11-4c3a-9f12-8a1b2c3d4e99' }),
    })
    expect(first?.applicationId).toBe(second?.applicationId)
    expect(rememberConfirmedApplication(first!).applicationId).toBe(first?.applicationId)
  })

  it('does not treat an unconfirmed submit as Applied', () => {
    const queued = item({ applicationStatus: 'submitting' })
    applyConfirmationToQueueItem(queued, {
      success: false,
      confirmed: false,
      detected: false,
      reason: 'No reliable submission confirmation was found.',
    })
    expect(queued.applicationStatus).toBe('needs_confirmation')
    expect(shouldPersistConfirmedApplication(queued)).toBe(false)
  })
})
