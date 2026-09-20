import { isAgentMessage } from '../shared/messages'
import { applyBackgroundMessage, getBackgroundSession, startBackgroundSession } from './session-store'
import { inspectApplicationUrl, originPattern } from '../shared/url'
import { backendOriginsFor, isJobPilotAppUrl } from '../shared/page-session'
import { nextAgentAction } from '../agent/orchestrate'
import { AGENT_TIMEOUTS } from '../agent/timeouts'
import { extensionLog } from '../shared/extension-log'
import {
  bindEmployerTab,
  createEmployerTabSession,
  inspectionTarget,
  jobpilotInternalInspection,
  markEmployerSessionStatus,
  planEmployerTabOpen,
  recordEmployerNavigation,
  shouldRunApplicationDetector,
  statusAfterDetection,
  type EmployerPageInspection,
  type EmployerTabSession,
} from '../shared/tab-session'
import type { AgentMessage } from '../shared/messages'
import type { ApplicationDetection } from '../shared/types'
import type { AutomationQueueItem, AuthorizedResume } from '../shared/queue'

const settings = {
  backendOrigin: 'http://127.0.0.1:8787',
  userId: null as string | null,
  lastError: null as string | null,
}
let processing = false
let activeTabId: number | null = null
let activeItemId: string | null = null
let employerSession: EmployerTabSession | null = null
let lastInspection: EmployerPageInspection | null = null

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

async function register(): Promise<boolean> {
  if (!settings.userId) {
    settings.lastError = 'No JobPilot user is available on this tab.'
    return false
  }
  for (const origin of backendOriginsFor(settings.backendOrigin)) {
    try {
      const response = await fetch(`${origin.replace(/\/$/, '')}/api/automation/extension/register`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ userId: settings.userId, extensionId: chrome.runtime.id }),
      })
      if (!response.ok) continue
      settings.backendOrigin = origin
      settings.lastError = null
      persistSettings()
      return true
    } catch {
      // Try the next local API origin.
    }
  }
  settings.lastError = 'The extension could not reach the JobPilot API. Keep npm run dev running and reload the extension.'
  return false
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

function readTabUrl(tabId: number): Promise<string | null> {
  return new Promise((resolve) => {
    if (!chrome.tabs?.get) {
      resolve(null)
      return
    }
    chrome.tabs.get(tabId, (tab) => {
      resolve(tab?.url || null)
    })
  })
}

function openTab(url: string): Promise<{ tabId: number; url: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('NAVIGATION_TIMEOUT')), AGENT_TIMEOUTS.tabOpenMs)
    chrome.tabs?.create?.({ url, active: true }, (tab) => {
      if (!tab?.id) {
        clearTimeout(timer)
        reject(new Error('NAVIGATION_TIMEOUT'))
        return
      }
      const tabId = tab.id
      let currentUrl = tab.url || url
      const finish = (finalUrl = currentUrl) => {
        clearTimeout(timer)
        resolve({ tabId, url: finalUrl })
      }
      if (!chrome.tabs?.onUpdated?.addListener) {
        finish()
        return
      }
      const onUpdated = (updatedId: number, info: { status?: string; url?: string }) => {
        if (updatedId !== tabId) return
        if (info.url) {
          currentUrl = info.url
          if (employerSession?.tabId === tabId) {
            employerSession = recordEmployerNavigation(employerSession, info.url)
            extensionLog('[Extension] Navigated to:', { url: info.url })
          }
        }
        if (info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(onUpdated)
          finish(currentUrl)
        }
      }
      chrome.tabs.onUpdated.addListener(onUpdated)
      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(onUpdated)
        finish(currentUrl)
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

function rememberInspection(page: Record<string, unknown>, fallbackUrl: string) {
  const detection = page.detection as ApplicationDetection | undefined
  if (!detection) return null
  lastInspection = {
    url: String(page.url ?? fallbackUrl),
    title: String(page.title ?? ''),
    hostname: String(page.hostname ?? ''),
    pageKind: typeof page.pageKind === 'string' ? page.pageKind : null,
    detection,
    visible: page.visible as EmployerPageInspection['visible'],
  }
  return lastInspection
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
  extensionLog('[Extension] Received application')
  extensionLog('[Extension] Application ID:', { applicationId: item.applicationId, jobId: item.jobId })
  extensionLog('[Extension] Application URL:', {
    applicationUrl: item.applicationUrl,
    company: item.company,
    jobTitle: item.jobTitle,
  })
  if (!(employerSession?.itemId === item.itemId && employerSession.tabId != null)) {
    employerSession = createEmployerTabSession({
      applicationId: item.applicationId,
      itemId: item.itemId,
      jobId: item.jobId,
      applicationUrl: item.applicationUrl,
      company: item.company,
      jobTitle: item.jobTitle,
      resumeVersionId: item.resumeVersionId,
      provider: item.provider,
    })
  }
  const reuseUrl = reuseTabId ? await readTabUrl(reuseTabId) : employerSession.currentUrl
  const plan = planEmployerTabOpen({
    applicationUrl: item.applicationUrl,
    reuseTabId,
    reuseTabUrl: reuseUrl,
    session: employerSession,
    itemId: item.itemId,
  })
  if (plan.action === 'reject') {
    employerSession = markEmployerSessionStatus(employerSession, 'failed')
    await postEvent(item, 'failed', { reason: plan.reason, code: 'APPLICATION_URL_INVALID' })
    return
  }
  const origin = originPattern(new URL(plan.url))
  let tabId: number
  let currentUrl = plan.url
  if (plan.action === 'reuse') {
    tabId = plan.tabId
    currentUrl = plan.url
  } else {
    await postEvent(item, 'opening', { currentUrl: plan.url })
    employerSession = markEmployerSessionStatus(employerSession, 'opening', { currentUrl: plan.url })
    extensionLog('[Extension] Creating employer tab', { applicationUrl: plan.url })
    try {
      const opened = await openTab(plan.url)
      tabId = opened.tabId
      currentUrl = opened.url
    } catch (error) {
      employerSession = markEmployerSessionStatus(employerSession, 'failed')
      await postEvent(item, 'failed', {
        reason: 'The employer application tab could not be opened.',
        code: error instanceof Error && error.message === 'NAVIGATION_TIMEOUT' ? 'NAVIGATION_TIMEOUT' : 'APPLICATION_TIMEOUT',
      })
      return
    }
    extensionLog('[Extension] Created tab ID:', { tabId, url: currentUrl })
    employerSession = bindEmployerTab(recordEmployerNavigation(employerSession, currentUrl), tabId)
    activeTabId = tabId
    activeItemId = item.itemId
    await postEvent(item, 'employer_page_opened', { currentUrl })
    employerSession = markEmployerSessionStatus(employerSession, 'employer_page_opened', { currentUrl })
  }
  employerSession = bindEmployerTab(recordEmployerNavigation(employerSession, currentUrl), tabId)
  activeTabId = tabId
  activeItemId = item.itemId
  const granted = (await hasOrigin(origin)) || (await requestOrigin(origin))
  if (!granted) {
    return
  }
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
  let postedApplicationDetected = false
  let postedProviderDetected = false
  while (Date.now() < deadline) {
    const liveUrl = (await readTabUrl(tabId)) || currentUrl
    if (liveUrl && liveUrl !== currentUrl) {
      currentUrl = liveUrl
      employerSession = recordEmployerNavigation(employerSession, liveUrl)
      extensionLog('[Extension] Navigated to:', { url: liveUrl })
      await inject(tabId)
    }
    if (isJobPilotAppUrl(currentUrl)) {
      lastInspection = jobpilotInternalInspection(currentUrl)
      await inject(tabId)
      await new Promise((resolve) => setTimeout(resolve, 400))
      continue
    }
    extensionLog('[Extension] Running application detector', { tabId, url: currentUrl })
    const inspectedPage = await sendTab(tabId, { type: 'INSPECT_PAGE' })
    const detection = inspectedPage.detection as ApplicationDetection | undefined
    const html = String(inspectedPage.html ?? '')
    const url = String(inspectedPage.url ?? currentUrl)
    if (inspectedPage.pageKind === 'JOBPILOT_INTERNAL_PAGE' || isJobPilotAppUrl(url)) {
      lastInspection = jobpilotInternalInspection(url)
      await new Promise((resolve) => setTimeout(resolve, 400))
      continue
    }
    if (!detection) {
      await inject(tabId)
      await new Promise((resolve) => setTimeout(resolve, 400))
      continue
    }
    rememberInspection(inspectedPage, url)
    currentUrl = url
    employerSession = recordEmployerNavigation(employerSession, url)
    extensionLog('[Extension] Provider:', { provider: detection.provider })
    extensionLog('[Extension] Application confidence:', { confidence: detection.confidence })
    extensionLog('[Extension] Application page:', { applicationPage: detection.isApplicationPage })
    const nextStatus = statusAfterDetection(detection)
    employerSession = markEmployerSessionStatus(employerSession, nextStatus, { provider: detection.provider, currentUrl: url })
    if (!postedApplicationDetected) {
      await postEvent(item, 'application_detected', { currentUrl: url, provider: detection.provider })
      postedApplicationDetected = true
    }
    if (!postedProviderDetected && detection.provider && detection.provider !== 'unknown') {
      await postEvent(item, 'provider_detected', { currentUrl: url, provider: detection.provider })
      postedProviderDetected = true
    }
    const visible = inspectedPage.visible as { apply?: boolean; next?: boolean; submit?: boolean } | undefined
    const action = nextAgentAction(detection, html)
    if (action.type === 'pause') {
      employerSession = markEmployerSessionStatus(employerSession, action.status, { currentUrl: url })
      await postEvent(item, action.status, {
        currentUrl: url,
        questions: (action.questions ?? []).map((prompt, index) => ({ id: `unknown-${index + 1}`, prompt, answer: null })),
      })
      const resumed = await waitForPauseClear(tabId, action.status)
      if (!resumed) {
        if (action.status === 'needs_user_input') return
        employerSession = markEmployerSessionStatus(employerSession, 'failed')
        await postEvent(item, 'failed', { reason: 'Application preparation timed out.', code: 'APPLICATION_TIMEOUT' })
      }
      continue
    }
    if (action.type === 'fail' && !visible?.apply && !visible?.next && !visible?.submit) {
      employerSession = markEmployerSessionStatus(employerSession, 'failed')
      await postEvent(item, 'failed', { currentUrl: url, reason: action.reason, code: action.code })
      return
    }
    if (visible?.submit && !visible.next && !visible.apply) {
      employerSession = markEmployerSessionStatus(employerSession, 'ready_for_review', { currentUrl: url, provider: detection.provider })
      await postEvent(item, 'ready_for_review', { currentUrl: url, provider: detection.provider })
      return
    }
    const click = visible?.apply && !detection.isApplicationPage ? 'apply' : visible?.next ? 'next' : null
    if (!click && detection.isApplicationPage) {
      employerSession = markEmployerSessionStatus(employerSession, 'ready_for_review', { currentUrl: url, provider: detection.provider })
      await postEvent(item, 'ready_for_review', { currentUrl: url, provider: detection.provider })
      return
    }
    employerSession = markEmployerSessionStatus(employerSession, 'filling', { currentUrl: url, provider: detection.provider })
    await postEvent(item, 'filling', { currentUrl: url, provider: detection.provider })
    const stepped = await sendTab(tabId, {
      type: 'RUN_AGENT_STEP',
      values,
      resume: resumeBody.available ? resumeBody.resume : null,
      click,
    })
    if (click === 'next' && stepped.uploaded === false && resumeBody.available && html.includes('type="file"')) {
      employerSession = markEmployerSessionStatus(employerSession, 'failed')
      await postEvent(item, 'failed', { currentUrl: url, reason: 'The selected resume could not be uploaded to the employer form.', code: 'RESUME_UPLOAD_FAILED' })
      return
    }
    const steppedUrl = String(stepped.url ?? url)
    if (steppedUrl && steppedUrl !== url) {
      employerSession = recordEmployerNavigation(employerSession, steppedUrl)
      extensionLog('[Extension] Navigated to:', { url: steppedUrl })
    }
    rememberInspection(stepped, steppedUrl)
    advanced += 1
    if (advanced > 8) {
      employerSession = markEmployerSessionStatus(employerSession, 'ready_for_review', { currentUrl: steppedUrl })
      await postEvent(item, 'ready_for_review', { currentUrl: steppedUrl })
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 700))
  }
  employerSession = markEmployerSessionStatus(employerSession, 'failed')
  await postEvent(item, 'failed', { reason: 'Application preparation timed out.', code: 'APPLICATION_TIMEOUT' })
}

async function processQueue(): Promise<{
  ok: boolean
  item?: AutomationQueueItem | null
  error?: string
  tabId?: number | null
  inspection?: EmployerPageInspection | null
  employerSession?: EmployerTabSession | null
}> {
  if (!settings.userId) return { ok: false, error: settings.lastError || 'No JobPilot user is connected.' }
  if (processing) {
    return { ok: true, tabId: activeTabId, inspection: lastInspection, employerSession }
  }
  processing = true
  try {
    const connected = await register()
    if (!connected) return { ok: false, error: settings.lastError || 'The JobPilot extension is not connected.' }
    const item = await fetchQueueItem(true)
    if (!item) return { ok: true, item: null, error: 'No queued application is waiting.', inspection: lastInspection, employerSession }
    const reuse = activeItemId === item.itemId ? activeTabId : null
    await processItem(item, reuse)
    return { ok: true, item, tabId: activeTabId, inspection: lastInspection, employerSession }
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

function canInspectSender(sender?: { tab?: { id?: number }; url?: string }) {
  const tabId = sender?.tab?.id ?? null
  const pageUrl = sender?.url ?? employerSession?.currentUrl ?? null
  return shouldRunApplicationDetector({
    pageUrl,
    tabId,
    sessionTabId: employerSession?.tabId ?? null,
    workflowStarted: Boolean(employerSession?.tabId),
  })
}

function sessionPayload() {
  return {
    session: getBackgroundSession(),
    employerSession,
    inspection: lastInspection,
    tabId: activeTabId,
    userId: settings.userId,
    connected: Boolean(settings.userId) && !settings.lastError,
    target: inspectionTarget({ session: employerSession }),
  }
}

async function handleMessage(raw: unknown, sender?: { tab?: { id?: number }; url?: string }): Promise<unknown> {
  const type = raw && typeof raw === 'object' ? String((raw as { type?: string }).type || '') : ''
  if (type === 'CAN_INSPECT_TAB') {
    return { ok: true, ...canInspectSender(sender) }
  }
  if (type === 'GET_EMPLOYER_SESSION') {
    return { ok: true, ...sessionPayload() }
  }
  if (
    !isAgentMessage(raw) &&
    !(raw && typeof raw === 'object' && ['PROCESS_QUEUE', 'PEEK_QUEUE', 'EXTENSION_STATUS', 'CAN_INSPECT_TAB', 'GET_EMPLOYER_SESSION'].includes(type))
  ) {
    return { ok: false }
  }
  const message = raw as AgentMessage | { type: 'PROCESS_QUEUE' | 'PEEK_QUEUE' | 'EXTENSION_STATUS' }
  if (message.type === 'CONNECT_SESSION') {
    settings.userId = message.userId
    if (message.backendOrigin) settings.backendOrigin = message.backendOrigin
    persistSettings()
    const connected = await register()
    return {
      ok: connected,
      userId: settings.userId,
      connected,
      error: settings.lastError,
      backendOrigin: settings.backendOrigin,
    }
  }
  if (message.type === 'START_APPLICATION') {
    const session = startBackgroundSession(message)
    settings.userId = message.userId
    persistSettings()
    await register()
    void processQueue()
    return { ok: true, session, ...sessionPayload() }
  }
  if (message.type === 'PEEK_QUEUE') {
    return { ok: true, ...(await peekQueueOrigin()) }
  }
  if (message.type === 'PROCESS_QUEUE') {
    const result = await processQueue()
    return {
      ...result,
      ...sessionPayload(),
      connected: Boolean(settings.userId) && !settings.lastError,
    }
  }
  if (message.type === 'EXTENSION_STATUS') {
    return {
      ok: true,
      ...sessionPayload(),
      backendOrigin: settings.backendOrigin,
      error: settings.lastError,
    }
  }
  if (message.type === 'INSPECT_PAGE') return { ok: true, ...sessionPayload() }
  const session = applyBackgroundMessage(message as AgentMessage)
  return { ok: true, session, ...sessionPayload() }
}

void restoreSettings().then(() => register())

chrome.runtime.onMessage.addListener((raw, sender, sendResponse) => {
  void handleMessage(raw, sender).then((value) => reply(sendResponse, value))
  return true
})

chrome.runtime.onMessageExternal.addListener((raw, sender, sendResponse) => {
  void handleMessage(raw, sender).then((value) => reply(sendResponse, value))
  return true
})

chrome.tabs?.onUpdated?.addListener?.((tabId, info) => {
  if (!employerSession || employerSession.tabId !== tabId) return
  if (info.url) {
    employerSession = recordEmployerNavigation(employerSession, info.url)
    extensionLog('[Extension] Navigated to:', { url: info.url })
  }
})

chrome.alarms?.create?.('jobpilot-heartbeat', { periodInMinutes: 0.5 })
chrome.alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name === 'jobpilot-heartbeat') void heartbeat().then(() => processQueue())
})
