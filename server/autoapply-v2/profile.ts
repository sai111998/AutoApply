import {
  getCandidateApplicationProfile,
  type CanonicalCandidateProfile,
} from '../application/candidate-profile'

const V2_REQUIRED_PROFILE_FIELDS = ['firstName', 'lastName', 'email', 'phone'] as const

const EMPTY_V2_PROFILE: CanonicalCandidateProfile = {
  userId: '',
  firstName: '',
  lastName: '',
  fullName: '',
  email: '',
  phone: '',
  address: '',
  city: '',
  state: '',
  zip: '',
  country: '',
  linkedin: '',
  github: '',
  workAuthorization: null,
  sponsorshipRequired: false,
}

export interface V2ProfileLoad {
  profile: CanonicalCandidateProfile
  profileReady: boolean
  missing: string[]
}

export async function loadV2Profile(userId: string): Promise<V2ProfileLoad> {
  const profile = getCandidateApplicationProfile(userId) ?? { ...EMPTY_V2_PROFILE }
  const missing = V2_REQUIRED_PROFILE_FIELDS.filter((field) => !profile[field]?.trim())
  const profileReady = missing.length === 0
  console.log(
    `[V2] PROFILE_LOADED ready=${profileReady} missing=${missing.join(',') || 'none'} userId=${userId}`,
  )
  return { profile, profileReady, missing: [...missing] }
}
