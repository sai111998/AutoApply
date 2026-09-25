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
      item.applicationStatus =
        item.discoverySource === 'smoke-test' || item.applicationSource === 'smoke-test'
          ? 'submission_uncertain'
          : 'needs_confirmation'
      item.failureReason = 'Submission may have occurred before the browser worker restarted. Confirm before retrying.'
      item.updatedAt = new Date(now).toISOString()
      continue
    }
    if (item.discoverySource === 'smoke-test' || item.applicationSource === 'smoke-test') {
      item.applicationStatus = 'submission_failed'
      item.failureReason = 'Smoke test does not retry after a failed or interrupted attempt.'
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
  if (item.discoverySource === 'smoke-test' || item.applicationSource === 'smoke-test') {
    return item.applicationStatus === 'queued'
  }
  return item.applicationStatus === 'queued' || item.applicationStatus === 'ready' || item.applicationStatus === 'extension_not_connected'
}

export function shouldNeverAutoRetry(item: AutoApplyQueueItem): boolean {
  return (
    item.applicationStatus === 'submitted' ||
    item.applicationStatus === 'submitting' ||
    item.applicationStatus === 'needs_confirmation' ||
    item.applicationStatus === 'needs_user_confirmation' ||
    item.applicationStatus === 'submission_uncertain' ||
    item.applicationStatus === 'submission_failed' ||
    item.applicationStatus === 'captcha_required' ||
    item.applicationStatus === 'login_required' ||
    item.applicationStatus === 'mfa_required' ||
    item.applicationStatus === 'needs_user_input' ||
    ((item.discoverySource === 'smoke-test' || item.applicationSource === 'smoke-test') &&
      item.applicationStatus !== 'queued')
  )
}
