import { persistCampaignQueue, wakeApplicationWorker } from './queue'
import { AgentError } from './errors'
import { persistExecutionState } from './state'
import { memoryStore } from '../apply/store'
import type { AutoApplyQueueItem } from '../apply/types'

export function isIsolatedRealEmployerUrl(url: string | null | undefined): boolean {
  if (!url?.trim()) return false
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.toLowerCase()
    if (host === '127.0.0.1' || host === 'localhost' || host === 'jobs.example.com') return false
    return /myworkdayjobs|greenhouse|lever\.co|ashbyhq|icims|oraclecloud|smartrecruiters|workable|jpmorgan|usbank|ford\.|cisco/i.test(
      `${host}${parsed.pathname}`,
    )
  } catch {
    return true
  }
}

export function isSyntheticExecutionUrl(url: string | null | undefined): boolean {
  if (!url?.trim()) return false
  try {
    const parsed = new URL(url)
    const local = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost'
    return local && /\/test-employer\/job\//.test(parsed.pathname)
  } catch {
    return false
  }
}

export function isolateRealEmployerItem(item: AutoApplyQueueItem): AutoApplyQueueItem {
  item.applicationStatus = 'skipped'
  item.failureReason = 'Real employer execution is isolated until the synthetic Auto Apply engine is proven.'
  item.updatedAt = new Date().toISOString()
  persistExecutionState(item.id, 'failed', item.failureReason)
  return item
}

export function assertWorkerAvailable(running: boolean) {
  if (!running) {
    throw new AgentError('WORKER_UNAVAILABLE', 'The browser worker is not running.')
  }
}

export async function dispatchQueuedApplication(itemId: string) {
  const runs = memoryStore.listAll ? await memoryStore.listAll() : []
  for (const stored of runs) {
    const item = stored.items.find((entry) => entry.id === itemId)
    if (!item) continue
    if (isIsolatedRealEmployerUrl(item.applicationUrl)) {
      isolateRealEmployerItem(item)
      await persistCampaignQueue(stored)
      return item
    }
    wakeApplicationWorker()
    return item
  }
  throw new AgentError('CAMPAIGN_NOT_FOUND', 'Queued application was not found.')
}

export { wakeApplicationWorker }
