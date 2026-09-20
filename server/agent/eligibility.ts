export {
  applicationIdentity,
  hasDuplicateApplication,
  hasDuplicateQueueEntry,
  isEligibleForAutoApply,
  jobApplicationUrl,
  meetsMatchThreshold,
} from '../apply/eligibility'
import { isEligibleForAutoApply } from '../apply/eligibility'
import type { ListedAutoApplyJob } from '../apply/types'
import { c2cOnly } from './policy'

export function campaignJobEligible(
  job: ListedAutoApplyJob,
  options: {
    minimumMatchRate: number
    finalMatchScore: number | null
    jobType?: import('../jobs/c2c').JobTypeFilter
    existingApplications?: import('../apply/types').ExistingApplicationRecord[]
    existingQueueIdentities?: string[]
  },
) {
  if (c2cOnly({ jobType: options.jobType ?? 'all' }) && job.c2cStatus !== 'confirmed') {
    return { ok: false, reason: 'C2C-only mode requires a confirmed C2C job.' }
  }
  return isEligibleForAutoApply(job, options)
}
