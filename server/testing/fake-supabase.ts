import { vi } from 'vitest'

export const FAKE_SUPABASE_URL = 'https://fake-project.supabase.co'
export const FAKE_ANON_KEY = 'fake-anon-key'
export const FAKE_SERVICE_ROLE_KEY = 'fake-service-role'

export interface FakeSupabaseData {
  profiles?: Array<Record<string, unknown>>
  resumes?: Array<Record<string, unknown>>
  files?: Record<string, { body: Buffer | string; contentType?: string }>
  users?: Array<{ id: string; email?: string }>
  failures?: { profiles?: number }
}

export interface FakeSupabaseOptions {
  serviceRoleKey?: string | null
  anonKey?: string | null
}

export interface FakeSupabaseWrite {
  table: string
  method: string
  body: unknown
}

export interface FakeSupabaseRead {
  path: string
  authorization: string | null
  apikey: string | null
}

const RESERVED_PARAMS = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'])

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

export function fakeSessionToken(userId: string, options: { projectRef?: string; expired?: boolean } = {}): string {
  const now = Math.floor(Date.now() / 1000)
  const payload = {
    iss: `https://${options.projectRef ?? 'fake-project'}.supabase.co/auth/v1`,
    sub: userId,
    role: 'authenticated',
    aud: 'authenticated',
    exp: options.expired ? now - 60 : now + 3600,
  }
  return `${base64url({ alg: 'HS256', typ: 'JWT' })}.${base64url(payload)}.fake-signature`
}

function tokenPayload(token: string): Record<string, unknown> | null {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

function matchesFilters(row: Record<string, unknown>, params: URLSearchParams): boolean {
  for (const [key, value] of params) {
    if (RESERVED_PARAMS.has(key)) continue
    if (value.startsWith('eq.') && String(row[key]) !== value.slice(3)) return false
  }
  return true
}

function applyOrder(rows: Array<Record<string, unknown>>, order: string | null) {
  if (!order) return rows
  const rules = order.split(',').map((rule) => {
    const [column, direction] = rule.split('.')
    return { column, descending: direction === 'desc' }
  })
  return [...rows].sort((left, right) => {
    for (const rule of rules) {
      const a = left[rule.column]
      const b = right[rule.column]
      if (a === b) continue
      const comparison = String(a ?? '') < String(b ?? '') ? -1 : 1
      return rule.descending ? -comparison : comparison
    }
    return 0
  })
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

export function installFakeSupabase(data: FakeSupabaseData, options: FakeSupabaseOptions = {}) {
  const writes: FakeSupabaseWrite[] = []
  const reads: FakeSupabaseRead[] = []
  vi.stubEnv('SUPABASE_URL', FAKE_SUPABASE_URL)
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', options.serviceRoleKey === undefined ? FAKE_SERVICE_ROLE_KEY : (options.serviceRoleKey ?? ''))
  vi.stubEnv('SUPABASE_ANON_KEY', options.anonKey === undefined ? FAKE_ANON_KEY : (options.anonKey ?? ''))
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
      if (url.origin !== FAKE_SUPABASE_URL) return new Response('not found', { status: 404 })
      if (url.pathname === '/auth/v1/user') {
        const token = headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? ''
        const payload = tokenPayload(token)
        const user = data.users?.find((entry) => entry.id === payload?.sub)
        const expired = typeof payload?.exp === 'number' && payload.exp < Date.now() / 1000
        if (!user || expired) return json({ code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' }, 401)
        return json({ id: user.id, email: user.email ?? null, aud: 'authenticated', role: 'authenticated' })
      }
      if (url.pathname.startsWith('/storage/v1/object/')) {
        const key = decodeURIComponent(url.pathname.slice('/storage/v1/object/'.length))
        const file = data.files?.[key]
        if (!file) return json({ statusCode: '404', error: 'not_found', message: 'Object not found' }, 404)
        return new Response(typeof file.body === 'string' ? file.body : new Uint8Array(file.body), {
          status: 200,
          headers: { 'content-type': file.contentType ?? 'application/octet-stream' },
        })
      }
      if (url.pathname.startsWith('/rest/v1/')) {
        const table = url.pathname.slice('/rest/v1/'.length)
        if (method !== 'GET' && method !== 'HEAD') {
          const raw = init?.body ?? (input instanceof Request ? await input.text() : null)
          writes.push({ table, method, body: typeof raw === 'string' && raw ? JSON.parse(raw) : raw })
          return new Response(null, { status: 201 })
        }
        reads.push({ path: url.pathname, authorization: headers.get('authorization'), apikey: headers.get('apikey') })
        const failure = data.failures?.[table as keyof NonNullable<FakeSupabaseData['failures']>]
        if (failure) return json({ code: 'XX000', message: 'simulated database failure' }, failure)
        const rows = ((data as Record<string, unknown>)[table] as Array<Record<string, unknown>> | undefined) ?? []
        const ordered = applyOrder(rows.filter((row) => matchesFilters(row, url.searchParams)), url.searchParams.get('order'))
        const limit = Number(url.searchParams.get('limit') ?? ordered.length)
        return json(ordered.slice(0, limit))
      }
      return new Response('not found', { status: 404 })
    }),
  )
  return { writes, reads }
}

export function uninstallFakeSupabase() {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
}
