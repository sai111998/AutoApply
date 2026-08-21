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

export function getServerConfig() {
  const llmApiKey = process.env.LLM_API_KEY?.trim() ?? ''
  return {
    port: Number(process.env.API_PORT ?? 8787),
    llmApiKey,
    llmApiBaseUrl: (process.env.LLM_API_BASE_URL?.trim() || 'https://api.openai.com/v1').replace(/\/$/, ''),
    llmModel: process.env.LLM_MODEL?.trim() || 'gpt-4o-mini',
    supabaseUrl: process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim() || '',
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || '',
  }
}

export type ServerConfig = ReturnType<typeof getServerConfig>
