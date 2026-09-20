import { isJobPilotAppUrl } from './page-session'

const INVALID_APPLICATION_URL = 'This listing does not include a valid application URL.'
const BLOCKED_PROTOCOLS = new Set(['javascript:', 'chrome:', 'file:', 'data:', 'about:', 'blob:', 'chrome-extension:'])

export function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  return host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '::1' || host.endsWith('.localhost')
}

export function isSyntheticExtensionTestUrl(url: URL): boolean {
  return (
    isLoopbackHostname(url.hostname) &&
    (url.pathname.startsWith('/extension/test/') || url.pathname.startsWith('/browser-worker/synthetic/'))
  )
}

export function inspectApplicationUrl(value: string | null | undefined): {
  ok: boolean
  url: URL | null
  reason: string | null
} {
  const raw = value?.trim() ?? ''
  if (!raw) return { ok: false, url: null, reason: INVALID_APPLICATION_URL }
  try {
    const url = new URL(raw)
    if (BLOCKED_PROTOCOLS.has(url.protocol)) {
      return { ok: false, url: null, reason: INVALID_APPLICATION_URL }
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { ok: false, url: null, reason: INVALID_APPLICATION_URL }
    }
    if (!url.hostname) return { ok: false, url: null, reason: INVALID_APPLICATION_URL }
    if (isSyntheticExtensionTestUrl(url)) return { ok: true, url, reason: null }
    if (isJobPilotAppUrl(url.toString()) || isLoopbackHostname(url.hostname)) {
      return { ok: false, url: null, reason: INVALID_APPLICATION_URL }
    }
    return { ok: true, url, reason: null }
  } catch {
    return { ok: false, url: null, reason: INVALID_APPLICATION_URL }
  }
}

export function originPattern(url: URL): string {
  return `${url.origin}/*`
}
