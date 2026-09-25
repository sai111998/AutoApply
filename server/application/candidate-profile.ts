import { createClient } from '@supabase/supabase-js'
import type { ServerConfig } from '../config'
import { getCandidateProfile, saveCandidateProfile } from './candidate-store'

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

export async function fetchSupabaseProfileRow(
  userId: string,
  config?: ServerConfig,
): Promise<SupabaseProfileRow | null> {
  const id = userId.trim()
  if (!id || !isUuidValue(id)) return null
  if (!config?.supabaseUrl || !config.supabaseServiceRoleKey) return null
  try {
    const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    // '*' keeps the read working on databases that predate the application profile columns (migration 011).
    const { data, error } = await supabase.from('profiles').select('*').eq('id', id).maybeSingle()
    if (error || !data) return null
    return data as SupabaseProfileRow
  } catch {
    return null
  }
}

export async function getCandidateApplicationProfile(
  userId: string,
  config?: ServerConfig,
): Promise<CanonicalCandidateProfile | null> {
  const id = userId.trim()
  const row = await fetchSupabaseProfileRow(id, config)
  if (!row) return null
  return { userId: id, ...normalizeStoredCandidate(row as unknown as Record<string, unknown>) }
}

function hasCandidateLastName(fullName: string): boolean {
  return splitCandidateName(fullName).lastName !== ''
}

export async function hydrateCandidateStoreFromSupabase(
  userId: string,
  config?: ServerConfig,
): Promise<boolean> {
  const id = userId.trim()
  if (!id) return false
  const row = await fetchSupabaseProfileRow(id, config)
  if (!row) return false
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
