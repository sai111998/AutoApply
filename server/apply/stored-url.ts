import { isJobPilotAppUrl } from '../../extension/src/shared/page-session'
import { isLoopbackHostname, isSyntheticExtensionTestUrl } from '../../extension/src/shared/url'
import { inspectApplicationUrl } from './validate'

export type StoredUrlKind = 'valid' | 'missing' | 'localhost' | 'jobpilot' | 'invalid'

export interface StoredUrlInspection {
  ok: boolean
  kind: StoredUrlKind
  url: string | null
  reason: string | null
}

const JOBPILOT_PATHS = /^\/(jobs|dashboard|applications|auto-apply|analyze|resumes)(\/|$)/i

export function isJobPilotInternalUrl(value: string | null | undefined): boolean {
  const raw = value?.trim() ?? ''
  if (!raw) return false
  try {
    const url = new URL(raw)
    if (isSyntheticExtensionTestUrl(url)) return false
    if (isJobPilotAppUrl(url.toString())) return true
    if (isLoopbackHostname(url.hostname) && JOBPILOT_PATHS.test(url.pathname)) return true
    return false
  } catch {
    return JOBPILOT_PATHS.test(raw)
  }
}

export function inspectStoredApplicationUrl(value: string | null | undefined): StoredUrlInspection {
  const raw = value?.trim() ?? ''
  if (!raw || raw === 'undefined' || raw === 'null') {
    return { ok: false, kind: 'missing', url: null, reason: 'storedApplicationUrl is missing.' }
  }
  try {
    const parsed = new URL(raw)
    if (isSyntheticExtensionTestUrl(parsed)) {
      return { ok: true, kind: 'valid', url: parsed.toString(), reason: null }
    }
  } catch {
    return { ok: false, kind: 'invalid', url: null, reason: 'storedApplicationUrl is not a valid http(s) URL.' }
  }
  if (isJobPilotInternalUrl(raw)) {
    return { ok: false, kind: 'jobpilot', url: null, reason: 'storedApplicationUrl points at JobPilot, not an employer site.' }
  }
  try {
    const parsed = new URL(raw)
    if (isLoopbackHostname(parsed.hostname)) {
      return { ok: false, kind: 'localhost', url: null, reason: 'storedApplicationUrl is a localhost URL.' }
    }
  } catch {
    return { ok: false, kind: 'invalid', url: null, reason: 'storedApplicationUrl is not a valid http(s) URL.' }
  }
  const inspected = inspectApplicationUrl(raw)
  if (!inspected.ok || !inspected.url) {
    return { ok: false, kind: 'invalid', url: null, reason: 'storedApplicationUrl is not a valid external http(s) URL.' }
  }
  return { ok: true, kind: 'valid', url: inspected.url.toString(), reason: null }
}
