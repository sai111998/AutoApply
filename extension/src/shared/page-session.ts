export const DEMO_JOBPILOT_USER_ID = '11111111-1111-4111-8111-111111111111'
export const LOCAL_API_ORIGINS = ['http://127.0.0.1:8787', 'http://localhost:8787'] as const

export function backendOriginsFor(pageOrigin?: string | null): string[] {
  const origin = pageOrigin?.trim().replace(/\/$/, '') || ''
  const list: string[] = []
  if (origin) list.push(origin)
  for (const item of LOCAL_API_ORIGINS) {
    if (!list.includes(item)) list.push(item)
  }
  return list
}

export function isJobPilotAppUrl(url?: string | null): boolean {
  if (!url) return false
  try {
    const parsed = new URL(url)
    const localHost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
    const localPort = parsed.port === '5173' || parsed.port === '4173' || parsed.port === '8787'
    return localHost && localPort
  } catch {
    return false
  }
}

export function userIdFromStorageLike(input: {
  datasetUserId?: string | null
  sessionUserId?: string | null
  demo?: boolean
  localValues?: Record<string, string>
}): string | null {
  const dataset = input.datasetUserId?.trim()
  if (dataset) return dataset
  const session = input.sessionUserId?.trim()
  if (session) return session
  if (input.demo) return DEMO_JOBPILOT_USER_ID
  for (const value of Object.values(input.localValues ?? {})) {
    try {
      const parsed = JSON.parse(value) as { user?: { id?: string }; currentSession?: { user?: { id?: string } } }
      const id = parsed.user?.id || parsed.currentSession?.user?.id
      if (id?.trim()) return id.trim()
    } catch {
      // Ignore non-JSON storage keys.
    }
  }
  return null
}
