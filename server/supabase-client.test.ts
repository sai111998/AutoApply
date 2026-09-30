import { createClient } from '@supabase/supabase-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServerSupabaseClient, hasBuiltInWebSocket } from './supabase-client'

const PROJECT_URL = 'https://abcdefghijklmnopqrst.supabase.co'
const KEY = 'placeholder-key'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createServerSupabaseClient', () => {
  it('creates clients on Node.js versions without a built-in WebSocket, where createClient throws', () => {
    vi.stubGlobal('WebSocket', undefined)
    expect(hasBuiltInWebSocket()).toBe(false)
    expect(() => createClient(PROJECT_URL, KEY)).toThrow(/native WebSocket not found/)
    const client = createServerSupabaseClient(PROJECT_URL, KEY)
    expect(typeof client.auth.getUser).toBe('function')
    expect(typeof client.from).toBe('function')
  })

  it('uses the built-in WebSocket when the runtime has one', () => {
    vi.stubGlobal('WebSocket', class {})
    expect(hasBuiltInWebSocket()).toBe(true)
    expect(() => createServerSupabaseClient(PROJECT_URL, KEY)).not.toThrow()
  })

  it('still rejects a URL that is not http(s)', () => {
    expect(() => createServerSupabaseClient('postgresql://db.abcdefghijklmnopqrst.supabase.co:5432/postgres', KEY)).toThrow(
      /Invalid supabaseUrl/,
    )
  })
})
