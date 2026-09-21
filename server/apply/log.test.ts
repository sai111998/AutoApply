import { describe, expect, it, vi } from 'vitest'
import { logApplyEvent } from './log'

describe('auto apply debug logging', () => {
  it('records application debug fields and redacts secrets', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    logApplyEvent('application-debug', {
      jobId: 'job-1',
      applicationId: 'app-1',
      resumeVersionId: 'resume-1',
      discoveryProvider: 'job-opportunities',
      applicationProvider: 'greenhouse',
      capability: 'auto_apply_supported',
      matchScore: 88,
      initialUrl: 'https://boards.greenhouse.io/acme/jobs/1',
      finalUrl: 'https://boards.greenhouse.io/acme/jobs/1/apply',
      pageType: 'APPLICATION_PAGE',
      detectedFields: ['email', 'firstName'],
      questionMappings: ['workAuthorization'],
      submissionResult: 'submitted',
      confirmationResult: 'confirmed',
    })
    expect(info).toHaveBeenCalled()
    const payload = info.mock.calls[0]?.[1] as Record<string, unknown>
    expect(payload.jobId).toBe('job-1')
    expect(payload.discoveryProvider).toBe('job-opportunities')
    expect(payload.applicationProvider).toBe('greenhouse')
    expect(payload.pageType).toBe('APPLICATION_PAGE')
    info.mockRestore()

    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    logApplyEvent('application-debug', {
      jobId: 'job-1',
      error: 'password=super-secret token=abc',
    })
    const failed = error.mock.calls[0]?.[1] as Record<string, unknown>
    expect(String(failed.error)).toBe('[redacted]')
    error.mockRestore()
  })
})
