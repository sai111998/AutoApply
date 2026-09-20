import { backendOriginsFor, isJobPilotAppUrl, userIdFromStorageLike } from '../shared/page-session'

function localValues(): Record<string, string> {
  const values: Record<string, string> = {}
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (!key) continue
      values[key] = localStorage.getItem(key) || ''
    }
  } catch {
    return values
  }
  return values
}

export function readSession(): { userId: string | null; backendOrigin: string } {
  const root = document.documentElement.dataset
  const userId = userIdFromStorageLike({
    datasetUserId: root.jobpilotUserId,
    sessionUserId: sessionStorage.getItem('jobpilot.userId'),
    demo: sessionStorage.getItem('jobpilot.demo') === '1',
    localValues: localValues(),
  })
  const backendOrigin = (
    root.jobpilotBackend?.trim() ||
    sessionStorage.getItem('jobpilot.backendOrigin')?.trim() ||
    (isJobPilotAppUrl(location.href) ? location.origin : backendOriginsFor()[0])
  ).replace(/\/$/, '')
  return { userId, backendOrigin }
}

function connect(processQueue = false) {
  const session = readSession()
  if (!session.userId) return
  chrome.runtime.sendMessage({
    type: 'CONNECT_SESSION',
    userId: session.userId,
    backendOrigin: session.backendOrigin,
  })
  if (processQueue) chrome.runtime.sendMessage({ type: 'PROCESS_QUEUE' })
}

connect()
window.addEventListener('jobpilot-extension-connect', () => connect())
window.addEventListener('jobpilot-extension-process', () => connect(true))
document.addEventListener('visibilitychange', () => connect())
setInterval(() => connect(), 1_000)

chrome.runtime.onMessage.addListener((raw, _sender, sendResponse) => {
  const type = raw && typeof raw === 'object' ? (raw as { type?: string }).type : ''
  if (type === 'READ_JOBPILOT_SESSION') {
    sendResponse({ type: 'JOBPILOT_SESSION', ...readSession() })
    return
  }
})
