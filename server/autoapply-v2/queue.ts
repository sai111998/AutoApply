import { readRuntimeJson, writeRuntimeJson } from '../automation/runtime-io'
import { V2_TERMINAL_STATUSES, type V2QueueItem, type V2RunStatus } from './types'
import { V2Error } from './errors'

const V2_QUEUE_FILE = 'autoapply-v2-queue.json'

const runs = new Map<string, V2QueueItem>()

function reloadQueue() {
  const parsed = readRuntimeJson<V2QueueItem[]>(V2_QUEUE_FILE)
  if (!parsed) return
  for (const entry of parsed) {
    if (!entry?.runId) continue
    const current = runs.get(entry.runId)
    if (!current || Date.parse(entry.updatedAt) >= Date.parse(current.updatedAt)) {
      runs.set(entry.runId, entry)
    }
  }
}

function flushQueue() {
  writeRuntimeJson(V2_QUEUE_FILE, [...runs.values()])
}

export function resetV2QueueForTests() {
  runs.clear()
}

export function listV2Runs(): V2QueueItem[] {
  reloadQueue()
  return [...runs.values()]
}

export function getV2Run(runId: string): V2QueueItem | null {
  reloadQueue()
  return runs.get(runId) ?? null
}

export function activeV2Run(): V2QueueItem | null {
  reloadQueue()
  return [...runs.values()].find((item) => !V2_TERMINAL_STATUSES.has(item.status)) ?? null
}

export function createV2Run(item: V2QueueItem): V2QueueItem {
  reloadQueue()
  const active = [...runs.values()].find((entry) => !V2_TERMINAL_STATUSES.has(entry.status))
  if (active) {
    throw new V2Error('WORKER_BUSY', 'Another Auto Apply V2 run is already active.', 409)
  }
  runs.set(item.runId, item)
  flushQueue()
  return item
}

export function updateV2Run(
  runId: string,
  patch: Partial<Omit<V2QueueItem, 'runId' | 'createdAt'>>,
): V2QueueItem | null {
  reloadQueue()
  const current = runs.get(runId)
  if (!current) return null
  const next: V2QueueItem = { ...current, ...patch, runId, updatedAt: new Date().toISOString() }
  runs.set(runId, next)
  flushQueue()
  return next
}

export function setV2Status(runId: string, status: V2RunStatus, failureReason: string | null = null) {
  return updateV2Run(runId, { status, failureReason })
}

export function v2QueueDepth(): number {
  reloadQueue()
  return [...runs.values()].filter((item) => !V2_TERMINAL_STATUSES.has(item.status)).length
}
