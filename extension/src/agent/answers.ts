import { parseLocation, splitFullName, type AgentProfileValues } from '../shared/queue'

export function authorizationAnswer(value: string | null | undefined): string | null {
  if (!value) return null
  if (value === 'us_citizen' || value === 'us_permanent_resident' || value === 'work_visa') return 'Yes'
  if (value === 'needs_sponsorship') return 'No'
  return null
}

export function profileFillValues(profile: {
  fullName: string
  email: string
  location: string
  yearsOfExperience: number | null
  workAuthorization: string | null
  sponsorshipRequired: boolean
  phone?: string | null
  address?: string | null
  linkedin?: string | null
  github?: string | null
}): AgentProfileValues {
  const { firstName, lastName } = splitFullName(profile.fullName)
  const { city, state } = parseLocation(profile.location)
  return {
    firstName,
    lastName,
    email: profile.email.trim(),
    phone: profile.phone?.trim() ?? '',
    address: profile.address?.trim() ?? '',
    city,
    state,
    zip: '',
    country: '',
    linkedin: profile.linkedin?.trim() ?? '',
    github: profile.github?.trim() ?? '',
    workAuthorization: authorizationAnswer(profile.workAuthorization) ?? '',
    sponsorship: profile.sponsorshipRequired ? 'Yes' : 'No',
    yearsExperience: profile.yearsOfExperience != null ? String(profile.yearsOfExperience) : '',
  }
}

export function nonEmptyValues(values: AgentProfileValues): Partial<AgentProfileValues> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => String(value).trim())) as Partial<AgentProfileValues>
}
