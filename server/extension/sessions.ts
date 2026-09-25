import { randomUUID } from 'node:crypto'
import { applyAgentMessage, createExtensionSession } from '../../extension/src/shared/session'
import { isAgentMessage, type AgentMessage } from '../../extension/src/shared/messages'
import type { ExtensionSession } from '../../extension/src/shared/types'

const sessions = new Map<string, ExtensionSession>()

export function resetExtensionSessionsForTests() {
  sessions.clear()
}

export function listExtensionSessions(userId: string): ExtensionSession[] {
  return [...sessions.values()].filter((session) => session.userId === userId)
}

export function getExtensionSession(applicationSessionId: string, userId?: string | null): ExtensionSession | null {
  const session = sessions.get(applicationSessionId) ?? null
  if (!session) return null
  if (userId && session.userId !== userId) return null
  return session
}

export function saveExtensionSession(session: ExtensionSession): ExtensionSession {
  sessions.set(session.applicationSessionId, session)
  return session
}

export function startExtensionSession(input: {
  userId: string
  jobId?: string | null
  applicationId?: string | null
  resumeVersionId?: string | null
  currentUrl?: string | null
}): ExtensionSession {
  const session = applyAgentMessage(
    createExtensionSession({
      applicationSessionId: `ext-${randomUUID()}`,
      userId: input.userId,
      jobId: input.jobId,
      applicationId: input.applicationId,
      resumeVersionId: input.resumeVersionId,
      currentUrl: input.currentUrl,
    }),
    {
      type: 'START_APPLICATION',
      userId: input.userId,
      jobId: input.jobId,
      applicationId: input.applicationId,
      resumeVersionId: input.resumeVersionId,
      url: input.currentUrl,
    },
  )
  return saveExtensionSession(session)
}

export function applyExtensionEvent(applicationSessionId: string, userId: string, message: unknown): ExtensionSession | null {
  const session = getExtensionSession(applicationSessionId, userId)
  if (!session || !isAgentMessage(message)) return null
  const next = applyAgentMessage(session, message as AgentMessage)
  return saveExtensionSession(next)
}
