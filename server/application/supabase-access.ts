import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { ServerConfig } from '../config'

export type ProfileAccessErrorCode = 'PROFILE_AUTH_REQUIRED' | 'PROFILE_NOT_FOUND' | 'PROFILE_DATABASE_ERROR'

export class ProfileAccessError extends Error {
  code: ProfileAccessErrorCode
  status: number

  constructor(code: ProfileAccessErrorCode, message: string, status: number) {
    super(message)
    this.name = 'ProfileAccessError'
    this.code = code
    this.status = status
  }
}

export function isProfileAccessError(error: unknown): error is ProfileAccessError {
  return error instanceof ProfileAccessError
}

export interface SupabaseAccess {
  config: ServerConfig
  accessToken?: string | null
}

export interface AuthenticatedUser {
  id: string
  accessToken: string
}

export type ServiceRoleKeyState = 'present' | 'missing' | 'not_service_role' | 'project_mismatch'

export function bearerToken(header: string | null | undefined): string | null {
  return header?.match(/^Bearer\s+(\S+)\s*$/i)?.[1] ?? null
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const part = token.split('.')[1]
  if (!part) return null
  try {
    const payload: unknown = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
    return payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function hostOf(url: string | null | undefined): string {
  try {
    return new URL(url ?? '').host.toLowerCase()
  } catch {
    return ''
  }
}

function hostedProjectRef(url: string | null | undefined): string | null {
  const host = hostOf(url)
  return host.endsWith('.supabase.co') ? host.split('.')[0] : null
}

export function serviceRoleKeyState(config: ServerConfig): ServiceRoleKeyState {
  const key = config.supabaseServiceRoleKey?.trim()
  if (!key) return 'missing'
  if (key.startsWith('sb_publishable_')) return 'not_service_role'
  const payload = decodeJwtPayload(key)
  if (!payload) return 'present'
  if (payload.role !== 'service_role') return 'not_service_role'
  const keyRef = typeof payload.ref === 'string' ? payload.ref : null
  const urlRef = hostedProjectRef(config.supabaseUrl)
  return keyRef && urlRef && keyRef !== urlRef ? 'project_mismatch' : 'present'
}

export function describeSupabaseServer(config: ServerConfig) {
  const backendHost = hostOf(config.supabaseUrl)
  const frontendHost = hostOf(config.frontendSupabaseUrl)
  return {
    urlConfigured: Boolean(backendHost),
    serviceRole: serviceRoleKeyState(config),
    anonConfigured: Boolean(config.supabaseAnonKey),
    frontendProject: !backendHost || !frontendHost ? 'unknown' : backendHost === frontendHost ? 'matches' : 'differs',
  }
}

function serverClient(config: ServerConfig, key: string, accessToken?: string | null): SupabaseClient {
  return createClient(config.supabaseUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    ...(accessToken ? { global: { headers: { Authorization: `Bearer ${accessToken}` } } } : {}),
  })
}

function requireSupabaseUrl(config: ServerConfig) {
  if (!hostOf(config.supabaseUrl)) {
    throw new ProfileAccessError('PROFILE_DATABASE_ERROR', 'The server is not connected to Supabase: SUPABASE_URL is not set.', 503)
  }
}

export function supabaseDataClient(access: SupabaseAccess): SupabaseClient {
  const { config, accessToken } = access
  requireSupabaseUrl(config)
  const keyState = serviceRoleKeyState(config)
  if (keyState === 'present') return serverClient(config, config.supabaseServiceRoleKey)
  if (accessToken && config.supabaseAnonKey) return serverClient(config, config.supabaseAnonKey, accessToken)
  const reason: Record<Exclude<ServiceRoleKeyState, 'present'>, string> = {
    missing: 'SUPABASE_SERVICE_ROLE_KEY is not set and no signed-in session was provided.',
    not_service_role: 'SUPABASE_SERVICE_ROLE_KEY is not a service-role key.',
    project_mismatch: 'SUPABASE_SERVICE_ROLE_KEY belongs to a different Supabase project than SUPABASE_URL.',
  }
  throw new ProfileAccessError('PROFILE_DATABASE_ERROR', `The server cannot read profiles: ${reason[keyState]}`, 503)
}

export async function authenticateSupabaseUser(
  authorizationHeader: string | null | undefined,
  config: ServerConfig,
): Promise<AuthenticatedUser> {
  const token = bearerToken(authorizationHeader)
  if (!token) {
    throw new ProfileAccessError('PROFILE_AUTH_REQUIRED', 'Sign in again: the request did not include a Supabase session.', 401)
  }
  requireSupabaseUrl(config)
  const issuerRef = hostedProjectRef(String(decodeJwtPayload(token)?.iss ?? ''))
  const serverRef = hostedProjectRef(config.supabaseUrl)
  if (issuerRef && serverRef && issuerRef !== serverRef) {
    throw new ProfileAccessError(
      'PROFILE_AUTH_REQUIRED',
      'Your sign-in session comes from a different Supabase project than the one the server uses.',
      401,
    )
  }
  const key = serviceRoleKeyState(config) === 'present' ? config.supabaseServiceRoleKey : config.supabaseAnonKey
  if (!key) {
    throw new ProfileAccessError(
      'PROFILE_DATABASE_ERROR',
      'The server cannot verify sign-ins: set SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY.',
      503,
    )
  }
  let result: Awaited<ReturnType<SupabaseClient['auth']['getUser']>>
  try {
    result = await serverClient(config, key).auth.getUser(token)
  } catch {
    throw new ProfileAccessError('PROFILE_DATABASE_ERROR', 'Supabase could not be reached to verify the sign-in.', 503)
  }
  const userId = result.data.user?.id
  if (result.error || !userId) {
    if ((result.error?.status ?? 0) >= 500) {
      throw new ProfileAccessError('PROFILE_DATABASE_ERROR', 'Supabase could not verify the sign-in right now.', 503)
    }
    throw new ProfileAccessError('PROFILE_AUTH_REQUIRED', 'Your Supabase session is invalid or expired. Sign in again.', 401)
  }
  return { id: userId, accessToken: token }
}
