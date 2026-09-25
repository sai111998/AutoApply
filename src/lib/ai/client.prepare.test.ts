import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PREPARE_ERROR_MESSAGES,
  PREPARE_REQUEST_TIMEOUT_MS,
  fetchWithTimeout,
  normalizeAutoApplyResult,
  prepareAutoApplyItemRequest,
  prepareErrorMessage,
  withClientTimeout,
} from './client'

const profile = {
  fullName: 'Jordan Hale',
  email: 'jordan.hale@example.com',
  location: 'Austin, TX',
  yearsOfExperience: 6,
  workAuthorization: 'us_citizen',
  sponsorshipRequired: false,
  preferredWorkArrangement: 'hybrid',
  targetSalaryMin: 120000,
  targetSalaryMax: 150000,
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('auto apply frontend prepare request', () => {
  it('times out a hung prepare fetch and does not stay pending', async () => {
    const fetchImpl = vi.fn(() => new Promise<Response>(() => undefined))
    await expect(
      prepareAutoApplyItemRequest('run-1', 'item-1', profile, 'user-1', { timeoutMs: 30, fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow(PREPARE_ERROR_MESSAGES.PREPARE_TIMEOUT)
  })

  it('uses a client deadline so Preparing cannot last forever', async () => {
    await expect(withClientTimeout(new Promise(() => undefined), 20, PREPARE_ERROR_MESSAGES.PREPARE_TIMEOUT)).rejects.toThrow(
      /timed out/i,
    )
    expect(PREPARE_REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(50_000)
  })

  it('aborts fetchWithTimeout when the server never responds', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => undefined)),
    )
    await expect(fetchWithTimeout('/api/jobs/auto-apply/run/items/item/apply', { method: 'POST' }, 20)).rejects.toThrow(
      PREPARE_ERROR_MESSAGES.PREPARE_TIMEOUT,
    )
  })

  it('still applies a structured backend timeout payload to queue state', () => {
    const body = {
      success: false,
      code: 'BROWSER_NAVIGATION_TIMEOUT',
      message: 'The employer application page did not load within the allowed time.',
      run: { id: 'run-1' },
      items: [{ id: 'item-1', applicationStatus: 'failed' }],
      item: { id: 'item-1', applicationStatus: 'failed' },
    }
    expect(prepareErrorMessage(body)).toBe(PREPARE_ERROR_MESSAGES.BROWSER_NAVIGATION_TIMEOUT)
    expect(normalizeAutoApplyResult(body)?.items[0].applicationStatus).toBe('failed')
  })
})
