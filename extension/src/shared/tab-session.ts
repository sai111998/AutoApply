import type { ApplicationDetection, ExtensionProviderId } from './types'
import { isJobPilotAppUrl } from './page-session'
import { inspectApplicationUrl } from './url'

export const JOBPILOT_INTERNAL_PAGE = 'JOBPILOT_INTERNAL_PAGE'

export type EmployerTabSessionStatus =
  | 'queued'
  | 'opening'
  | 'employer_page_opened'
  | 'application_detected'
  | 'provider_detected'
  | 'filling'
  | 'ready_for_review'
  | 'submitting'
  | 'submitted'
  | 'failed'
  | 'captcha_required'
  | 'login_required'
  | 'mfa_required'
  | 'needs_user_input'

export interface EmployerTabSession {
  applicationId: string | null
  itemId: string
  jobId: string
  tabId: number | null
  initialUrl: string
  currentUrl: string
  provider: string
  status: EmployerTabSessionStatus
  company: string
  jobTitle: string
  resumeVersionId: string | null
  urlHistory: string[]
}

export interface EmployerPageInspection {
  url: string
  title: string
  hostname: string
  pageKind: string | null
  detection: ApplicationDetection
  visible?: { apply?: boolean; next?: boolean; submit?: boolean }
}

export function emptyApplicationDetection(overrides: Partial<ApplicationDetection> = {}): ApplicationDetection {
  return {
    isApplicationPage: false,
    isJobDetailsPage: false,
    confidence: 0,
    signals: [],
    provider: 'unknown',
    fields: [],
    buttons: [],
    challenges: { captcha: false, mfa: false, login: false },
    applyActions: [],
    ...overrides,
  }
}

export function jobpilotInternalInspection(url: string): EmployerPageInspection {
  return {
    url,
    title: 'JobPilot',
    hostname: safeHostname(url),
    pageKind: JOBPILOT_INTERNAL_PAGE,
    detection: emptyApplicationDetection({ signals: [JOBPILOT_INTERNAL_PAGE] }),
    visible: { apply: false, next: false, submit: false },
  }
}

export function createEmployerTabSession(input: {
  applicationId?: string | null
  itemId: string
  jobId: string
  applicationUrl: string
  company?: string
  jobTitle?: string
  resumeVersionId?: string | null
  provider?: string
}): EmployerTabSession {
  return {
    applicationId: input.applicationId ?? null,
    itemId: input.itemId,
    jobId: input.jobId,
    tabId: null,
    initialUrl: input.applicationUrl,
    currentUrl: input.applicationUrl,
    provider: input.provider ?? 'unknown',
    status: 'opening',
    company: input.company ?? '',
    jobTitle: input.jobTitle ?? '',
    resumeVersionId: input.resumeVersionId ?? null,
    urlHistory: [input.applicationUrl],
  }
}

export function bindEmployerTab(session: EmployerTabSession, tabId: number): EmployerTabSession {
  return { ...session, tabId, status: session.status === 'opening' ? 'opening' : session.status }
}

export function recordEmployerNavigation(session: EmployerTabSession, url: string): EmployerTabSession {
  const currentUrl = url.trim()
  if (!currentUrl || currentUrl === session.currentUrl) return session
  return {
    ...session,
    currentUrl,
    urlHistory: session.urlHistory.includes(currentUrl) ? session.urlHistory : [...session.urlHistory, currentUrl],
  }
}

export function markEmployerSessionStatus(
  session: EmployerTabSession,
  status: EmployerTabSessionStatus,
  extras: { provider?: string; currentUrl?: string } = {},
): EmployerTabSession {
  const next = extras.currentUrl ? recordEmployerNavigation(session, extras.currentUrl) : session
  return {
    ...next,
    status,
    provider: extras.provider ?? next.provider,
  }
}

export function shouldIgnoreJobPilotPage(url?: string | null): boolean {
  return isJobPilotAppUrl(url)
}

export function shouldRunApplicationDetector(input: {
  pageUrl?: string | null
  tabId?: number | null
  sessionTabId?: number | null
  workflowStarted?: boolean
}): { run: boolean; reason: string | null } {
  if (shouldIgnoreJobPilotPage(input.pageUrl)) {
    return { run: false, reason: JOBPILOT_INTERNAL_PAGE }
  }
  if (!input.workflowStarted) return { run: false, reason: 'NO_ACTIVE_SESSION' }
  if (input.tabId == null || input.sessionTabId == null || input.tabId !== input.sessionTabId) {
    return { run: false, reason: 'TAB_NOT_IN_SESSION' }
  }
  return { run: true, reason: null }
}

export function planEmployerTabOpen(input: {
  applicationUrl: string
  reuseTabId?: number | null
  reuseTabUrl?: string | null
  session?: EmployerTabSession | null
  itemId: string
}): { action: 'create'; url: string } | { action: 'reuse'; tabId: number; url: string } | { action: 'reject'; reason: string } {
  const inspected = inspectApplicationUrl(input.applicationUrl)
  if (!inspected.ok || !inspected.url) {
    return { action: 'reject', reason: inspected.reason || 'This listing does not include a valid application URL.' }
  }
  const url = inspected.url.toString()
  const reuseId = input.reuseTabId ?? null
  const sameItem = !input.session || input.session.itemId === input.itemId
  const reuseUrl = input.reuseTabUrl || input.session?.currentUrl || ''
  if (
    reuseId != null &&
    sameItem &&
    !shouldIgnoreJobPilotPage(reuseUrl) &&
    inspectApplicationUrl(reuseUrl).ok
  ) {
    return { action: 'reuse', tabId: reuseId, url: reuseUrl }
  }
  return { action: 'create', url }
}

export function inspectionTarget(input: {
  activeTab?: { id?: number; url?: string | null } | null
  session?: EmployerTabSession | null
}): { kind: 'jobpilot' | 'employer' | 'none'; tabId?: number; url?: string } {
  const session = input.session
  if (session?.tabId != null && inspectApplicationUrl(session.currentUrl).ok && !shouldIgnoreJobPilotPage(session.currentUrl)) {
    return { kind: 'employer', tabId: session.tabId, url: session.currentUrl }
  }
  if (shouldIgnoreJobPilotPage(input.activeTab?.url)) {
    return { kind: 'jobpilot', tabId: input.activeTab?.id, url: input.activeTab?.url ?? undefined }
  }
  return { kind: 'none' }
}

export function detectionFromEmployerPage(input: {
  url: string
  title?: string
  hostname?: string
  detection: ApplicationDetection
  pageKind?: string | null
}): EmployerPageInspection {
  return {
    url: input.url,
    title: input.title || '',
    hostname: input.hostname || safeHostname(input.url),
    pageKind: input.pageKind ?? null,
    detection: input.detection,
  }
}

export function statusAfterDetection(detection: ApplicationDetection): EmployerTabSessionStatus {
  if (detection.challenges.captcha) return 'captcha_required'
  if (detection.challenges.mfa) return 'mfa_required'
  if (detection.challenges.login) return 'login_required'
  if (detection.isApplicationPage) {
    return detection.provider && detection.provider !== 'unknown' ? 'provider_detected' : 'application_detected'
  }
  return 'employer_page_opened'
}

export function providerIdFromDetection(detection: ApplicationDetection): ExtensionProviderId {
  return detection.provider
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}
