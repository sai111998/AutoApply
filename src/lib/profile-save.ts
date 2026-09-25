import type { SupabaseClient } from '@supabase/supabase-js'
import { profileToRow } from '@/lib/mappers'
import { isMissingColumnError } from '@/lib/persist-errors'
import type { Profile } from '@/types/domain'

export const APPLICATION_PROFILE_COLUMNS_MISSING_MESSAGE =
  'Profile saved, but First name, Last name, and Phone were not stored: the Supabase profiles table is missing those columns. Run supabase/migrations/011_application_profile.sql in the Supabase SQL Editor, then save again.'

export async function persistProfileRow(client: SupabaseClient, profile: Profile) {
  const { first_name, last_name, phone, ...coreRow } = profileToRow(profile)
  const result = await client.from('profiles').upsert({ ...coreRow, first_name, last_name, phone })
  if (!result.error || !isMissingColumnError(result.error)) {
    return { error: result.error, applicationFieldsStored: !result.error }
  }
  console.info('[profile] persist-fallback-without-application-fields')
  const fallback = await client.from('profiles').upsert(coreRow)
  return { error: fallback.error, applicationFieldsStored: false }
}

export function hasApplicationProfileValues(profile: Profile): boolean {
  return Boolean(profile.firstName?.trim() || profile.lastName?.trim() || profile.phone?.trim())
}
