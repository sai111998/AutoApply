import type { AutoApplyCounts, AutoApplyQueueItem, AutoApplyRun } from './types'

const FAILED_STATUSES = new Set(['failed', 'blocked', 'automation_blocked', 'extension_not_connected'])
const BLOCKED_STATUSES = new Set(['captcha_required', 'mfa_required', 'login_required', 'blocked', 'automation_blocked'])
const PROCESSED_STATUSES = new Set([
  'opening',
  'filling',
  'preparing',
  'tailoring',
  'submitting',
  'ready_for_submission',
  'needs_user_input',
  'needs_user_confirmation',
  'needs_confirmation',
  'captcha_required',
  'mfa_required',
  'login_required',
  'submitted',
  'failed',
  'blocked',
  'automation_blocked',
  'skipped',
])
const TERMINAL_STATUSES = new Set([
  'submitted',
  'skipped',
  'cancelled',
  'failed',
  'blocked',
  'automation_blocked',
])
const ATTENTION_STATUSES = new Set([
  'needs_user_input',
  'needs_user_confirmation',
  'needs_confirmation',
  'captcha_required',
  'mfa_required',
  'login_required',
])
const ACTIVE_STATUSES = new Set([
  'queued',
  'ready',
  'preparing',
  'tailoring',
  'opening',
  'filling',
  'submitting',
  'ready_for_submission',
])

export function emptyCounts(): AutoApplyCounts {
  return {
    found: 0,
    eligible: 0,
    autoApplyCapable: 0,
    tailored: 0,
    ready: 0,
    needsInput: 0,
    submitted: 0,
    skipped: 0,
    failed: 0,
    queued: 0,
    processing: 0,
    processed: 0,
    blocked: 0,
    captcha: 0,
  }
}

export function recount(items: AutoApplyQueueItem[]): AutoApplyCounts {
  const counts = emptyCounts()
  counts.found = items.length
  for (const item of items) {
    if (!FAILED_STATUSES.has(item.applicationStatus) && item.applicationStatus !== 'skipped' && item.applicationStatus !== 'cancelled') {
      counts.eligible += 1
    }
    if (item.resumeVersionName.toLowerCase().includes('tailored')) counts.tailored += 1
    if (item.applicationStatus === 'queued') counts.queued += 1
    if (item.applicationStatus === 'ready' || item.applicationStatus === 'ready_for_submission') counts.ready += 1
    if (['opening', 'filling', 'preparing', 'tailoring', 'submitting'].includes(item.applicationStatus)) {
      counts.processing += 1
    }
    if (ATTENTION_STATUSES.has(item.applicationStatus)) counts.needsInput += 1
    if (item.applicationStatus === 'captcha_required') counts.captcha += 1
    if (item.applicationStatus === 'submitted') counts.submitted += 1
    if (item.applicationStatus === 'skipped') counts.skipped += 1
    if (FAILED_STATUSES.has(item.applicationStatus)) counts.failed += 1
    if (item.applicationCapability === 'auto_apply_supported') counts.autoApplyCapable += 1
    if (PROCESSED_STATUSES.has(item.applicationStatus)) counts.processed += 1
    if (BLOCKED_STATUSES.has(item.applicationStatus)) counts.blocked += 1
  }
  return counts
}

export function recountWithDiscovery(items: AutoApplyQueueItem[], previous?: AutoApplyCounts | null): AutoApplyCounts {
  const counts = recount(items)
  return {
    ...counts,
    found: Math.max(counts.found, previous?.found ?? 0),
    eligible: Math.max(counts.eligible, previous?.eligible ?? 0),
    autoApplyCapable: Math.max(counts.autoApplyCapable, previous?.autoApplyCapable ?? 0),
  }
}

export function syncRunStatus(run: AutoApplyRun, items: AutoApplyQueueItem[]): AutoApplyRun {
  if (run.status === 'cancelled' || run.status === 'paused' || run.status === 'stopped') return run
  const attention = items.some((item) => ATTENTION_STATUSES.has(item.applicationStatus))
  const active = items.some((item) => ACTIVE_STATUSES.has(item.applicationStatus))
  if (attention && !active) {
    run.status = 'needs_attention'
  } else {
    run.status = 'running'
  }
  return run
}

export { ATTENTION_STATUSES, TERMINAL_STATUSES, ACTIVE_STATUSES, FAILED_STATUSES }
