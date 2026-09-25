import { vi } from 'vitest'

export const FAKE_SUPABASE_URL = 'https://fake-project.supabase.co'

export interface FakeSupabaseData {
  profiles?: Array<Record<string, unknown>>
  resumes?: Array<Record<string, unknown>>
  files?: Record<string, { body: Buffer | string; contentType?: string }>
}

export interface FakeSupabaseWrite {
  table: string
  method: string
  body: unknown
}

const RESERVED_PARAMS = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'])

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

export function installFakeSupabase(data: FakeSupabaseData) {
  const writes: FakeSupabaseWrite[] = []
  vi.stubEnv('SUPABASE_URL', FAKE_SUPABASE_URL)
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'fake-service-role')
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
      if (url.origin !== FAKE_SUPABASE_URL) return new Response('not found', { status: 404 })
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
        const rows = ((data as Record<string, unknown>)[table] as Array<Record<string, unknown>> | undefined) ?? []
        const ordered = applyOrder(rows.filter((row) => matchesFilters(row, url.searchParams)), url.searchParams.get('order'))
        const limit = Number(url.searchParams.get('limit') ?? ordered.length)
        return json(ordered.slice(0, limit))
      }
      return new Response('not found', { status: 404 })
    }),
  )
  return { writes }
}

export function uninstallFakeSupabase() {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
}
