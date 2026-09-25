export const EXTENSION_SESSION_EVENT = 'jobpilot-extension-connect'
export const EXTENSION_PROCESS_EVENT = 'jobpilot-extension-process'

export function jobpilotBackendOrigin(locationOrigin = typeof window === 'undefined' ? '' : window.location.origin): string {
  return locationOrigin.replace(/\/$/, '') || 'http://127.0.0.1:8787'
}

export function rememberExtensionSession(input: { userId?: string | null; backendOrigin?: string | null } = {}) {
  if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') return
  const userId = input.userId?.trim()
  if (userId) sessionStorage.setItem('jobpilot.userId', userId)
  const backendOrigin = jobpilotBackendOrigin(input.backendOrigin || window.location.origin)
  sessionStorage.setItem('jobpilot.backendOrigin', backendOrigin)
  document.documentElement.dataset.jobpilotUserId = userId || sessionStorage.getItem('jobpilot.userId') || ''
  document.documentElement.dataset.jobpilotBackend = backendOrigin
  window.dispatchEvent(
    new CustomEvent(EXTENSION_SESSION_EVENT, {
      detail: { userId: userId || sessionStorage.getItem('jobpilot.userId'), backendOrigin },
    }),
  )
}

export function requestExtensionQueueProcessing() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(EXTENSION_PROCESS_EVENT))
}

export async function handshakeExtensionSession(
  input: { userId?: string | null; processQueue?: boolean } = {},
  waitMs = 700,
) {
  rememberExtensionSession({ userId: input.userId })
  if (input.processQueue) requestExtensionQueueProcessing()
  await new Promise((resolve) => setTimeout(resolve, waitMs))
}
