const FALLBACK_BACKEND = 'http://127.0.0.1:8787'

function readSession(): { userId: string | null; backendOrigin: string } {
  const root = document.documentElement.dataset
  const userId =
    root.jobpilotUserId?.trim() ||
    sessionStorage.getItem('jobpilot.userId')?.trim() ||
    (sessionStorage.getItem('jobpilot.demo') === '1' ? '11111111-1111-4111-8111-111111111111' : '') ||
    null
  const backendOrigin =
    root.jobpilotBackend?.trim() ||
    sessionStorage.getItem('jobpilot.backendOrigin')?.trim() ||
    (location.port === '5173' || location.port === '4173' ? location.origin : FALLBACK_BACKEND)
  return { userId: userId || null, backendOrigin: backendOrigin.replace(/\/$/, '') }
}

function connect(processQueue = false) {
  const { userId, backendOrigin } = readSession()
  if (!userId) return
  chrome.runtime.sendMessage({
    type: 'CONNECT_SESSION',
    userId,
    backendOrigin,
  })
  if (processQueue) chrome.runtime.sendMessage({ type: 'PROCESS_QUEUE' })
}

connect()
window.addEventListener('jobpilot-extension-connect', () => connect())
window.addEventListener('jobpilot-extension-process', () => connect(true))
document.addEventListener('visibilitychange', () => connect())
setInterval(() => connect(), 1_000)
