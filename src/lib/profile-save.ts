import type { SupabaseClient } from '@supabase/supabase-js'
import { profileToRow } from '@/lib/mappers'
import { isMissingColumnError } from '@/lib/persist-errors'
import type { Profile } from '@/types/domain'

export const PHONE_COLUMN_MISSING_MESSAGE =
  'Profile saved, but Phone was not stored: the Supabase profiles table has no phone column yet. Run supabase/migrations/012_profiles_phone.sql in the Supabase SQL Editor, then save again.'

export async function persistProfileRow(client: SupabaseClient, profile: Profile) {
  const { phone, ...withoutPhone } = profileToRow(profile)
  const result = await client.from('profiles').upsert({ ...withoutPhone, phone })
  if (!result.error || !isMissingColumnError(result.error)) {
    return { error: result.error, phoneStored: !result.error }
  }
  console.info('[profile] persist-fallback-without-phone')
  const fallback = await client.from('profiles').upsert(withoutPhone)
  return { error: fallback.error, phoneStored: false }
}
