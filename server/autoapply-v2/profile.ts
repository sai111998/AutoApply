import {
  getCandidateApplicationProfileAsync,
  isApplicationProfileComplete,
  type CanonicalCandidateProfile,
} from '../application/candidate-profile'
import { getServerConfig } from '../config'

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
  const profile =
    (await getCandidateApplicationProfileAsync(userId, getServerConfig())) ?? {
      ...EMPTY_V2_PROFILE,
      userId,
    }
  const { complete, missingFields } = isApplicationProfileComplete(profile)
  console.log('[AutoApplyV2] Profile loaded')
  console.log(`[AutoApplyV2] firstName available=${Boolean(profile.firstName.trim())}`)
  console.log(`[AutoApplyV2] lastName available=${Boolean(profile.lastName.trim())}`)
  console.log(`[AutoApplyV2] email available=${Boolean(profile.email.trim())}`)
  console.log(`[AutoApplyV2] phone available=${Boolean(profile.phone.trim())}`)
  console.log(
    `[V2] PROFILE_LOADED ready=${complete} missing=${missingFields.join(',') || 'none'} userId=${userId}`,
  )
  return { profile, profileReady: complete, missing: missingFields }
}
