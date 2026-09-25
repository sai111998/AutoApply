import { randomUUID } from 'node:crypto'
import type { ApplicationProviderId } from '../apply/providers/types'
import type { BrowserApplicationSession, BrowserSessionState } from './types'

const sessions = new Map<string, BrowserApplicationSession>()

function nowIso() {
  return new Date().toISOString()
}

export function resetBrowserSessionsForTests() {
  sessions.clear()
}

export function createBrowserApplicationSession(input: {
  applicationId?: string | null
  itemId: string
  runId: string
  jobId: string
  resumeVersionId?: string | null
  browserContextId: string
  applicationUrl: string
  provider?: ApplicationProviderId | 'unknown'
}): BrowserApplicationSession {
  const createdAt = nowIso()
  const session: BrowserApplicationSession = {
    applicationId: input.applicationId ?? null,
    itemId: input.itemId,
    runId: input.runId,
    jobId: input.jobId,
    resumeVersionId: input.resumeVersionId ?? null,
    browserContextId: input.browserContextId,
    pageId: null,
    provider: input.provider ?? 'unknown',
    initialUrl: input.applicationUrl,
    currentUrl: input.applicationUrl,
    redirectUrls: [input.applicationUrl],
    state: 'opening',
    failureReason: null,
    createdAt,
    updatedAt: createdAt,
  }
  sessions.set(input.itemId, session)
  return session
}

export function getBrowserApplicationSession(itemId: string): BrowserApplicationSession | null {
  return sessions.get(itemId) ?? null
}

export function listBrowserApplicationSessions(): BrowserApplicationSession[] {
  return [...sessions.values()]
}

export function bindBrowserPage(session: BrowserApplicationSession, pageId: string): BrowserApplicationSession {
  return updateBrowserApplicationSession(session.itemId, { pageId })
}

export function recordBrowserRedirect(session: BrowserApplicationSession, url: string): BrowserApplicationSession {
  const currentUrl = url.trim()
  if (!currentUrl || currentUrl === session.currentUrl) return session
  const redirectUrls = session.redirectUrls.includes(currentUrl) ? session.redirectUrls : [...session.redirectUrls, currentUrl]
  return updateBrowserApplicationSession(session.itemId, { currentUrl, redirectUrls })
}

export function updateBrowserApplicationSession(
  itemId: string,
  patch: Partial<Pick<BrowserApplicationSession, 'pageId' | 'provider' | 'currentUrl' | 'redirectUrls' | 'state' | 'failureReason'>>,
): BrowserApplicationSession {
  const current = sessions.get(itemId)
  if (!current) {
    throw new Error(`No browser session exists for ${itemId}`)
  }
  const next: BrowserApplicationSession = {
    ...current,
    ...patch,
    updatedAt: nowIso(),
  }
  sessions.set(itemId, next)
  return next
}

export function markBrowserSessionState(
  itemId: string,
  state: BrowserSessionState,
  extras: { provider?: ApplicationProviderId | 'unknown'; currentUrl?: string; failureReason?: string | null } = {},
): BrowserApplicationSession {
  return updateBrowserApplicationSession(itemId, {
    state,
    provider: extras.provider,
    currentUrl: extras.currentUrl,
    failureReason: extras.failureReason === undefined ? undefined : extras.failureReason,
  })
}

export function newPageId(): string {
  return `page-${randomUUID()}`
}
