import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import path from 'node:path'

function env(name: string): string {
  return process.env[name]?.trim() ?? ''
}

function loadDotEnv() {
  for (const file of ['.env.local', '.env']) {
    const full = path.resolve(process.cwd(), file)
    try {
      const text = readFileSync(full, 'utf8')
      for (const line of text.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const eq = trimmed.indexOf('=')
        if (eq === -1) continue
        const key = trimmed.slice(0, eq).trim()
        let value = trimmed.slice(eq + 1).trim()
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1)
        }
        if (process.env[key] === undefined) process.env[key] = value
      }
    } catch {
      // file may not exist
    }
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function main() {
  loadDotEnv()
  const url = env('VITE_SUPABASE_URL') || env('SUPABASE_URL')
  const anonKey = env('VITE_SUPABASE_ANON_KEY') || env('SUPABASE_ANON_KEY')
  const serviceRole = env('SUPABASE_SERVICE_ROLE_KEY')

  if (!url || !anonKey) {
    console.error('Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to test Sign up → Login → Profile.')
    process.exit(2)
  }

  const email = `jobpilot.schema.${Date.now()}@example.com`
  const password = 'JobPilot_Test_12345!'
  const fullName = 'Schema Test User'
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  let userId = ''

  try {
    if (serviceRole) {
      const admin = createClient(url, serviceRole, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
      const created = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      })
      if (created.error) throw created.error
      userId = created.data.user.id
      console.log('Sign up: admin-created confirmed user', userId)
    } else {
      const signedUp = await client.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName } },
      })
      if (signedUp.error) throw signedUp.error
      userId = signedUp.data.user?.id ?? ''
      assert(userId, 'Sign up did not return a user id')
      if (!signedUp.data.session) {
        throw new Error(
          'Sign up succeeded but no session was returned. Disable Confirm email in Authentication → Providers → Email, or set SUPABASE_SERVICE_ROLE_KEY.',
        )
      }
      console.log('Sign up: created user', userId)
    }

    const signedIn = await client.auth.signInWithPassword({ email, password })
    if (signedIn.error) throw signedIn.error
    assert(signedIn.data.session, 'Login did not return a session')
    console.log('Login: session established')

    await new Promise((resolve) => setTimeout(resolve, 400))

    let profileRead = await client.from('profiles').select('*').eq('id', userId).maybeSingle()
    if (profileRead.error) throw profileRead.error

    if (!profileRead.data) {
      const createProfile = await client.from('profiles').upsert({
        id: userId,
        email,
        full_name: fullName,
      })
      if (createProfile.error) throw createProfile.error
      profileRead = await client.from('profiles').select('*').eq('id', userId).maybeSingle()
      if (profileRead.error) throw profileRead.error
    }

    assert(profileRead.data, 'Create/read profile failed — no row for the signed-in user')
    console.log('Read profile:', {
      id: profileRead.data.id,
      full_name: profileRead.data.full_name,
      email: profileRead.data.email,
    })

    const updated = await client
      .from('profiles')
      .update({
        full_name: 'Updated Schema Test',
        location: 'Austin, TX',
        years_of_experience: 5,
        work_authorization: 'us_citizen',
        sponsorship_required: false,
        preferred_work_arrangement: 'hybrid',
        target_job_titles: ['Software Engineer'],
        target_salary_min: 140000,
        target_salary_max: 180000,
      })
      .eq('id', userId)
      .select('*')
      .single()
    if (updated.error) throw updated.error
    assert(updated.data.full_name === 'Updated Schema Test', 'Update profile did not persist full_name')
    assert(updated.data.location === 'Austin, TX', 'Update profile did not persist location')
    console.log('Update profile: persisted', {
      full_name: updated.data.full_name,
      location: updated.data.location,
      work_authorization: updated.data.work_authorization,
    })

    const reread = await client.from('profiles').select('*').eq('id', userId).single()
    if (reread.error) throw reread.error
    assert(reread.data.full_name === 'Updated Schema Test', 'Re-read after update returned stale full_name')
    console.log('Re-read profile after update: ok')

    const otherUser = await client.from('profiles').select('id')
    if (otherUser.error) throw otherUser.error
    assert(
      (otherUser.data ?? []).every((row) => row.id === userId),
      'RLS failed: query returned another user’s profile',
    )
    console.log('RLS: authenticated user only sees own profile')

    console.log('Auth + profile flow passed.')
  } finally {
    if (serviceRole && userId) {
      const admin = createClient(url, serviceRole, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
      await admin.auth.admin.deleteUser(userId)
      console.log('Cleaned up test user', userId)
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
