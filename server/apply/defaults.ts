import type { JobTypeFilter } from '../jobs/c2c'
import type { RemoteFilter } from '../jobs/types'

export const DEFAULT_MAX_JOBS = 5
export const DEFAULT_MINIMUM_MATCH_RATE = 70
export const DEFAULT_AUTO_TAILOR_RESUME = true
export const DEFAULT_JOB_TYPE: JobTypeFilter = 'all'
export const DEFAULT_REMOTE_PREFERENCE: RemoteFilter = 'any'
export const DEFAULT_C2C_ONLY = false

export function defaultC2cOnly(jobType: JobTypeFilter = DEFAULT_JOB_TYPE): boolean {
  return jobType === 'c2c'
}
