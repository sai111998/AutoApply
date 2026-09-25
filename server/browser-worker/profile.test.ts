import { describe, expect, it } from 'vitest'
import { allowUnattendedSubmit, shouldUnattendedSubmit } from './profile'

describe('unattended submit policy', () => {
  it('allows the local test employer without JOBPILOT_AUTO_SUBMIT', () => {
    expect(allowUnattendedSubmit('http://127.0.0.1:8787/test-employer/apply', {})).toBe(true)
    expect(shouldUnattendedSubmit('http://127.0.0.1:8787/test-employer/apply', false, {})).toBe(true)
  })

  it('does not submit a real employer when autoSubmit is omitted or false', () => {
    expect(allowUnattendedSubmit('https://boards.greenhouse.io/example/jobs/1', {})).toBe(false)
    expect(shouldUnattendedSubmit('https://boards.greenhouse.io/example/jobs/1', false, {})).toBe(false)
    expect(shouldUnattendedSubmit('https://boards.greenhouse.io/example/jobs/1', undefined, {})).toBe(false)
  })

  it('submits a real employer only when autoSubmit is explicitly true', () => {
    expect(shouldUnattendedSubmit('https://boards.greenhouse.io/example/jobs/1', true, {})).toBe(true)
  })
})
