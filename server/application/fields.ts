export { FIELD_SELECTORS } from '../browser-worker/providers'
import type { AutoApplyProfile } from '../apply/types'

export function profileFieldValues(profile: AutoApplyProfile): Record<string, string> {
  const [firstName, ...rest] = profile.fullName.trim().split(/\s+/)
  const lastName = rest.join(' ')
  const values: Record<string, string> = {
    fullName: profile.fullName,
    firstName: firstName || '',
    lastName,
    email: profile.email,
    city: profile.location,
  }
  if (profile.yearsOfExperience != null) values.yearsExperience = String(profile.yearsOfExperience)
  if (profile.workAuthorization === 'us_citizen' || profile.workAuthorization === 'us_permanent_resident' || profile.workAuthorization === 'work_visa') {
    values.workAuthorization = 'Yes'
  } else if (profile.workAuthorization === 'needs_sponsorship') {
    values.workAuthorization = 'No'
  }
  values.sponsorship = profile.sponsorshipRequired ? 'Yes' : 'No'
  if (profile.targetSalaryMin != null || profile.targetSalaryMax != null) {
    values.salary = [profile.targetSalaryMin, profile.targetSalaryMax].filter((value) => value != null).join('-')
  }
  return values
}
