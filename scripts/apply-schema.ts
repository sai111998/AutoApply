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

function projectRefFromUrl(url: string): string | null {
  try {
    const host = new URL(url).hostname
    const ref = host.split('.')[0]
    return ref || null
  } catch {
    return null
  }
}

function isCommentOnly(sql: string): boolean {
  return sql
    .split('\n')
    .every((line) => {
      const trimmed = line.trim()
      return !trimmed || trimmed.startsWith('--')
    })
}

/** Split SQL on semicolons that are not inside dollar-quoted bodies. */
function splitSqlStatements(sql: string): string[] {
  const statements: string[] = []
  let current = ''
  let dollarTag: string | null = null

  for (let i = 0; i < sql.length; i++) {
    if (sql[i] === '$') {
      const match = sql.slice(i).match(/^\$[A-Za-z0-9_]*\$/)
      if (match) {
        const tag = match[0]
        if (dollarTag === null) {
          dollarTag = tag
        } else if (tag === dollarTag) {
          dollarTag = null
        }
        current += tag
        i += tag.length - 1
        continue
      }
    }

    if (sql[i] === ';' && dollarTag === null) {
      const statement = current.trim()
      if (statement && !isCommentOnly(statement)) statements.push(statement)
      current = ''
      continue
    }

    current += sql[i]
  }

  const tail = current.trim()
  if (tail && !isCommentOnly(tail)) statements.push(tail)
  return statements
}

async function runQuery(accessToken: string, projectRef: string, query: string) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  })
  const body = await response.text()
  if (!response.ok) {
    throw new Error(`Management API ${response.status}: ${body}`)
  }
  return body
}

async function applySql(accessToken: string, projectRef: string, sql: string) {
  try {
    await runQuery(accessToken, projectRef, sql)
    console.log('Applied migration as a single batch.')
    return
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`Batch apply failed (${message.slice(0, 240)}). Applying statement by statement...`)
  }

  const statements = splitSqlStatements(sql)
  for (const [index, statement] of statements.entries()) {
    process.stdout.write(`  (${index + 1}/${statements.length}) `)
    await runQuery(accessToken, projectRef, statement)
    const preview = statement.replace(/\s+/g, ' ').slice(0, 72)
    console.log(`${preview}${statement.length > 72 ? '…' : ''}`)
  }
}

async function main() {
  loadDotEnv()
  const url = env('VITE_SUPABASE_URL') || env('SUPABASE_URL')
  const accessToken = env('SUPABASE_ACCESS_TOKEN')
  const anonKey = env('VITE_SUPABASE_ANON_KEY') || env('SUPABASE_ANON_KEY')
  const projectRef = env('SUPABASE_PROJECT_REF') || (url ? projectRefFromUrl(url) : '')

  if (!accessToken || !projectRef) {
    console.error(
      'Cannot apply SQL from this environment. Set SUPABASE_ACCESS_TOKEN and VITE_SUPABASE_URL (or SUPABASE_PROJECT_REF).',
    )
    console.error(
      'Until then, paste supabase/migrations/001_initial_schema.sql into the Supabase SQL Editor and run it.',
    )
    process.exit(2)
  }

  const sqlPath = path.resolve(process.cwd(), 'supabase/migrations/001_initial_schema.sql')
  const sql = readFileSync(sqlPath, 'utf8')
  console.log(`Applying ${sqlPath} to project ${projectRef}...`)
  await applySql(accessToken, projectRef, sql)
  console.log('Migration applied.')

  const verify = await runQuery(
    accessToken,
    projectRef,
    `
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_name in (
          'profiles', 'skills', 'resumes', 'jobs', 'job_matches', 'applications', 'user_preferences'
        )
      order by table_name;
    `,
  )
  console.log('Public tables:', verify)

  const buckets = await runQuery(
    accessToken,
    projectRef,
    `select id, public from storage.buckets where id = 'resumes';`,
  )
  console.log('Storage buckets:', buckets)

  const policies = await runQuery(
    accessToken,
    projectRef,
    `
      select schemaname, tablename, policyname
      from pg_policies
      where schemaname in ('public', 'storage')
      order by schemaname, tablename, policyname;
    `,
  )
  console.log('Policies:', policies)

  const triggers = await runQuery(
    accessToken,
    projectRef,
    `
      select event_object_schema, event_object_table, trigger_name
      from information_schema.triggers
      where trigger_name in (
        'on_auth_user_created',
        'profiles_set_updated_at',
        'applications_set_updated_at',
        'user_preferences_set_updated_at'
      )
      order by event_object_table, trigger_name;
    `,
  )
  console.log('Triggers:', triggers)

  if (url && anonKey) {
    const probe = await fetch(`${url.replace(/\/$/, '')}/rest/v1/profiles?select=id&limit=1`, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
    })
    console.log(`REST probe /profiles status ${probe.status} (401/empty with anon key is expected under RLS)`)
    if (!probe.ok && probe.status !== 401 && probe.status !== 200) {
      console.log(await probe.text())
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
