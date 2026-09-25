import type { ServerConfig } from '../config'
import { getCandidateApplicationProfile, isApplicationProfileComplete } from './candidate-profile'
import {
  authenticateSupabaseUser,
  bearerToken,
  isProfileAccessError,
  isSupabaseAuthConfigured,
  type ProfileAccessErrorCode,
} from './supabase-access'

export interface AuthHealth {
  supabaseConfigured: boolean
  sessionAvailable: boolean
  userAvailable: boolean
  profileAvailable: boolean
  failure: ProfileAccessErrorCode | 'PROFILE_INCOMPLETE' | null
  detail: string | null
}

export async function checkAuthHealth(authorizationHeader: string | null | undefined, config: ServerConfig): Promise<AuthHealth> {
  const health: AuthHealth = {
    supabaseConfigured: isSupabaseAuthConfigured(config),
    sessionAvailable: Boolean(bearerToken(authorizationHeader)),
    userAvailable: false,
    profileAvailable: false,
    failure: null,
    detail: null,
  }
  try {
    const user = await authenticateSupabaseUser(authorizationHeader, config)
    health.userAvailable = true
    const profile = await getCandidateApplicationProfile(user.id, { config, accessToken: user.accessToken })
    health.profileAvailable = true
    const { complete, missingFields } = isApplicationProfileComplete(profile)
    if (!complete) {
      health.failure = 'PROFILE_INCOMPLETE'
      health.detail = `Missing on the Profile page: ${missingFields.join(', ')}.`
    }
  } catch (error) {
    if (!isProfileAccessError(error)) throw error
    health.failure = error.code
    health.detail = error.message
  }
  return health
}
