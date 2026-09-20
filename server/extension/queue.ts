import { inspectApplicationUrl } from '../../extension/src/shared/url'
import { detectApplicationProvider } from '../../extension/src/providers'
import type { AutomationEvent, AutomationQueueItem } from '../../extension/src/shared/queue'
import type { ServerConfig } from '../config'
import { memoryStore, persistRun, loadRunsFromDatabase } from '../apply/store'
import { mergeApplyTimeouts } from '../apply/timeouts'
import type { AutoApplyQueueItem, AutoApplyQueueStatus } from '../apply/types'
import {
  getExtensionConnection,
  isExtensionConnected,
  releaseExtensionItem,
  setActiveExtensionItem,
} from './connection'
import { claimedItemStillActive, failureReasonForStatus, queueStatusFromEvent, sanitizeSubmittedEvent } from './events'

const CLAIMABLE = new Set<AutoApplyQueueStatus>(['queued', 'ready', 'extension_not_connected'])

function nowIso() {
  return new Date().toISOString()
}

function failStuckQueueItems(items: AutoApplyQueueItem[], stuckMs: number, now = Date.now()) {
  for (const item of items) {
    if (!['preparing', 'filling', 'opening', 'tailoring'].includes(item.applicationStatus)) continue
    const updated = Date.parse(item.updatedAt)
    if (Number.isFinite(updated) && now - updated <= stuckMs) continue
    item.applicationStatus = 'failed'
    item.failureReason = 'Application preparation timed out.'
    item.updatedAt = nowIso()
  }
}

async function listUserRuns(userId: string, config?: ServerConfig) {
  const memory = await memoryStore.list(userId)
  if (memory.length) return memory
  return loadRunsFromDatabase(userId, config)
}

function toQueuePayload(item: AutoApplyQueueItem): AutomationQueueItem {
  const inspected = inspectApplicationUrl(item.applicationUrl)
  return {
    runId: item.runId,
    itemId: item.id,
    applicationId: item.applicationId,
    jobId: item.jobId,
    applicationUrl: inspected.url?.toString() ?? item.applicationUrl ?? '',
    company: item.company,
    jobTitle: item.title,
    resumeVersionId: item.resumeVersionId,
    matchScore: item.initialMatchScore,
    tailoredMatchScore: item.finalMatchScore,
    provider: detectApplicationProvider({ url: item.applicationUrl }).id,
    status: item.applicationStatus,
  }
}

export async function peekAutomationQueueItem(
  userId: string,
  config?: ServerConfig,
): Promise<{ item: AutomationQueueItem | null; code?: string; error?: string }> {
  if (!isExtensionConnected(userId)) {
    return {
      item: null,
      code: 'EXTENSION_NOT_CONNECTED',
      error: 'Connect the JobPilot Chrome extension to open applications in your browser.',
    }
  }
  const runs = await listUserRuns(userId, config)
  for (const stored of runs) {
    failStuckQueueItems(stored.items, mergeApplyTimeouts().stuckMs)
    if (stored.items.some((entry) => entry.applicationStatus === 'failed' && entry.failureReason === 'Application preparation timed out.')) {
      stored.run.updatedAt = nowIso()
      await persistRun(memoryStore, stored.run, stored.items, config)
    }
    const activeId = getExtensionConnection(userId)?.activeItemId
    const active = activeId ? stored.items.find((entry) => entry.id === activeId) : undefined
    if (active && claimedItemStillActive(active)) return { item: toQueuePayload(active) }
    const item = stored.items.find((entry) => CLAIMABLE.has(entry.applicationStatus))
    if (!item) continue
    const inspected = inspectApplicationUrl(item.applicationUrl)
    if (!inspected.ok) continue
    return { item: toQueuePayload(item) }
  }
  return { item: null }
}

export async function nextAutomationQueueItem(
  userId: string,
  config?: ServerConfig,
): Promise<{ item: AutomationQueueItem | null; code?: string; error?: string }> {
  if (!isExtensionConnected(userId)) {
    return {
      item: null,
      code: 'EXTENSION_NOT_CONNECTED',
      error: 'Connect the JobPilot Chrome extension to open applications in your browser.',
    }
  }
  const connection = getExtensionConnection(userId)
  const runs = await listUserRuns(userId, config)
  for (const stored of runs) {
    failStuckQueueItems(stored.items, mergeApplyTimeouts().stuckMs)
    if (stored.items.some((entry) => entry.applicationStatus === 'failed' && entry.failureReason === 'Application preparation timed out.')) {
      stored.run.updatedAt = nowIso()
      await persistRun(memoryStore, stored.run, stored.items, config)
    }
    const active = connection?.activeItemId
      ? stored.items.find((entry) => entry.id === connection.activeItemId)
      : undefined
    if (active && claimedItemStillActive(active)) {
      return { item: toQueuePayload(active) }
    }
    if (active && !claimedItemStillActive(active)) {
      releaseExtensionItem(userId, active.id)
    }
  }
  for (const stored of runs) {
    const item = stored.items.find((entry) => CLAIMABLE.has(entry.applicationStatus))
    if (!item) continue
    const inspected = inspectApplicationUrl(item.applicationUrl)
    if (!inspected.ok || !inspected.url) {
      item.applicationStatus = 'failed'
      item.failureReason = inspected.reason
      item.updatedAt = nowIso()
      await persistRun(memoryStore, stored.run, stored.items, config)
      continue
    }
    item.applicationStatus = 'opening'
    item.failureReason = null
    item.updatedAt = nowIso()
    stored.run.updatedAt = nowIso()
    await persistRun(memoryStore, stored.run, stored.items, config)
    setActiveExtensionItem(userId, item.id)
    return { item: toQueuePayload(item) }
  }
  return { item: null }
}

export async function applyAutomationEvent(
  userId: string,
  event: AutomationEvent,
  extras: { html?: string; title?: string } = {},
  config?: ServerConfig,
): Promise<AutoApplyQueueItem | null> {
  const safe = sanitizeSubmittedEvent(event, extras.html, extras.title)
  const runs = await listUserRuns(userId, config)
  for (const stored of runs) {
    const item = stored.items.find(
      (entry) => entry.id === safe.itemId || (safe.applicationId && entry.applicationId === safe.applicationId),
    )
    if (!item) continue
    const status = queueStatusFromEvent(safe)
    item.applicationStatus = status
    item.failureReason = failureReasonForStatus(status, safe.reason)
    if (safe.questions?.length) {
      item.questions = safe.questions.map((question) => ({
        id: question.id,
        prompt: question.prompt,
        answer: question.answer,
        source: 'user',
      }))
    }
    item.updatedAt = nowIso()
    stored.run.updatedAt = nowIso()
    if (claimedItemStillActive(item)) {
      setActiveExtensionItem(userId, item.id)
    } else {
      releaseExtensionItem(userId, item.id)
    }
    await persistRun(memoryStore, stored.run, stored.items, config)
    return item
  }
  return null
}

export { listUserRuns }
