import { getStoredProfile, getStoredResume } from '../extension/profile-store'
import { memoryStore, persistRun, type StoredRun } from '../apply/store'
import type { AutoApplyQueueItem } from '../apply/types'
import { isRetryableBrowserJob } from './recovery'

const CLAIMABLE = new Set(['queued', 'ready', 'extension_not_connected'])

let activeItemId: string | null = null
const waiters = new Map<string, Array<(item: AutoApplyQueueItem) => void>>()
let wake: (() => void) | null = null

export function resetBrowserWorkerQueueForTests() {
  activeItemId = null
  waiters.clear()
  wake = null
}

export function onBrowserWorkerWake(handler: () => void) {
  wake = handler
}

export function notifyBrowserWorker() {
  wake?.()
}

export function waitForBrowserJob(itemId: string, timeoutMs = 40_000): Promise<AutoApplyQueueItem | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      waiters.delete(itemId)
      resolve(null)
    }, timeoutMs)
    const list = waiters.get(itemId) ?? []
    list.push((item) => {
      clearTimeout(timer)
      resolve(item)
    })
    waiters.set(itemId, list)
  })
}

export function completeBrowserJob(item: AutoApplyQueueItem) {
  const list = waiters.get(item.id) ?? []
  waiters.delete(item.id)
  for (const resolve of list) resolve(item)
}

export function getActiveBrowserJobId() {
  return activeItemId
}

export function releaseBrowserJob(itemId?: string | null) {
  if (!itemId || activeItemId === itemId) activeItemId = null
}

async function allRuns(): Promise<StoredRun[]> {
  if (memoryStore.listAll) return memoryStore.listAll()
  return []
}

export async function claimNextBrowserJob(): Promise<{ stored: StoredRun; item: AutoApplyQueueItem } | null> {
  const runs = await allRuns()
  for (const stored of runs) {
    const active = activeItemId ? stored.items.find((item) => item.id === activeItemId) : undefined
    if (active && ['opening', 'filling', 'submitting', 'preparing'].includes(active.applicationStatus)) {
      return { stored, item: active }
    }
  }
  for (const stored of runs) {
    const item = stored.items.find((entry) => CLAIMABLE.has(entry.applicationStatus) || isRetryableBrowserJob(entry))
    if (!item) continue
    item.applicationStatus = 'opening'
    item.failureReason = null
    item.updatedAt = new Date().toISOString()
    stored.run.updatedAt = item.updatedAt
    await persistRun(memoryStore, stored.run, stored.items)
    activeItemId = item.id
    return { stored, item }
  }
  return null
}

export async function persistBrowserJob(stored: StoredRun, item: AutoApplyQueueItem) {
  item.updatedAt = new Date().toISOString()
  stored.run.updatedAt = item.updatedAt
  await persistRun(memoryStore, stored.run, stored.items)
  completeBrowserJob(item)
}

export function profileForJob(userId: string, item: AutoApplyQueueItem) {
  return {
    profile: getStoredProfile(userId),
    resume: getStoredResume(userId, item.applicationId || item.id),
  }
}
