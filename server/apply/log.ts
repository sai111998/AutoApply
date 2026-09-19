import { inspectApplicationUrl, providerFromIdentity } from './validate'
import type { AutoApplyQueueItem } from './types'

const SECRET_RE = /key|secret|token|password|authorization|service\.role/i

function safe(value: unknown): unknown {
  if (typeof value !== 'string') return value ?? null
  if (SECRET_RE.test(value)) return '[redacted]'
  return value
}

function urlHost(value: string | null | undefined): string | null {
  const inspected = inspectApplicationUrl(value)
  return inspected.url?.hostname ?? null
}

export function logApplyEvent(
  event: string,
  details: {
    runId?: string | null
    jobId?: string | null
    userId?: string | null
    applicationId?: string | null
    itemId?: string | null
    resumeVersionId?: string | null
    applicationUrl?: string | null
    identityKey?: string | null
    matchScore?: number | null
    applicationStatus?: string | null
    code?: string | null
    error?: unknown
  },
) {
  const error = details.error
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : null
  const stack = error instanceof Error ? error.stack : null
  const payload = {
    event,
    runId: details.runId ?? null,
    jobId: details.jobId ?? null,
    userId: details.userId ?? null,
    applicationId: details.applicationId ?? null,
    itemId: details.itemId ?? null,
    resumeVersionId: details.resumeVersionId ?? null,
    urlHost: urlHost(details.applicationUrl),
    provider: providerFromIdentity(details.identityKey),
    matchScore: details.matchScore ?? null,
    applicationStatus: details.applicationStatus ?? null,
    code: details.code ?? null,
    error: message && SECRET_RE.test(message) ? '[redacted]' : safe(message),
    stack: stack && !SECRET_RE.test(stack) ? stack : undefined,
  }
  if (error) console.error('[auto-apply]', payload)
  else console.info('[auto-apply]', payload)
}

const SENSITIVE_KEY = /password|token|authorization|secret|api[_-]?key|service\.role/i

export function logAutoApplyStep(step: number, message: string, extra: Record<string, unknown> = {}) {
  const safeExtra: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(extra)) {
    if (SENSITIVE_KEY.test(key)) continue
    if (typeof value === 'string' && SECRET_RE.test(value)) {
      safeExtra[key] = '[redacted]'
      continue
    }
    safeExtra[key] = value ?? null
  }
  if (Object.keys(safeExtra).length) {
    console.info(`[AutoApply] ${step} ${message}`, safeExtra)
    return
  }
  console.info(`[AutoApply] ${step} ${message}`)
}

export function logQueueItem(event: string, item: AutoApplyQueueItem, extra: Record<string, unknown> = {}) {
  logApplyEvent(event, {
    runId: item.runId,
    jobId: item.jobId,
    applicationId: item.applicationId,
    itemId: item.id,
    resumeVersionId: item.resumeVersionId,
    applicationUrl: item.applicationUrl,
    identityKey: item.identityKey,
    matchScore: item.finalMatchScore ?? item.initialMatchScore,
    applicationStatus: item.applicationStatus,
    ...extra,
  })
}
