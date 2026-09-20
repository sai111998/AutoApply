import type { PageInspectionMessage } from '../shared/messages'
import { isJobPilotAppUrl, userIdFromStorageLike } from '../shared/page-session'
import { JOBPILOT_INTERNAL_PAGE, jobpilotInternalInspection, type EmployerPageInspection } from '../shared/tab-session'

function setRow(id: string, value: string) {
  const node = document.getElementById(id)
  if (node) node.textContent = value
}

function renderWorkspace(url: string, status: string) {
  const inspection = jobpilotInternalInspection(url)
  setRow('url', inspection.url)
  setRow('title', 'JobPilot workspace')
  setRow('provider', 'jobpilot')
  setRow('confidence', '—')
  setRow('application', JOBPILOT_INTERNAL_PAGE)
  setRow('fields', 'none')
  setRow('buttons', 'none')
  setRow('captcha', 'no')
  setRow('mfa', 'no')
  setRow('login', 'no')
  setRow('session', status)
}

function render(inspection: PageInspectionMessage | EmployerPageInspection, status?: string) {
  if ('pageKind' in inspection && inspection.pageKind === JOBPILOT_INTERNAL_PAGE) {
    renderWorkspace(inspection.url, status || 'connected')
    return
  }
  const detection = inspection.detection
  setRow('url', inspection.url)
  setRow('title', 'title' in inspection ? inspection.title : '')
  setRow('provider', detection.provider)
  setRow('confidence', `${Math.round(detection.confidence * 100)}%`)
  setRow('application', detection.isApplicationPage ? 'yes' : detection.isJobDetailsPage ? 'job details' : 'no')
  setRow('fields', detection.fields.map((field) => field.label).join(', ') || 'none')
  setRow('buttons', detection.buttons.map((button) => button.label).join(', ') || 'none')
  setRow('captcha', detection.challenges.captcha ? 'yes' : 'no')
  setRow('mfa', detection.challenges.mfa ? 'yes' : 'no')
  setRow('login', detection.challenges.login ? 'yes' : 'no')
  const sessionState =
    status ||
    ('session' in inspection && inspection.session && typeof inspection.session === 'object'
      ? (inspection.session as { state?: string }).state
      : undefined)
  setRow('session', sessionState ?? 'idle')
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

function queryFocusedTab(): Promise<{ id?: number; url?: string; title?: string } | null> {
  return new Promise((resolve) => {
    const finish = (tabs: Array<{ id?: number; url?: string; title?: string }>) => resolve(tabs[0] ?? null)
    if (!chrome.tabs?.query) {
      resolve(null)
      return
    }
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        finish(tabs)
        return
      }
      chrome.tabs.query({ active: true, currentWindow: true }, finish)
    })
  })
}

function resolveTabUrl(tab: { id?: number; url?: string } | null): Promise<string> {
  if (tab?.url) return Promise.resolve(tab.url)
  if (!tab?.id || !chrome.scripting?.executeScript) return Promise.resolve('')
  return chrome.scripting
    .executeScript({
      target: { tabId: tab.id },
      func: () => location.href,
    })
    .then((results) => String(Array.isArray(results) ? results[0]?.result || '' : ''))
    .catch(() => '')
}

function inspectEmployerTab(tabId: number): Promise<PageInspectionMessage | null> {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage?.(tabId, { type: 'INSPECT_PAGE' }, (response) => {
      if (response && typeof response === 'object' && 'detection' in response) {
        resolve(response as PageInspectionMessage)
        return
      }
      void chrome.scripting
        ?.executeScript({ target: { tabId }, files: ['content.js'] })
        .then(() => {
          chrome.tabs.sendMessage?.(tabId, { type: 'INSPECT_PAGE' }, (retry) => {
            if (retry && typeof retry === 'object' && 'detection' in retry) resolve(retry as PageInspectionMessage)
            else resolve(null)
          })
        })
        .catch(() => resolve(null))
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

async function showInspection() {
  const stored = await sendRuntime({ type: 'GET_EMPLOYER_SESSION' })
  const employerSession = stored.employerSession as { tabId?: number; currentUrl?: string; status?: string } | undefined
  const storedInspection = stored.inspection as EmployerPageInspection | undefined
  if (storedInspection && storedInspection.pageKind !== JOBPILOT_INTERNAL_PAGE) {
    render(storedInspection, employerSession?.status || 'opening')
    if (employerSession?.tabId) {
      const live = await inspectEmployerTab(employerSession.tabId)
      if (live) render(live, employerSession.status)
    }
    return
  }
  const tab = await queryFocusedTab()
  const url = await resolveTabUrl(tab)
  if (tab?.id) {
    const connection = await connectFromTab(tab.id)
    const status = connection.connected ? 'connected' : String(connection.error || 'not connected')
    if (isJobPilotAppUrl(url) || isJobPilotAppUrl(tab.url)) {
      renderWorkspace(url || tab.url || 'http://localhost:5173/jobs', status)
      return
    }
  }
  if (employerSession?.tabId) {
    const live = await inspectEmployerTab(employerSession.tabId)
    if (live) {
      render(live, employerSession.status)
      return
    }
  }
  if (isJobPilotAppUrl(url)) {
    renderWorkspace(url, 'connected')
    return
  }
  failed('Waiting for an employer application tab.')
}

void showInspection()
document.getElementById('process')?.addEventListener('click', () => {
  void (async () => {
    const tab = await queryFocusedTab()
    const tabId = tab?.id
    const url = await resolveTabUrl(tab)
    if (tabId && isJobPilotAppUrl(url || tab.url)) {
      const connected = await connectFromTab(tabId)
      if (!connected.connected) {
        renderWorkspace(url || tab.url || '', String(connected.error || 'not connected'))
        return
      }
    } else if (tabId) {
      const connected = await connectFromTab(tabId)
      if (!connected.connected && isJobPilotAppUrl(url)) {
        renderWorkspace(url, String(connected.error || 'not connected'))
        return
      }
    }
    const peeked = await sendRuntime({ type: 'PEEK_QUEUE' })
    const origin = typeof peeked.origin === 'string' ? peeked.origin : undefined
    if (origin && chrome.permissions?.request) {
      await new Promise<void>((resolve) => chrome.permissions.request({ origins: [origin] }, () => resolve()))
    }
    const processed = await sendRuntime({ type: 'PROCESS_QUEUE' })
    const inspection = processed.inspection as EmployerPageInspection | undefined
    const employerSession = processed.employerSession as { tabId?: number; status?: string; currentUrl?: string } | undefined
    if (inspection && inspection.pageKind !== JOBPILOT_INTERNAL_PAGE) {
      render(inspection, employerSession?.status || (processed.ok ? 'opening' : 'failed'))
      return
    }
    if (processed.item && typeof processed.item === 'object') {
      const item = processed.item as { jobTitle?: string; applicationUrl?: string }
      setRow('url', employerSession?.currentUrl || item.applicationUrl || String(processed.error || 'Queue processed'))
      setRow('title', item.jobTitle || 'Queued application')
      setRow('session', employerSession?.status || (processed.ok ? 'opening' : String(processed.error || 'failed')))
      if (typeof processed.tabId === 'number') {
        const live = await inspectEmployerTab(processed.tabId)
        if (live) render(live, employerSession?.status || 'opening')
      }
      return
    }
    await showInspection()
  })()
})
