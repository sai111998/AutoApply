import { isAgentMessage } from '../shared/messages'
import { applyBackgroundMessage, getBackgroundSession, startBackgroundSession } from './session-store'
import { inspectApplicationUrl, originPattern } from '../shared/url'
import { nextAgentAction } from '../agent/orchestrate'
import { AGENT_TIMEOUTS } from '../agent/timeouts'
import type { AgentMessage } from '../shared/messages'
import type { ApplicationDetection } from '../shared/types'
import type { AutomationQueueItem, AuthorizedResume } from '../shared/queue'

const settings = { backendOrigin: 'http://127.0.0.1:8787', userId: null as string | null }
let processing = false
let activeTabId: number | null = null
let activeItemId: string | null = null

function headers(): Record<string, string> {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(settings.userId ? { 'x-jobpilot-user-id': settings.userId } : {}),
  }
}

function api(path: string) {
  return `${settings.backendOrigin.replace(/\/$/, '')}${path}`
}

function persistSettings() {
  chrome.storage?.local.set({ backendOrigin: settings.backendOrigin, userId: settings.userId })
}

function restoreSettings(): Promise<void> {
  return new Promise((resolve) => {
    if (!chrome.storage?.local.get) {
      resolve()
      return
    }
    chrome.storage.local.get(['backendOrigin', 'userId'], (value) => {
      if (typeof value.backendOrigin === 'string' && value.backendOrigin) settings.backendOrigin = value.backendOrigin
      if (typeof value.userId === 'string' && value.userId) settings.userId = value.userId
      resolve()
    })
  })
}

async function register() {
  if (!settings.userId) return
  await fetch(api('/api/automation/extension/register'), {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ userId: settings.userId, extensionId: chrome.runtime.id }),
  }).catch(() => null)
}

async function heartbeat() {
  if (!settings.userId) return
  await fetch(api('/api/automation/extension/heartbeat'), {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ userId: settings.userId }),
  }).catch(() => null)
}

async function postEvent(item: AutomationQueueItem, type: string, extras: Record<string, unknown> = {}) {
  await fetch(api('/api/automation/events'), {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      userId: settings.userId,
      itemId: item.itemId,
      applicationId: item.applicationId,
      runId: item.runId,
      type,
      ...extras,
    }),
  }).catch(() => null)
}

function sendTab(tabId: number, message: unknown): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    chrome.tabs?.sendMessage?.(tabId, message, (response) => {
      resolve((response && typeof response === 'object' ? response : {}) as Record<string, unknown>)
    })
  })
}

function requestOrigin(origin: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!chrome.permissions?.request) {
      resolve(true)
      return
    }
    chrome.permissions.request({ origins: [origin] }, (granted) => resolve(Boolean(granted)))
  })
}

function hasOrigin(origin: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!chrome.permissions?.contains) {
      resolve(true)
      return
    }
    chrome.permissions.contains({ origins: [origin] }, (granted) => resolve(Boolean(granted)))
  })
}

function openTab(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('NAVIGATION_TIMEOUT')), AGENT_TIMEOUTS.tabOpenMs)
    chrome.tabs?.create?.({ url, active: true }, (tab) => {
      if (!tab?.id) {
        clearTimeout(timer)
        reject(new Error('NAVIGATION_TIMEOUT'))
        return
      }
      const tabId = tab.id
      const finish = () => {
        clearTimeout(timer)
        resolve(tabId)
      }
      if (!chrome.tabs?.onUpdated?.addListener) {
        finish()
        return
      }
      const onUpdated = (updatedId: number, info: { status?: string }) => {
        if (updatedId === tabId && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(onUpdated)
          finish()
        }
      }
      chrome.tabs.onUpdated.addListener(onUpdated)
      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(onUpdated)
        finish()
      }, AGENT_TIMEOUTS.navigationMs)
    })
  })
}

async function inject(tabId: number) {
  await chrome.scripting?.executeScript?.({ target: { tabId }, files: ['content.js'] }).catch(() => null)
}

async function fetchQueueItem(claim: boolean): Promise<AutomationQueueItem | null> {
  if (!settings.userId) return null
  const query = claim ? '' : '&peek=1'
  const response = await fetch(api(`/api/automation/queue/next?userId=${encodeURIComponent(settings.userId)}${query}`), {
    headers: headers(),
  })
  const body = (await response.json().catch(() => ({}))) as { item?: AutomationQueueItem | null }
  return body.item ?? null
}

async function waitForPauseClear(tabId: number, status: string) {
  const deadline = Date.now() + AGENT_TIMEOUTS.pauseMs
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1_500))
    const inspectedPage = await sendTab(tabId, { type: 'INSPECT_PAGE' })
    const detection = inspectedPage.detection as ApplicationDetection | undefined
    if (!detection) continue
    if (status === 'captcha_required' && !detection.challenges.captcha) return true
    if (status === 'mfa_required' && !detection.challenges.mfa) return true
    if (status === 'login_required' && !detection.challenges.login) return true
    if (status === 'needs_user_input') return false
  }
  return false
}

async function processItem(item: AutomationQueueItem, reuseTabId?: number | null) {
  const inspected = inspectApplicationUrl(item.applicationUrl)
  if (!inspected.ok || !inspected.url) {
    await postEvent(item, 'failed', { reason: inspected.reason, code: 'APPLICATION_URL_INVALID' })
    return
  }
  const origin = originPattern(inspected.url)
  const granted = (await hasOrigin(origin)) || (await requestOrigin(origin))
  if (!granted) {
    await postEvent(item, 'failed', {
      reason: 'JobPilot does not have permission to open this employer site. Use the extension popup to grant access.',
      code: 'APPLICATION_URL_INVALID',
    })
    return
  }
  let tabId = reuseTabId && reuseTabId === activeTabId && activeItemId === item.itemId ? reuseTabId : null
  if (!tabId) {
    await postEvent(item, 'opening', { currentUrl: inspected.url.toString() })
    tabId = await openTab(inspected.url.toString())
  }
  activeTabId = tabId
  activeItemId = item.itemId
  await inject(tabId)
  const profileRes = await fetch(api(`/api/extension/profile?userId=${encodeURIComponent(settings.userId || '')}`), {
    headers: headers(),
  })
  const profileBody = (await profileRes.json().catch(() => ({}))) as { profile?: Record<string, string> }
  const resumeRes = await fetch(
    api(
      `/api/extension/resume?userId=${encodeURIComponent(settings.userId || '')}&applicationId=${encodeURIComponent(item.applicationId || item.itemId)}`,
    ),
    { headers: headers() },
  )
  const resumeBody = (await resumeRes.json().catch(() => ({}))) as { available?: boolean; resume?: AuthorizedResume }
  const values = profileBody.profile ?? {}
  const deadline = Date.now() + AGENT_TIMEOUTS.applicationMs
  let advanced = 0
  while (Date.now() < deadline) {
    const inspectedPage = await sendTab(tabId, { type: 'INSPECT_PAGE' })
    const detection = inspectedPage.detection as ApplicationDetection | undefined
    const html = String(inspectedPage.html ?? '')
    const url = String(inspectedPage.url ?? inspected.url.toString())
    if (!detection) {
      await inject(tabId)
      await new Promise((resolve) => setTimeout(resolve, 400))
      continue
    }
    await postEvent(item, 'application_detected', { currentUrl: url, provider: detection.provider })
    const visible = inspectedPage.visible as { apply?: boolean; next?: boolean; submit?: boolean } | undefined
    const action = nextAgentAction(detection, html)
    if (action.type === 'pause') {
      await postEvent(item, action.status, {
        currentUrl: url,
        questions: (action.questions ?? []).map((prompt, index) => ({ id: `unknown-${index + 1}`, prompt, answer: null })),
      })
      const resumed = await waitForPauseClear(tabId, action.status)
      if (!resumed) {
        if (action.status === 'needs_user_input') return
        await postEvent(item, 'failed', { reason: 'Application preparation timed out.', code: 'APPLICATION_TIMEOUT' })
      }
      continue
    }
    if (action.type === 'fail' && !visible?.apply && !visible?.next && !visible?.submit) {
      await postEvent(item, 'failed', { currentUrl: url, reason: action.reason, code: action.code })
      return
    }
    if (visible?.submit && !visible.next && !visible.apply) {
      await postEvent(item, 'ready_for_review', { currentUrl: url, provider: detection.provider })
      return
    }
    const click = visible?.apply && !detection.isApplicationPage ? 'apply' : visible?.next ? 'next' : null
    if (!click && detection.isApplicationPage) {
      await postEvent(item, 'ready_for_review', { currentUrl: url, provider: detection.provider })
      return
    }
    await postEvent(item, 'filling', { currentUrl: url, provider: detection.provider })
    const stepped = await sendTab(tabId, {
      type: 'RUN_AGENT_STEP',
      values,
      resume: resumeBody.available ? resumeBody.resume : null,
      click,
    })
    if (click === 'next' && stepped.uploaded === false && resumeBody.available && html.includes('type="file"')) {
      await postEvent(item, 'failed', { currentUrl: url, reason: 'The selected resume could not be uploaded to the employer form.', code: 'RESUME_UPLOAD_FAILED' })
      return
    }
    advanced += 1
    if (advanced > 8) {
      await postEvent(item, 'ready_for_review', { currentUrl: url })
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 700))
  }
  await postEvent(item, 'failed', { reason: 'Application preparation timed out.', code: 'APPLICATION_TIMEOUT' })
}

async function processQueue() {
  if (processing || !settings.userId) return
  processing = true
  try {
    await register()
    const item = await fetchQueueItem(true)
    if (!item) return
    const reuse = activeItemId === item.itemId ? activeTabId : null
    await processItem(item, reuse)
  } finally {
    processing = false
  }
}

async function peekQueueOrigin(): Promise<{ origin?: string; item?: AutomationQueueItem | null }> {
  await restoreSettings()
  await register()
  const item = await fetchQueueItem(false)
  if (!item) return { item: null }
  const inspected = inspectApplicationUrl(item.applicationUrl)
  if (!inspected.ok || !inspected.url) return { item }
  return { origin: originPattern(inspected.url), item }
}

function reply(sendResponse: (value: unknown) => void, value: unknown) {
  sendResponse(value)
}

async function handleMessage(raw: unknown): Promise<unknown> {
  if (
    !isAgentMessage(raw) &&
    !(raw && typeof raw === 'object' && ['PROCESS_QUEUE', 'PEEK_QUEUE'].includes(String((raw as { type?: string }).type)))
  ) {
    return { ok: false }
  }
  const message = raw as AgentMessage | { type: 'PROCESS_QUEUE' | 'PEEK_QUEUE' }
  if (message.type === 'CONNECT_SESSION') {
    settings.userId = message.userId
    if (message.backendOrigin) settings.backendOrigin = message.backendOrigin
    persistSettings()
    await register()
    return { ok: true, userId: settings.userId, connected: true }
  }
  if (message.type === 'START_APPLICATION') {
    const session = startBackgroundSession(message)
    settings.userId = message.userId
    persistSettings()
    await register()
    void processQueue()
    return { ok: true, session }
  }
  if (message.type === 'PEEK_QUEUE') {
    return { ok: true, ...(await peekQueueOrigin()) }
  }
  if (message.type === 'PROCESS_QUEUE') {
    await processQueue()
    return { ok: true, session: getBackgroundSession() }
  }
  if (message.type === 'INSPECT_PAGE') return { ok: true, session: getBackgroundSession() }
  const session = applyBackgroundMessage(message as AgentMessage)
  return { ok: true, session }
}

void restoreSettings().then(() => register())

chrome.runtime.onMessage.addListener((raw, _sender, sendResponse) => {
  void handleMessage(raw).then((value) => reply(sendResponse, value))
  return true
})

chrome.runtime.onMessageExternal.addListener((raw, _sender, sendResponse) => {
  void handleMessage(raw).then((value) => reply(sendResponse, value))
  return true
})

chrome.alarms?.create?.('jobpilot-heartbeat', { periodInMinutes: 0.5 })
chrome.alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name === 'jobpilot-heartbeat') void heartbeat().then(() => processQueue())
})
