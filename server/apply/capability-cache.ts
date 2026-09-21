import type { ApplicationCapability } from './capability'
import type { ApplicationPreflightDecision } from './application-preflight'

export interface CachedCapability {
  identity: string
  url: string
  provider: string
  capability: ApplicationCapability
  reason: string | null
  checkedAt: string
}

const cache = new Map<string, CachedCapability>()
const TTL_MS = 6 * 60 * 60 * 1000

function key(identity: string, url: string): string {
  return `${identity.trim().toLowerCase()}::${url.trim().toLowerCase()}`
}

export function resetCapabilityCacheForTests() {
  cache.clear()
}

export function rememberCapability(record: CachedCapability): CachedCapability {
  cache.set(key(record.identity, record.url), record)
  return record
}

export function rememberDecision(
  identity: string,
  url: string,
  decision: ApplicationPreflightDecision,
): CachedCapability {
  return rememberCapability({
    identity,
    url,
    provider: decision.provider,
    capability: decision.capability,
    reason: decision.reason,
    checkedAt: decision.checkedAt,
  })
}

export function lookupCapability(identity: string, url: string, now = Date.now()): CachedCapability | null {
  const stored = cache.get(key(identity, url))
  if (!stored) return null
  if (Date.parse(stored.checkedAt) && now - Date.parse(stored.checkedAt) > TTL_MS) {
    cache.delete(key(identity, url))
    return null
  }
  return stored
}

export function shouldRevalidateCapability(
  stored: CachedCapability | null,
  current: { url: string; provider?: string | null },
): boolean {
  if (!stored) return true
  if (stored.url.trim().toLowerCase() !== current.url.trim().toLowerCase()) return true
  if (current.provider && stored.provider !== current.provider) return true
  return false
}
