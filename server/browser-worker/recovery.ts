import type { AutoApplyQueueItem } from '../apply/types'

const STUCK = new Set(['opening', 'filling', 'preparing', 'tailoring', 'submitting'])

export function recoverStuckBrowserJobs(
  items: AutoApplyQueueItem[],
  options: { stuckMs: number; now?: number; liveItemIds?: Set<string>; restart?: boolean } = { stuckMs: 40_000 },
): AutoApplyQueueItem[] {
  const now = options.now ?? Date.now()
  const live = options.liveItemIds ?? new Set<string>()
  const restart = options.restart !== false
  for (const item of items) {
    if (live.has(item.id)) continue
    const previous = item.applicationStatus
    if (!STUCK.has(previous)) continue
    const updated = Date.parse(item.updatedAt)
    const stale = !Number.isFinite(updated) || now - updated > options.stuckMs
    if (!restart && !stale) continue
    item.applicationStatus = 'failed'
    item.failureReason =
      previous === 'submitting'
        ? 'Submission could not be confirmed after the browser worker restarted.'
        : stale
          ? 'Application preparation timed out.'
          : 'The browser worker restarted before this application finished.'
    item.updatedAt = new Date(now).toISOString()
  }
  return items
}

export function isRetryableBrowserJob(item: AutoApplyQueueItem): boolean {
  return item.applicationStatus === 'queued' || item.applicationStatus === 'ready' || item.applicationStatus === 'extension_not_connected'
}

export function shouldNeverAutoRetry(item: AutoApplyQueueItem): boolean {
  return item.applicationStatus === 'submitted'
}
