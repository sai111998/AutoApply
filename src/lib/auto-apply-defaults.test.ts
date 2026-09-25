import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_AUTO_APPLY } from './auto-apply-defaults'
import {
  DEFAULT_AUTO_TAILOR_RESUME,
  DEFAULT_C2C_ONLY,
  DEFAULT_JOB_TYPE,
  DEFAULT_MAX_JOBS,
  DEFAULT_MINIMUM_MATCH_RATE,
  DEFAULT_REMOTE_PREFERENCE,
  defaultC2cOnly,
} from '../../server/apply/defaults'

describe('auto apply defaults', () => {
  it('keeps UI and backend defaults aligned', () => {
    expect(DEFAULT_AUTO_APPLY.maxJobs).toBe(DEFAULT_MAX_JOBS)
    expect(DEFAULT_AUTO_APPLY.minimumMatchRate).toBe(DEFAULT_MINIMUM_MATCH_RATE)
    expect(DEFAULT_AUTO_APPLY.autoTailorResume).toBe(DEFAULT_AUTO_TAILOR_RESUME)
    expect(DEFAULT_AUTO_APPLY.jobType).toBe(DEFAULT_JOB_TYPE)
    expect(DEFAULT_AUTO_APPLY.remotePreference).toBe(DEFAULT_REMOTE_PREFERENCE)
    expect(DEFAULT_AUTO_APPLY.c2cOnly).toBe(DEFAULT_C2C_ONLY)
    expect(defaultC2cOnly(DEFAULT_JOB_TYPE)).toBe(false)
  })

  it('does not force C2C when Auto Apply opens from an All search', () => {
    const page = readFileSync(path.resolve(process.cwd(), 'src/pages/JobDiscoveryPage.tsx'), 'utf8')
    expect(page).toMatch(/useState<AutoApplyJobType>\(DEFAULT_AUTO_APPLY\.jobType\)/)
    expect(page).toMatch(/useState\(DEFAULT_AUTO_APPLY\.maxJobs\)/)
    expect(page).toMatch(/useState\(DEFAULT_AUTO_APPLY\.minimumMatchRate\)/)
    expect(page).not.toMatch(/jobType === 'all' \? 'c2c'/)
  })
})
