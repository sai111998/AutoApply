import { afterEach, describe, expect, it, vi } from 'vitest'

async function loadClientModule(env: { url: string; anonKey: string }) {
  vi.resetModules()
  vi.stubEnv('VITE_SUPABASE_URL', env.url)
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', env.anonKey)
  // Browsers always provide WebSocket; supabase-js requires one to construct a client.
  vi.stubGlobal('WebSocket', globalThis.WebSocket ?? class {})
  return import('./supabase')
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('frontend Supabase client', () => {
  it('initializes when the project URL and anon key are available at build time', async () => {
    const module = await loadClientModule({ url: 'https://abcdefghijklmnopqrst.supabase.co', anonKey: 'anon-key' })
    expect(module.isSupabaseConfigured).toBe(true)
    expect(module.supabase).not.toBeNull()
  })

  it('stays uninitialized without the project URL', async () => {
    const module = await loadClientModule({ url: '', anonKey: 'anon-key' })
    expect(module.isSupabaseConfigured).toBe(false)
    expect(module.supabase).toBeNull()
  })

  it('stays uninitialized without the anon key', async () => {
    const module = await loadClientModule({ url: 'https://abcdefghijklmnopqrst.supabase.co', anonKey: '  ' })
    expect(module.isSupabaseConfigured).toBe(false)
    expect(module.supabase).toBeNull()
  })
})
