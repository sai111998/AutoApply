import type { PageInspectionMessage } from '../shared/messages'

function setRow(id: string, value: string) {
  const node = document.getElementById(id)
  if (node) node.textContent = value
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

function connectFromTab(tabId: number): Promise<void> {
  return chrome.scripting
    ?.executeScript({
      target: { tabId },
      func: () => ({
        userId:
          document.documentElement.dataset.jobpilotUserId ||
          sessionStorage.getItem('jobpilot.userId') ||
          (sessionStorage.getItem('jobpilot.demo') === '1' ? '11111111-1111-4111-8111-111111111111' : ''),
        backendOrigin: document.documentElement.dataset.jobpilotBackend || sessionStorage.getItem('jobpilot.backendOrigin') || location.origin,
      }),
    })
    .then(async (results) => {
      const value = Array.isArray(results) ? (results[0] as { result?: { userId?: string; backendOrigin?: string } } | undefined)?.result : undefined
      if (value?.userId) {
        chrome.runtime.sendMessage({
          type: 'CONNECT_SESSION',
          userId: value.userId,
          backendOrigin: value.backendOrigin,
        })
      }
      await chrome.scripting?.executeScript({ target: { tabId }, files: ['bridge.js'] }).catch(() => undefined)
    })
    .catch(() => undefined)
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
    void connectFromTab(tab.id)
    chrome.tabs.sendMessage?.(tab.id, { type: 'INSPECT_PAGE' }, (response) => {
      if (chrome.runtime.lastError || !response) {
        void chrome.scripting
          ?.executeScript({ target: { tabId: tab.id! }, files: ['content.js'] })
          .then(() => {
            chrome.tabs.sendMessage?.(tab.id!, { type: 'INSPECT_PAGE' }, (retry) => {
              if (retry && typeof retry === 'object' && 'detection' in retry) render(retry as PageInspectionMessage)
              else failed('Open a page the extension can inspect, such as the local test form.')
            })
          })
          .catch(() => failed('The extension does not have access to this tab.'))
        return
      }
      if (typeof response === 'object' && response && 'detection' in response) {
        render(response as PageInspectionMessage)
      }
    })
  })
}

requestInspection()
document.getElementById('process')?.addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tabId = tabs[0]?.id
    const afterConnect = () => {
      chrome.runtime.sendMessage({ type: 'PEEK_QUEUE' }, (peeked) => {
        const origin = peeked && typeof peeked === 'object' ? (peeked as { origin?: string }).origin : undefined
        const continueProcess = () => chrome.runtime.sendMessage({ type: 'PROCESS_QUEUE' }, () => requestInspection())
        if (origin && chrome.permissions?.request) {
          chrome.permissions.request({ origins: [origin] }, () => continueProcess())
          return
        }
        continueProcess()
      })
    }
    if (tabId) void connectFromTab(tabId).then(afterConnect)
    else afterConnect()
  })
})
