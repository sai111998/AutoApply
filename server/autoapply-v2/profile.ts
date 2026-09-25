import {
  getCandidateApplicationProfile,
  isApplicationProfileComplete,
  type CanonicalCandidateProfile,
} from '../application/candidate-profile'
import { getServerConfig } from '../config'
import { V2Error } from './errors'
import { logV2 } from './log'

export interface V2ProfileLoad {
  profile: CanonicalCandidateProfile | null
  profileReady: boolean
  missing: string[]
}

export async function loadV2Profile(userId: string): Promise<V2ProfileLoad> {
  const profile = await getCandidateApplicationProfile(userId, getServerConfig())
  const { complete, missingFields } = isApplicationProfileComplete(profile)
  logV2('PROFILE_LOADED', {
    source: profile ? 'profiles' : 'unavailable',
    firstName: Boolean(profile?.firstName),
    lastName: Boolean(profile?.lastName),
    email: Boolean(profile?.email),
    phone: Boolean(profile?.phone),
    complete,
  })
  return { profile, profileReady: complete, missing: missingFields }
}

export async function requireV2Profile(userId: string): Promise<CanonicalCandidateProfile> {
  const { profile, profileReady, missing } = await loadV2Profile(userId)
  if (!profile || !profileReady) {
    throw new V2Error(
      'PROFILE_INCOMPLETE',
      profile
        ? `Profile incomplete. Add ${missing.join(', ')} on the Profile page.`
        : 'No application profile was found for this account on the server.',
      422,
      missing,
    )
  }
  return profile
}
