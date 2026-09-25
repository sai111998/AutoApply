import { getCandidateProfile } from './candidate-store'

export interface CanonicalCandidateProfile {
  userId: string
  firstName: string
  lastName: string
  fullName: string
  email: string
  phone: string
  address: string
  city: string
  state: string
  zip: string
  country: string
  linkedin: string
  github: string
  workAuthorization: string | null
  sponsorshipRequired: boolean
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function pickText(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const text = asText(record[key])
    if (text) return text
  }
  return ''
}

export function splitCandidateName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  return { firstName: parts[0] ?? '', lastName: parts.slice(1).join(' ') }
}

export function normalizeStoredCandidate(
  record: Record<string, unknown> | null | undefined,
): Omit<CanonicalCandidateProfile, 'userId'> {
  const source = record ?? {}
  const fullName = pickText(source, ['fullName', 'full_name', 'name'])
  const split = splitCandidateName(fullName)
  const sponsorshipRaw = source.sponsorshipRequired ?? source.sponsorship_required ?? source.sponsorship
  return {
    firstName: pickText(source, ['firstName', 'first_name']) || split.firstName,
    lastName: pickText(source, ['lastName', 'last_name']) || split.lastName,
    fullName,
    email: pickText(source, ['email']),
    phone: pickText(source, ['phone', 'phoneNumber', 'phone_number']),
    address: pickText(source, ['address', 'addressLine1', 'address_line1', 'street']),
    city: pickText(source, ['city']),
    state: pickText(source, ['state', 'province', 'region']),
    zip: pickText(source, ['zip', 'zipCode', 'zip_code', 'postalCode', 'postal_code']),
    country: pickText(source, ['country']),
    linkedin: pickText(source, ['linkedin', 'linkedIn', 'linked_in']),
    github: pickText(source, ['github', 'gitHub']),
    workAuthorization: pickText(source, ['workAuthorization', 'work_authorization']) || null,
    sponsorshipRequired: sponsorshipRaw === true,
  }
}

export function getCandidateApplicationProfile(userId: string): CanonicalCandidateProfile | null {
  const id = userId.trim()
  if (!id) return null
  const stored = getCandidateProfile(id)
  if (!stored || stored.userId !== id) return null
  return {
    userId: stored.userId,
    ...normalizeStoredCandidate(stored.profile as unknown as Record<string, unknown>),
  }
}
