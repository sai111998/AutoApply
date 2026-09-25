import { getCandidateProfile, saveCandidateProfile } from './candidate-store'
import { ProfileAccessError, supabaseDataClient, type SupabaseAccess } from './supabase-access'

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
  sponsorship: boolean
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
  const storedFullName = pickText(source, ['fullName', 'full_name', 'name'])
  const split = splitCandidateName(storedFullName)
  const firstName = pickText(source, ['firstName', 'first_name']) || split.firstName
  const lastName = pickText(source, ['lastName', 'last_name']) || split.lastName
  const sponsorshipRaw = source.sponsorship ?? source.sponsorshipRequired ?? source.sponsorship_required
  return {
    firstName,
    lastName,
    fullName: storedFullName || [firstName, lastName].filter(Boolean).join(' '),
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
    sponsorship: sponsorshipRaw === true,
  }
}

export interface SupabaseProfileRow {
  id?: string
  full_name?: string | null
  first_name?: string | null
  last_name?: string | null
  email?: string | null
  phone?: string | null
  location?: string | null
  work_authorization?: string | null
  sponsorship_required?: boolean | null
}

function isUuidValue(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

export async function fetchSupabaseProfileRow(userId: string, access: SupabaseAccess): Promise<SupabaseProfileRow> {
  const id = userId.trim()
  if (!isUuidValue(id)) {
    throw new ProfileAccessError('PROFILE_AUTH_REQUIRED', 'The signed-in user id is not a Supabase user id.', 401)
  }
  const supabase = supabaseDataClient(access)
  let result: { data: unknown; error: { code?: string } | null }
  try {
    // '*' keeps the read working on databases that predate the application profile columns (migration 011).
    result = await supabase.from('profiles').select('*').eq('id', id).maybeSingle()
  } catch {
    throw new ProfileAccessError('PROFILE_DATABASE_ERROR', 'The profile query could not reach Supabase.', 503)
  }
  if (result.error) {
    throw new ProfileAccessError('PROFILE_DATABASE_ERROR', `The profile query failed (${result.error.code || 'unknown error'}).`, 503)
  }
  if (!result.data) {
    throw new ProfileAccessError(
      'PROFILE_NOT_FOUND',
      'No public.profiles row exists for the signed-in user. Save the Profile page to create it.',
      404,
    )
  }
  return result.data as SupabaseProfileRow
}

export async function getCandidateApplicationProfile(
  userId: string,
  access: SupabaseAccess,
): Promise<CanonicalCandidateProfile> {
  const row = await fetchSupabaseProfileRow(userId, access)
  return { userId: userId.trim(), ...normalizeStoredCandidate(row as unknown as Record<string, unknown>) }
}

function hasCandidateLastName(fullName: string): boolean {
  return splitCandidateName(fullName).lastName !== ''
}

export async function hydrateCandidateStoreFromSupabase(userId: string, access: SupabaseAccess): Promise<boolean> {
  const id = userId.trim()
  if (!id) return false
  let row: SupabaseProfileRow
  try {
    row = await fetchSupabaseProfileRow(id, access)
  } catch {
    return false
  }
  const canonical = normalizeStoredCandidate(row as unknown as Record<string, unknown>)
  const existing = getCandidateProfile(id)
  const profile = existing?.profile
  const rowName = [canonical.firstName, canonical.lastName].filter(Boolean).join(' ')
  const storedName = profile?.fullName?.trim() ?? ''
  const fullName =
    rowName && (hasCandidateLastName(rowName) || !hasCandidateLastName(storedName)) ? rowName : storedName
  if (!fullName && !existing) return false
  saveCandidateProfile({
    userId: id,
    profile: {
      fullName,
      email: canonical.email || profile?.email || '',
      phone: canonical.phone || profile?.phone || null,
      location: row.location?.trim() || profile?.location || '',
      yearsOfExperience: profile?.yearsOfExperience ?? null,
      workAuthorization: canonical.workAuthorization || profile?.workAuthorization || null,
      sponsorshipRequired:
        row.sponsorship_required === true || row.sponsorship_required === false
          ? row.sponsorship_required
          : (profile?.sponsorshipRequired ?? false),
      preferredWorkArrangement: profile?.preferredWorkArrangement ?? null,
      targetSalaryMin: profile?.targetSalaryMin ?? null,
      targetSalaryMax: profile?.targetSalaryMax ?? null,
      linkedin: profile?.linkedin ?? null,
      github: profile?.github ?? null,
    },
    resumeText: existing?.resumeText ?? null,
    resumeVersionId: existing?.resumeVersionId ?? null,
  })
  return true
}

const REQUIRED_APPLICATION_PROFILE_FIELDS = ['firstName', 'lastName', 'email', 'phone'] as const

export function isApplicationProfileComplete(profile: CanonicalCandidateProfile | null): {
  complete: boolean
  missingFields: string[]
} {
  const missingFields = REQUIRED_APPLICATION_PROFILE_FIELDS.filter(
    (field) => !profile?.[field]?.trim(),
  )
  return { complete: missingFields.length === 0, missingFields: [...missingFields] }
}

const AVAILABILITY_FIELDS = [
  'firstName',
  'lastName',
  'email',
  'phone',
  'address',
  'city',
  'state',
  'zip',
  'country',
  'linkedin',
  'github',
] as const

export function getApplicationProfileAvailability(
  profile: CanonicalCandidateProfile | null,
): Record<(typeof AVAILABILITY_FIELDS)[number], boolean> {
  const availability = {} as Record<(typeof AVAILABILITY_FIELDS)[number], boolean>
  for (const field of AVAILABILITY_FIELDS) {
    availability[field] = Boolean(profile?.[field]?.trim())
  }
  return availability
}
