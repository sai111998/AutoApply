import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

function loadEnvFile(fileName: string) {
  const filePath = path.resolve(process.cwd(), fileName)
  if (!existsSync(filePath)) return
  const text = readFileSync(filePath, 'utf8')
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
}

loadEnvFile('.env')
loadEnvFile('.env.local')

export const CRUCIVE_DEMO_API_KEY = 'test-demo-api-key-2026'

function envFlag(name: string, fallback: boolean, env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[name]?.trim().toLowerCase()
  if (!raw) return fallback
  return raw !== 'false' && raw !== '0' && raw !== 'off'
}

export function isDevelopmentMode(env: NodeJS.ProcessEnv = process.env): boolean {
  const nodeEnv = env.NODE_ENV?.trim().toLowerCase() ?? ''
  const vercelEnv = env.VERCEL_ENV?.trim().toLowerCase() ?? ''
  if (nodeEnv === 'production' || vercelEnv === 'production') return false
  return nodeEnv === 'development' || nodeEnv === ''
}

export function resolveCruciveCredentials(env: NodeJS.ProcessEnv = process.env) {
  const enabled = envFlag('CRUCIVE_ENABLED', true, env)
  const development = isDevelopmentMode(env)
  const configured = env.CRUCIVE_API_KEY?.trim() ?? ''
  if (configured && configured !== CRUCIVE_DEMO_API_KEY) {
    return { cruciveApiKey: configured, cruciveUsingDemoKey: false, cruciveEnabled: enabled }
  }
  if (development && (!configured || configured === CRUCIVE_DEMO_API_KEY)) {
    return { cruciveApiKey: CRUCIVE_DEMO_API_KEY, cruciveUsingDemoKey: true, cruciveEnabled: enabled }
  }
  return { cruciveApiKey: '', cruciveUsingDemoKey: false, cruciveEnabled: enabled }
}

export function getServerConfig() {
  const llmApiKey = process.env.LLM_API_KEY?.trim() ?? ''
  const crucive = resolveCruciveCredentials()
  return {
    port: Number(process.env.API_PORT ?? 8787),
    llmApiKey,
    llmApiBaseUrl: (process.env.LLM_API_BASE_URL?.trim() || 'https://api.openai.com/v1').replace(/\/$/, ''),
    llmModel: process.env.LLM_MODEL?.trim() || 'gpt-4o-mini',
    supabaseUrl: process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim() || '',
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || '',
    joobleApiKey: process.env.JOOBLE_API_KEY?.trim() ?? '',
    joobleEnabled: envFlag('JOOBLE_ENABLED', true),
    joobleApiBaseUrl: (process.env.JOOBLE_API_BASE_URL?.trim() || 'https://jooble.org/api').replace(/\/$/, ''),
    usajobsApiKey: process.env.USAJOBS_API_KEY?.trim() ?? '',
    usajobsUserAgentEmail: process.env.USAJOBS_USER_AGENT_EMAIL?.trim() ?? '',
    usajobsEnabled: envFlag('USAJOBS_ENABLED', true),
    cruciveApiKey: crucive.cruciveApiKey,
    cruciveEnabled: crucive.cruciveEnabled,
    cruciveUsingDemoKey: crucive.cruciveUsingDemoKey,
    cruciveApiBaseUrl: (process.env.CRUCIVE_API_BASE_URL?.trim() || 'https://api.crucive.com').replace(/\/$/, ''),
  }
}

export type ServerConfig = ReturnType<typeof getServerConfig>
