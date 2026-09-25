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

function envFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase()
  if (!raw) return fallback
  return raw !== 'false' && raw !== '0' && raw !== 'off'
}

function envList(name: string, fallback: string[] = []): string[] {
  const raw = process.env[name]?.trim()
  if (!raw) return [...fallback]
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

export function getServerConfig() {
  const llmApiKey = process.env.LLM_API_KEY?.trim() ?? ''
  return {
    port: Number(process.env.API_PORT ?? 8787),
    llmApiKey,
    llmApiBaseUrl: (process.env.LLM_API_BASE_URL?.trim() || 'https://api.openai.com/v1').replace(/\/$/, ''),
    llmModel: process.env.LLM_MODEL?.trim() || 'gpt-4o-mini',
    supabaseUrl: process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim() || '',
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY?.trim() || process.env.VITE_SUPABASE_ANON_KEY?.trim() || '',
    frontendSupabaseUrl: process.env.VITE_SUPABASE_URL?.trim() || '',
    joobleApiKey: process.env.JOOBLE_API_KEY?.trim() ?? '',
    joobleEnabled: envFlag('JOOBLE_ENABLED', true),
    joobleApiBaseUrl: (process.env.JOOBLE_API_BASE_URL?.trim() || 'https://jooble.org/api').replace(/\/$/, ''),
    usajobsApiKey: process.env.USAJOBS_API_KEY?.trim() ?? '',
    usajobsUserAgentEmail: process.env.USAJOBS_USER_AGENT_EMAIL?.trim() ?? '',
    usajobsEnabled: envFlag('USAJOBS_ENABLED', true),
    jobOpportunitiesEnabled: envFlag('JOB_OPPORTUNITIES_ENABLED', true),
    jobOpportunitiesApiBaseUrl: (
      process.env.JOB_OPPORTUNITIES_API_BASE_URL?.trim() || 'https://api.jobopportunitiesapi.org'
    ).replace(/\/$/, ''),
    greenhouseEnabled: envFlag('GREENHOUSE_ENABLED', true),
    greenhouseBoardTokens: envList('GREENHOUSE_BOARD_TOKENS', ['gitlab']),
    greenhouseJobBoardApiKey: process.env.GREENHOUSE_JOB_BOARD_API_KEY?.trim() || '',
    leverEnabled: envFlag('LEVER_ENABLED', true),
    leverSites: envList('LEVER_SITES', []),
    ashbyEnabled: envFlag('ASHBY_ENABLED', true),
    ashbyBoards: envList('ASHBY_BOARDS', []),
    rapidApiKey: process.env.RAPIDAPI_KEY?.trim() ?? '',
    jsearchEnabled: envFlag('JSEARCH_ENABLED', true),
    jsearchApiBaseUrl: (process.env.JSEARCH_API_BASE_URL?.trim() || 'https://jsearch.p.rapidapi.com').replace(/\/$/, ''),
    jsearchMaxPages: Number(process.env.JSEARCH_MAX_PAGES ?? 1),
  }
}

type AtsDiscoveryFields =
  | 'greenhouseEnabled'
  | 'greenhouseBoardTokens'
  | 'greenhouseJobBoardApiKey'
  | 'leverEnabled'
  | 'leverSites'
  | 'ashbyEnabled'
  | 'ashbyBoards'

type JsearchDiscoveryFields = 'rapidApiKey' | 'jsearchEnabled' | 'jsearchApiBaseUrl' | 'jsearchMaxPages'

type SupabaseSessionFields = 'supabaseAnonKey' | 'frontendSupabaseUrl'

export type ServerConfig = Omit<
  ReturnType<typeof getServerConfig>,
  AtsDiscoveryFields | JsearchDiscoveryFields | SupabaseSessionFields
> & {
  supabaseAnonKey?: string
  frontendSupabaseUrl?: string
  greenhouseEnabled?: boolean
  greenhouseBoardTokens?: string[]
  greenhouseJobBoardApiKey?: string
  leverEnabled?: boolean
  leverSites?: string[]
  ashbyEnabled?: boolean
  ashbyBoards?: string[]
  rapidApiKey?: string
  jsearchEnabled?: boolean
  jsearchApiBaseUrl?: string
  jsearchMaxPages?: number
}

export function atsDiscoveryConfig(config: ServerConfig) {
  return {
    greenhouseEnabled: config.greenhouseEnabled ?? false,
    greenhouseBoardTokens: config.greenhouseBoardTokens ?? [],
    greenhouseJobBoardApiKey: config.greenhouseJobBoardApiKey ?? '',
    leverEnabled: config.leverEnabled ?? false,
    leverSites: config.leverSites ?? [],
    ashbyEnabled: config.ashbyEnabled ?? false,
    ashbyBoards: config.ashbyBoards ?? [],
  }
}
