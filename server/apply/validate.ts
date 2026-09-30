import { inspectApplicationUrl as inspectEmployerApplicationUrl } from '../../extension/src/shared/url'
import { ApplyError, type ApplyErrorCode } from './errors'
import type { AutoApplyQueueItem } from './types'

const BLOCKED_STATUSES = new Set(['submitted', 'cancelled', 'skipped'])
const INCOMPLETE_VERSION = /pending|processing|generating|incomplete|not ready/i

export function providerFromIdentity(identityKey: string | null | undefined): string {
  const value = identityKey?.trim() ?? ''
  const index = value.indexOf(':')
  return index > 0 ? value.slice(0, index) : value || 'unknown'
}

export function applicationUrlHost(value: string | null | undefined): string | null {
  try {
    return value ? new URL(value).hostname : null
  } catch {
    return null
  }
}

export function inspectApplicationUrl(value: string | null | undefined): {
  ok: boolean
  code: Extract<ApplyErrorCode, 'APPLICATION_URL_MISSING' | 'INVALID_APPLICATION_URL'> | null
  url: URL | null
} {
  const raw = value?.trim() ?? ''
  if (!raw) return { ok: false, code: 'APPLICATION_URL_MISSING', url: null }
  const inspected = inspectEmployerApplicationUrl(raw)
  if (!inspected.ok || !inspected.url) return { ok: false, code: 'INVALID_APPLICATION_URL', url: null }
  return { ok: true, code: null, url: inspected.url }
}

export function assertCanPrepareItem(
  item: AutoApplyQueueItem,
  input: { userId?: string | null; runUserId?: string | null } = {},
): void {
  if (input.userId && input.runUserId && input.userId !== input.runUserId) {
    throw new ApplyError(401, 'AUTHENTICATION_FAILURE')
  }
  if (!item.jobId?.trim()) throw new ApplyError(404, 'JOB_NOT_FOUND')
  if (!item.id?.trim() || !item.runId?.trim()) throw new ApplyError(404, 'APPLICATION_NOT_FOUND')
  if (BLOCKED_STATUSES.has(item.applicationStatus)) {
    throw new ApplyError(409, 'APPLICATION_NOT_FOUND', 'This application is no longer available to prepare.')
  }
  const url = inspectApplicationUrl(item.applicationUrl)
  if (!url.ok && url.code) throw new ApplyError(422, url.code)
  if (!item.resumeVersionId?.trim() && !item.tailoredResumeText?.trim()) {
    throw new ApplyError(422, 'RESUME_VERSION_NOT_FOUND')
  }
  if (INCOMPLETE_VERSION.test(item.resumeVersionName || '')) {
    throw new ApplyError(422, 'RESUME_VERSION_NOT_READY')
  }
  if (!item.tailoredResumeText?.trim()) throw new ApplyError(422, 'RESUME_FILE_MISSING')
}

export function assertSupportedProvider(identityKey: string | null | undefined): void {
  const provider = providerFromIdentity(identityKey)
  if (!provider || provider === 'unknown') throw new ApplyError(422, 'UNSUPPORTED_PROVIDER')
}
