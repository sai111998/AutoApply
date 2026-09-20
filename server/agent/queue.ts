import { persistRun, memoryStore, type AutoApplyStore, type StoredRun } from '../apply/store'
import { recount, syncRunStatus } from '../apply/counts'
import type { ServerConfig } from '../config'
import { notifyBrowserWorker } from '../browser-worker/queue'

export function isProcessableCampaign(status: string): boolean {
  return status === 'running' || status === 'needs_attention'
}

export async function persistCampaignQueue(
  stored: StoredRun,
  options: { store?: AutoApplyStore; config?: ServerConfig } = {},
) {
  stored.run.counts = { ...recount(stored.items), found: stored.run.counts.found }
  stored.run = syncRunStatus(stored.run, stored.items)
  stored.run.updatedAt = new Date().toISOString()
  await persistRun(options.store ?? memoryStore, stored.run, stored.items, options.config)
  return stored
}

export function wakeApplicationWorker() {
  notifyBrowserWorker()
}
