import { createClient, type SupabaseClient, type SupabaseClientOptions } from '@supabase/supabase-js'

type RealtimeTransport = NonNullable<NonNullable<SupabaseClientOptions<'public'>['realtime']>['transport']>

export interface ServerSupabaseClientOptions {
  headers?: Record<string, string>
  fetch?: typeof fetch
}

export function hasBuiltInWebSocket(): boolean {
  return typeof globalThis.WebSocket !== 'undefined'
}

// supabase-js resolves a WebSocket class while constructing every client, even when Realtime is never used,
// and throws when there is none. Node.js versions before 22 have no built-in WebSocket.
class RealtimeUnavailable {
  constructor() {
    throw new Error(`Supabase Realtime needs a WebSocket, which Node.js ${process.version} does not provide.`)
  }
}

export function createServerSupabaseClient(
  url: string,
  key: string,
  options: ServerSupabaseClientOptions = {},
): SupabaseClient {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      ...(options.headers ? { headers: options.headers } : {}),
      ...(options.fetch ? { fetch: options.fetch } : {}),
    },
    ...(hasBuiltInWebSocket() ? {} : { realtime: { transport: RealtimeUnavailable as unknown as RealtimeTransport } }),
  })
}
