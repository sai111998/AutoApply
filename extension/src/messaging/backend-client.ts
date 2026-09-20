import type { AgentMessage } from '../shared/messages'
import type { ExtensionApplicationContext, ExtensionSession } from '../shared/types'

export const DEFAULT_BACKEND_ORIGIN = 'http://127.0.0.1:8787'

export interface ExtensionBackendClient {
  origin: string
  userId: string | null
}

function headers(userId: string | null): Record<string, string> {
  const value: Record<string, string> = { Accept: 'application/json', 'Content-Type': 'application/json' }
  if (userId) value['x-jobpilot-user-id'] = userId
  return value
}

function joinUrl(origin: string, path: string): string {
  return `${origin.replace(/\/$/, '')}${path}`
}

export async function fetchApplicationContext(
  client: ExtensionBackendClient,
  query: { applicationId?: string; jobId?: string; resumeVersionId?: string } = {},
): Promise<ExtensionApplicationContext> {
  if (!client.userId) throw new Error('JobPilot user is not connected.')
  const params = new URLSearchParams({ userId: client.userId })
  if (query.applicationId) params.set('applicationId', query.applicationId)
  if (query.jobId) params.set('jobId', query.jobId)
  if (query.resumeVersionId) params.set('resumeVersionId', query.resumeVersionId)
  const response = await fetch(joinUrl(client.origin, `/api/extension/context?${params}`), {
    headers: headers(client.userId),
  })
  if (!response.ok) throw new Error('Could not load the application context.')
  return (await response.json()) as ExtensionApplicationContext
}

export async function reportExtensionEvent(
  client: ExtensionBackendClient,
  applicationSessionId: string,
  message: AgentMessage,
): Promise<ExtensionSession | null> {
  if (!client.userId) return null
  const response = await fetch(joinUrl(client.origin, `/api/extension/sessions/${encodeURIComponent(applicationSessionId)}/events`), {
    method: 'POST',
    headers: headers(client.userId),
    body: JSON.stringify({ userId: client.userId, message }),
  })
  if (!response.ok) return null
  const body = (await response.json()) as { session?: ExtensionSession }
  return body.session ?? null
}

export function backendClientFromSettings(settings: { backendOrigin?: string; userId?: string | null }): ExtensionBackendClient {
  return {
    origin: settings.backendOrigin?.trim() || DEFAULT_BACKEND_ORIGIN,
    userId: settings.userId ?? null,
  }
}
