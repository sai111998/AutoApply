import { applyAgentMessage, createExtensionSession } from '../shared/session'
import type { AgentMessage } from '../shared/messages'
import type { ExtensionSession } from '../shared/types'

let current: ExtensionSession | null = null

export function getBackgroundSession(): ExtensionSession | null {
  return current
}

export function resetBackgroundSession(): void {
  current = null
}

export function startBackgroundSession(message: Extract<AgentMessage, { type: 'START_APPLICATION' }>): ExtensionSession {
  current = applyAgentMessage(
    createExtensionSession({
      applicationSessionId: message.applicationSessionId,
      userId: message.userId,
      jobId: message.jobId,
      applicationId: message.applicationId,
      resumeVersionId: message.resumeVersionId,
      currentUrl: message.url,
    }),
    message,
  )
  return current
}

export function applyBackgroundMessage(message: AgentMessage): ExtensionSession | null {
  if (message.type === 'START_APPLICATION') return startBackgroundSession(message)
  if (!current) return null
  current = applyAgentMessage(current, message)
  return current
}
