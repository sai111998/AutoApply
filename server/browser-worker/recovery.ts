import type { AutoApplyQueueItem } from '../apply/types'

const STUCK = new Set(['opening', 'filling', 'preparing', 'tailoring', 'submitting'])
const SAFE_RESUME = new Set(['opening', 'filling', 'preparing', 'tailoring'])

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
    if (previous === 'submitting') {
      item.applicationStatus = 'needs_confirmation'
      item.failureReason = 'Submission may have occurred before the browser worker restarted. Confirm before retrying.'
      item.updatedAt = new Date(now).toISOString()
      continue
    }
    if (SAFE_RESUME.has(previous)) {
      item.applicationStatus = 'queued'
      item.failureReason = null
      item.updatedAt = new Date(now).toISOString()
      continue
    }
    item.applicationStatus = 'failed'
    item.failureReason = stale
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
  return (
    item.applicationStatus === 'submitted' ||
    item.applicationStatus === 'submitting' ||
    item.applicationStatus === 'needs_confirmation' ||
    item.applicationStatus === 'needs_user_confirmation'
  )
}
