const CONNECTION_TTL_MS = 45_000

export interface ExtensionConnection {
  userId: string
  extensionId: string
  connectedAt: string
  lastSeenAt: string
  activeItemId: string | null
}

const connections = new Map<string, ExtensionConnection>()

export function resetExtensionConnectionsForTests() {
  connections.clear()
}

export function registerExtensionConnection(userId: string, extensionId = 'unpacked'): ExtensionConnection {
  const now = new Date().toISOString()
  const current: ExtensionConnection = {
    userId,
    extensionId: extensionId.trim() || 'unpacked',
    connectedAt: connections.get(userId)?.connectedAt ?? now,
    lastSeenAt: now,
    activeItemId: connections.get(userId)?.activeItemId ?? null,
  }
  connections.set(userId, current)
  return current
}

export function heartbeatExtensionConnection(userId: string): ExtensionConnection | null {
  const current = connections.get(userId)
  if (!current) return null
  current.lastSeenAt = new Date().toISOString()
  connections.set(userId, current)
  return current
}

export function setActiveExtensionItem(userId: string, itemId: string | null) {
  const current = connections.get(userId)
  if (!current) return
  current.activeItemId = itemId
  current.lastSeenAt = new Date().toISOString()
  connections.set(userId, current)
}

export function isExtensionConnected(userId: string, now = Date.now()): boolean {
  const current = connections.get(userId)
  if (!current) return false
  const seen = Date.parse(current.lastSeenAt)
  if (!Number.isFinite(seen)) return false
  return now - seen <= CONNECTION_TTL_MS
}

export function getExtensionConnection(userId: string): ExtensionConnection | null {
  if (!isExtensionConnected(userId)) return null
  return connections.get(userId) ?? null
}

export function releaseExtensionItem(userId: string, itemId?: string | null) {
  const current = connections.get(userId)
  if (!current) return
  if (!itemId || current.activeItemId === itemId) {
    current.activeItemId = null
    connections.set(userId, current)
  }
}
