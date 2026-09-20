import { isAgentMessage } from '../shared/messages'
import { backendClientFromSettings, fetchApplicationContext, reportExtensionEvent } from '../messaging/backend-client'
import { applyBackgroundMessage, getBackgroundSession, startBackgroundSession } from './session-store'
import type { AgentMessage } from '../shared/messages'

const settings = { backendOrigin: 'http://127.0.0.1:8787', userId: null as string | null }

function reply(sendResponse: (value: unknown) => void, value: unknown) {
  sendResponse(value)
}

async function handleMessage(raw: unknown): Promise<unknown> {
  if (!isAgentMessage(raw)) return { ok: false }
  const message = raw as AgentMessage
  if (message.type === 'CONNECT_SESSION') {
    settings.userId = message.userId
    if (message.backendOrigin) settings.backendOrigin = message.backendOrigin
    return { ok: true, userId: settings.userId }
  }
  if (message.type === 'START_APPLICATION') {
    const session = startBackgroundSession(message)
    if (settings.userId !== message.userId) settings.userId = message.userId
    try {
      const context = await fetchApplicationContext(backendClientFromSettings(settings), {
        applicationId: message.applicationId ?? undefined,
        jobId: message.jobId ?? undefined,
        resumeVersionId: message.resumeVersionId ?? undefined,
      })
      return { ok: true, session, context }
    } catch {
      return { ok: true, session, context: null }
    }
  }
  if (message.type === 'INSPECT_PAGE') {
    return { ok: true, session: getBackgroundSession() }
  }
  const session = applyBackgroundMessage(message)
  if (session && message.type !== 'PAGE_INSPECTION' && message.type !== 'INSPECT_PAGE') {
    await reportExtensionEvent(backendClientFromSettings(settings), session.applicationSessionId, message).catch(() => null)
  }
  return { ok: true, session }
}

chrome.runtime.onMessage.addListener((raw, _sender, sendResponse) => {
  void handleMessage(raw).then((value) => reply(sendResponse, value))
  return true
})

chrome.runtime.onMessageExternal.addListener((raw, _sender, sendResponse) => {
  void handleMessage(raw).then((value) => reply(sendResponse, value))
  return true
})
