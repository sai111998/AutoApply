import type { PageInspectionMessage } from '../shared/messages'
import { isJobPilotAppUrl, userIdFromStorageLike } from '../shared/page-session'

function setRow(id: string, value: string) {
  const node = document.getElementById(id)
  if (node) node.textContent = value
}

function renderWorkspace(url: string, status: string) {
  setRow('url', url)
  setRow('title', 'JobPilot workspace')
  setRow('provider', 'jobpilot')
  setRow('confidence', '—')
  setRow('application', 'JobPilot app — not an employer form')
  setRow('fields', 'none')
  setRow('buttons', 'none')
  setRow('captcha', 'no')
  setRow('mfa', 'no')
  setRow('login', 'no')
  setRow('session', status)
}

function render(inspection: PageInspectionMessage) {
  const detection = inspection.detection
  setRow('url', inspection.url)
  setRow('title', inspection.title)
  setRow('provider', detection.provider)
  setRow('confidence', `${Math.round(detection.confidence * 100)}%`)
  setRow('application', detection.isApplicationPage ? 'yes' : detection.isJobDetailsPage ? 'job details' : 'no')
  setRow('fields', detection.fields.map((field) => field.label).join(', ') || 'none')
  setRow('buttons', detection.buttons.map((button) => button.label).join(', ') || 'none')
  setRow('captcha', detection.challenges.captcha ? 'yes' : 'no')
  setRow('mfa', detection.challenges.mfa ? 'yes' : 'no')
  setRow('login', detection.challenges.login ? 'yes' : 'no')
  setRow('session', inspection.session?.state ?? 'idle')
}

function failed(reason: string) {
  setRow('url', reason)
  setRow('title', '—')
  setRow('provider', 'unknown')
  setRow('confidence', '0%')
  setRow('application', 'no')
  setRow('fields', 'none')
  setRow('buttons', 'none')
  setRow('captcha', 'no')
  setRow('mfa', 'no')
  setRow('login', 'no')
  setRow('session', 'failed')
}

function sendRuntime(message: unknown): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      resolve((response && typeof response === 'object' ? response : {}) as Record<string, unknown>)
    })
  })
}

function readTabSession(tabId: number): Promise<{ userId: string | null; backendOrigin?: string }> {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage?.(tabId, { type: 'READ_JOBPILOT_SESSION' }, (response) => {
      const fromBridge = response && typeof response === 'object' ? (response as { userId?: string; backendOrigin?: string }) : null
      if (fromBridge?.userId) {
        resolve({ userId: fromBridge.userId, backendOrigin: fromBridge.backendOrigin })
        return
      }
      void chrome.scripting
        ?.executeScript({
          target: { tabId },
          func: () => {
            const localValues: Record<string, string> = {}
            for (let index = 0; index < localStorage.length; index += 1) {
              const key = localStorage.key(index)
              if (key) localValues[key] = localStorage.getItem(key) || ''
            }
            return {
              datasetUserId: document.documentElement.dataset.jobpilotUserId || '',
              sessionUserId: sessionStorage.getItem('jobpilot.userId') || '',
              demo: sessionStorage.getItem('jobpilot.demo') === '1',
              backendOrigin: document.documentElement.dataset.jobpilotBackend || sessionStorage.getItem('jobpilot.backendOrigin') || location.origin,
              localValues,
            }
          },
        })
        .then((results) => {
          const value = Array.isArray(results) ? (results[0]?.result as Record<string, unknown> | undefined) : undefined
          const userId = userIdFromStorageLike({
            datasetUserId: String(value?.datasetUserId || ''),
            sessionUserId: String(value?.sessionUserId || ''),
            demo: value?.demo === true,
            localValues: (value?.localValues as Record<string, string> | undefined) ?? {},
          })
          resolve({ userId, backendOrigin: String(value?.backendOrigin || '') })
        })
        .catch(() => resolve({ userId: null }))
    })
  })
}

async function connectFromTab(tabId: number): Promise<Record<string, unknown>> {
  const session = await readTabSession(tabId)
  await chrome.scripting?.executeScript({ target: { tabId }, files: ['bridge.js'] }).catch(() => undefined)
  if (!session.userId) return { connected: false, error: 'No JobPilot user is available on this tab. Stay signed in and reload JobPilot.' }
  return sendRuntime({
    type: 'CONNECT_SESSION',
    userId: session.userId,
    backendOrigin: session.backendOrigin,
  })
}

function requestInspection() {
  if (!chrome.tabs?.query) {
    failed('This popup must run inside the JobPilot extension.')
    return
  }
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0]
    if (!tab?.id) {
      failed('No active tab.')
      return
    }
    const url = tab.url || ''
    void connectFromTab(tab.id).then((connection) => {
      const status = connection.connected ? 'connected' : String(connection.error || 'not connected')
      if (isJobPilotAppUrl(url)) {
        renderWorkspace(url, status)
        return
      }
      chrome.tabs.sendMessage?.(tab.id!, { type: 'INSPECT_PAGE' }, (response) => {
        if (chrome.runtime.lastError || !response) {
          void chrome.scripting
            ?.executeScript({ target: { tabId: tab.id! }, files: ['content.js'] })
            .then(() => {
              chrome.tabs.sendMessage?.(tab.id!, { type: 'INSPECT_PAGE' }, (retry) => {
                if (retry && typeof retry === 'object' && 'detection' in retry) render(retry as PageInspectionMessage)
                else failed(status)
              })
            })
            .catch(() => failed('The extension does not have access to this tab.'))
          return
        }
        if (typeof response === 'object' && response && 'detection' in response) {
          render(response as PageInspectionMessage)
          setRow('session', status)
        }
      })
    })
  })
}

requestInspection()
document.getElementById('process')?.addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0]
    const tabId = tab?.id
    void (async () => {
      if (tabId) {
        const connected = await connectFromTab(tabId)
        if (!connected.connected) {
          renderWorkspace(tab.url || '', String(connected.error || 'not connected'))
          return
        }
      }
      const peeked = await sendRuntime({ type: 'PEEK_QUEUE' })
      const origin = typeof peeked.origin === 'string' ? peeked.origin : undefined
      if (origin && chrome.permissions?.request) {
        await new Promise<void>((resolve) => chrome.permissions.request({ origins: [origin] }, () => resolve()))
      }
      const processed = await sendRuntime({ type: 'PROCESS_QUEUE' })
      if (processed.item && typeof processed.item === 'object') {
        const item = processed.item as { jobTitle?: string; applicationUrl?: string }
        setRow('url', item.applicationUrl || String(processed.error || 'Queue processed'))
        setRow('title', item.jobTitle || 'Queued application')
        setRow('session', processed.ok ? 'opening' : String(processed.error || 'failed'))
        return
      }
      requestInspection()
    })()
  })
})
