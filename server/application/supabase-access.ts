import type { SupabaseClient } from '@supabase/supabase-js'
import type { ServerConfig } from '../config'
import { createServerSupabaseClient, type ServerSupabaseClientOptions } from '../supabase-client'

export type ProfileAccessErrorCode =
  | 'AUTH_NOT_AVAILABLE'
  | 'SUPABASE_NOT_CONFIGURED'
  | 'SUPABASE_PROJECT_MISMATCH'
  | 'SUPABASE_UNREACHABLE'
  | 'PROFILE_NOT_FOUND'
  | 'PROFILE_DATABASE_ERROR'

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

const SUPABASE_REQUEST_TIMEOUT_MS = 10_000

const REJECTED_SESSION_CODES = new Set(['bad_jwt', 'no_authorization', 'session_expired', 'session_not_found', 'user_not_found'])

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

function firstLine(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).split('\n')[0]
}

function supabaseUrlProblem(url: string | null | undefined): string | null {
  const value = url?.trim() ?? ''
  if (!value) return 'SUPABASE_URL is not set.'
  if (!/^https?:\/\//i.test(value) || !hostOf(value)) {
    return 'SUPABASE_URL must be the http(s) project URL, for example https://<project-ref>.supabase.co.'
  }
  return null
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

export function isSupabaseAuthConfigured(config: ServerConfig): boolean {
  return !supabaseUrlProblem(config.supabaseUrl) && (serviceRoleKeyState(config) === 'present' || Boolean(config.supabaseAnonKey))
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

function serverClient(config: ServerConfig, key: string, options?: ServerSupabaseClientOptions): SupabaseClient {
  try {
    return createServerSupabaseClient(config.supabaseUrl, key, options)
  } catch (error) {
    throw new ProfileAccessError('SUPABASE_NOT_CONFIGURED', `The server could not create its Supabase client: ${firstLine(error)}`, 503)
  }
}

function requireSupabaseUrl(config: ServerConfig) {
  const problem = supabaseUrlProblem(config.supabaseUrl)
  if (problem) throw new ProfileAccessError('SUPABASE_NOT_CONFIGURED', `The server is not connected to Supabase: ${problem}`, 503)
}

export function supabaseDataClient(access: SupabaseAccess): SupabaseClient {
  const { config, accessToken } = access
  requireSupabaseUrl(config)
  const keyState = serviceRoleKeyState(config)
  if (keyState === 'present') return serverClient(config, config.supabaseServiceRoleKey)
  if (accessToken && config.supabaseAnonKey) {
    return serverClient(config, config.supabaseAnonKey, { headers: { Authorization: `Bearer ${accessToken}` } })
  }
  const reason: Record<Exclude<ServiceRoleKeyState, 'present'>, string> = {
    missing: 'SUPABASE_SERVICE_ROLE_KEY is not set and no signed-in session was provided.',
    not_service_role: 'SUPABASE_SERVICE_ROLE_KEY is not a service-role key.',
    project_mismatch: 'SUPABASE_SERVICE_ROLE_KEY belongs to a different Supabase project than SUPABASE_URL.',
  }
  throw new ProfileAccessError('SUPABASE_NOT_CONFIGURED', `The server cannot read profiles: ${reason[keyState]}`, 503)
}

export function supabaseQueryFailure(
  subject: string,
  error: { code?: string; message?: string },
  status: number,
): ProfileAccessError {
  if (status === 0 || status >= 502) {
    const cause = status ? `HTTP ${status}` : firstLine(error.message ?? 'network error')
    return new ProfileAccessError('SUPABASE_UNREACHABLE', `The ${subject} could not reach Supabase (${cause}).`, 503)
  }
  if (/api key/i.test(error.message ?? '')) {
    return new ProfileAccessError('SUPABASE_NOT_CONFIGURED', `Supabase rejected the server's API key for the ${subject}.`, 503)
  }
  return new ProfileAccessError('PROFILE_DATABASE_ERROR', `The ${subject} failed (${error.code || `HTTP ${status}`}).`, 503)
}

function networkFailureCode(error: unknown): string {
  const cause = (error as { cause?: { code?: unknown } } | null)?.cause
  const code = typeof cause?.code === 'string' ? cause.code : (error as { code?: unknown } | null)?.code
  if (typeof code === 'string' && code) return code
  return error instanceof Error ? error.name : 'network error'
}

function observedFetch(observed: { failure: string | null }): typeof fetch {
  return async (input, init) => {
    try {
      return await fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(SUPABASE_REQUEST_TIMEOUT_MS) })
    } catch (error) {
      observed.failure = networkFailureCode(error)
      throw error
    }
  }
}

function verificationFailure(
  error: { name?: string; status?: number; code?: string; message?: string },
  networkFailure: string | null,
): ProfileAccessError {
  const status = error.status ?? 0
  if (error.name === 'AuthSessionMissingError' || (error.code && REJECTED_SESSION_CODES.has(error.code))) {
    return new ProfileAccessError('AUTH_NOT_AVAILABLE', 'Your Supabase session is invalid or expired. Sign in again.', 401)
  }
  if (/api key/i.test(error.message ?? '')) {
    return new ProfileAccessError(
      'SUPABASE_NOT_CONFIGURED',
      "Supabase rejected the server's API key. Use keys from the same project as SUPABASE_URL.",
      503,
    )
  }
  if (status === 0) {
    return new ProfileAccessError(
      'SUPABASE_UNREACHABLE',
      `Supabase could not be reached to verify the sign-in (${networkFailure ?? firstLine(error.message ?? 'network error')}).`,
      503,
    )
  }
  if (status >= 500) {
    return new ProfileAccessError('SUPABASE_UNREACHABLE', `Supabase returned HTTP ${status} while verifying the sign-in.`, 503)
  }
  if (status === 404) {
    return new ProfileAccessError(
      'SUPABASE_NOT_CONFIGURED',
      'SUPABASE_URL does not point to a Supabase project: its auth endpoint returned HTTP 404.',
      503,
    )
  }
  return new ProfileAccessError('AUTH_NOT_AVAILABLE', 'Your Supabase session is invalid or expired. Sign in again.', 401)
}

async function verifySupabaseSession(token: string | null, config: ServerConfig): Promise<AuthenticatedUser> {
  if (!token) {
    throw new ProfileAccessError('AUTH_NOT_AVAILABLE', 'Sign in again: the request did not include a Supabase session.', 401)
  }
  requireSupabaseUrl(config)
  const issuerRef = hostedProjectRef(String(decodeJwtPayload(token)?.iss ?? ''))
  const serverRef = hostedProjectRef(config.supabaseUrl)
  if (issuerRef && serverRef && issuerRef !== serverRef) {
    throw new ProfileAccessError(
      'SUPABASE_PROJECT_MISMATCH',
      "Your sign-in session comes from a different Supabase project than the server's SUPABASE_URL.",
      401,
    )
  }
  const key = serviceRoleKeyState(config) === 'present' ? config.supabaseServiceRoleKey : config.supabaseAnonKey
  if (!key) {
    throw new ProfileAccessError(
      'SUPABASE_NOT_CONFIGURED',
      'The server cannot verify sign-ins: set SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY.',
      503,
    )
  }
  const observed = { failure: null as string | null }
  const client = serverClient(config, key, { fetch: observedFetch(observed) })
  let result: Awaited<ReturnType<SupabaseClient['auth']['getUser']>>
  try {
    result = await client.auth.getUser(token)
  } catch (error) {
    throw new ProfileAccessError(
      'SUPABASE_UNREACHABLE',
      `Supabase returned an unexpected response while verifying the sign-in (${firstLine(error)}).`,
      503,
    )
  }
  if (result.error) throw verificationFailure(result.error, observed.failure)
  const userId = result.data.user?.id
  if (!userId) {
    throw new ProfileAccessError('AUTH_NOT_AVAILABLE', 'Your Supabase session is invalid or expired. Sign in again.', 401)
  }
  return { id: userId, accessToken: token }
}

export async function authenticateSupabaseUser(
  authorizationHeader: string | null | undefined,
  config: ServerConfig,
): Promise<AuthenticatedUser> {
  const header = authorizationHeader ? 'yes' : 'no'
  try {
    const user = await verifySupabaseSession(bearerToken(authorizationHeader), config)
    console.info(`[Auth] authorization header present=${header} user resolved=yes`)
    return user
  } catch (error) {
    const failure = isProfileAccessError(error) ? `${error.code}: ${error.message}` : firstLine(error)
    console.info(`[Auth] authorization header present=${header} user resolved=no failure=${failure}`)
    throw error
  }
}
