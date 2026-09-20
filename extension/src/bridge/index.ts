const DEMO_USER_ID = '11111111-1111-4111-8111-111111111111'
const DEFAULT_BACKEND = 'http://127.0.0.1:8787'

function userIdFromStorage(): string | null {
  try {
    const explicit = sessionStorage.getItem('jobpilot.userId')
    if (explicit?.trim()) return explicit.trim()
    if (sessionStorage.getItem('jobpilot.demo') === '1') return DEMO_USER_ID
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (!key || !key.startsWith('sb-') || !key.includes('auth-token')) continue
      const parsed = JSON.parse(localStorage.getItem(key) || '{}') as {
        user?: { id?: string }
        currentSession?: { user?: { id?: string } }
      }
      const id = parsed.user?.id || parsed.currentSession?.user?.id
      if (id) return id
    }
  } catch {
    return null
  }
  return null
}

function connect() {
  const userId = userIdFromStorage()
  if (!userId) return
  chrome.runtime.sendMessage({
    type: 'CONNECT_SESSION',
    userId,
    backendOrigin: DEFAULT_BACKEND,
  })
}

connect()
window.addEventListener('storage', connect)
document.addEventListener('visibilitychange', connect)
setInterval(connect, 15_000)
