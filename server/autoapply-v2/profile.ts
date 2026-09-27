import {
  getCandidateApplicationProfile,
  isApplicationProfileComplete,
  type CanonicalCandidateProfile,
} from '../application/candidate-profile'
import { isProfileAccessError, type SupabaseAccess } from '../application/supabase-access'
import { getServerConfig } from '../config'
import { V2Error } from './errors'

export interface V2ProfileLoad {
  profile: CanonicalCandidateProfile
  profileReady: boolean
  missing: string[]
}

export function v2Access(accessToken?: string | null): SupabaseAccess {
  return { config: getServerConfig(), accessToken: accessToken ?? null }
}

export async function loadV2Profile(userId: string, access: SupabaseAccess = v2Access()): Promise<V2ProfileLoad> {
  let profile: CanonicalCandidateProfile
  try {
    profile = await getCandidateApplicationProfile(userId, access)
  } catch (error) {
    if (!isProfileAccessError(error)) throw error
    throw new V2Error(error.code, error.message, error.code === 'PROFILE_NOT_FOUND' ? 422 : error.status)
  }
  const { complete, missingFields } = isApplicationProfileComplete(profile)
  return { profile, profileReady: complete, missing: missingFields }
}

export async function requireV2Profile(userId: string, access: SupabaseAccess = v2Access()): Promise<CanonicalCandidateProfile> {
  const { profile, profileReady, missing } = await loadV2Profile(userId, access)
  if (!profileReady) {
    throw new V2Error('PROFILE_INCOMPLETE', `Profile incomplete. Add ${missing.join(', ')} on the Profile page.`, 422, missing)
  }
  return profile
}
