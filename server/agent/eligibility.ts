export {
  applicationIdentity,
  hasDuplicateApplication,
  hasDuplicateQueueEntry,
  isEligibleForAutoApply,
  isExcludedCompany,
  jobApplicationUrl,
  meetsMatchThreshold,
} from '../apply/eligibility'
import { isEligibleForAutoApply } from '../apply/eligibility'
import type { ListedAutoApplyJob } from '../apply/types'
import { c2cOnly } from './policy'
import { buildCandidateApplicationProfile, type CandidateApplicationProfile } from '../application/profile'
import type { AutoApplyProfile } from '../apply/types'

export function campaignJobEligible(
  job: ListedAutoApplyJob,
  options: {
    minimumMatchRate: number
    finalMatchScore: number | null
    jobType?: import('../jobs/c2c').JobTypeFilter
    existingApplications?: import('../apply/types').ExistingApplicationRecord[]
    existingQueueIdentities?: string[]
    excludedCompanies?: string[]
  },
) {
  if (c2cOnly({ jobType: options.jobType ?? 'all' }) && job.c2cStatus !== 'confirmed') {
    return { ok: false, reason: 'C2C-only mode requires a confirmed C2C job.' }
  }
  return isEligibleForAutoApply(job, options)
}

export function evaluateSyntheticJobEligibility(input: {
  job: Pick<ListedAutoApplyJob, 'title' | 'company' | 'matchScore' | 'c2cStatus'>
  minimumMatchRate: number
  c2cOnly?: boolean
  jobType?: import('../jobs/c2c').JobTypeFilter
}) {
  if (input.c2cOnly || input.jobType === 'c2c') {
    if (input.job.c2cStatus !== 'confirmed') {
      return { ok: false as const, reason: 'C2C-only mode requires a confirmed C2C job.', stage: 'c2c' }
    }
  }
  const score = input.job.matchScore ?? 0
  if (score < input.minimumMatchRate) {
    return { ok: false as const, reason: 'Match score is below the campaign threshold.', stage: 'match' }
  }
  return { ok: true as const, reason: null, stage: 'eligible' }
}

export interface MappedSyntheticField {
  id: string
  prompt: string
  profilePath: string
  value: string
}

export function mapSyntheticApplicationFields(profile: CandidateApplicationProfile): {
  mapped: MappedSyntheticField[]
  missing: string[]
  unknown: string[]
} {
  const fields: Array<{ id: string; prompt: string; profilePath: string; value: string; required: boolean }> = [
    { id: 'first_name', prompt: 'First Name', profilePath: 'profile.firstName', value: profile.identity.firstName, required: true },
    { id: 'last_name', prompt: 'Last Name', profilePath: 'profile.lastName', value: profile.identity.lastName, required: true },
    { id: 'email', prompt: 'Email', profilePath: 'profile.email', value: profile.contact.email, required: true },
    { id: 'phone', prompt: 'Phone', profilePath: 'profile.phone', value: profile.contact.phone, required: true },
    { id: 'linkedin', prompt: 'LinkedIn', profilePath: 'profile.linkedin', value: profile.professional.linkedin, required: false },
    {
      id: 'work_authorization',
      prompt: 'Work Authorization',
      profilePath: 'profile.workAuthorization',
      value: profile.employment.workAuthorization === 'us_citizen' ? 'Yes' : profile.employment.workAuthorization || '',
      required: true,
    },
  ]
  const mapped = fields.filter((field) => field.value.trim()).map(({ required: _required, ...field }) => field)
  const missing = fields.filter((field) => field.required && !field.value.trim()).map((field) => field.id)
  return { mapped, missing, unknown: [] }
}

export function mapUnknownRequiredQuestion(prompt: string): { id: string; prompt: string; answer: null; source: 'user' } {
  return { id: prompt.toLowerCase().replace(/[^a-z0-9]+/g, '_'), prompt, answer: null, source: 'user' }
}

export function candidateFromStoredProfile(input: {
  userId: string
  profile: AutoApplyProfile
  resumeText?: string | null
  resumeVersionId?: string | null
}) {
  return buildCandidateApplicationProfile(input)
}
