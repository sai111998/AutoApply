import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const CONNECTION_TTL_MS = 45_000
const persistFile = path.join(tmpdir(), 'jobpilot-extension-connections.json')
const persistEnabled = process.env.VITEST !== 'true'

export interface ExtensionConnection {
  userId: string
  extensionId: string
  connectedAt: string
  lastSeenAt: string
  activeItemId: string | null
}

const connections = new Map<string, ExtensionConnection>()

function saveConnections() {
  if (!persistEnabled) return
  try {
    writeFileSync(persistFile, JSON.stringify([...connections.values()]))
  } catch {
    // Best-effort across server restarts.
  }
}

function loadConnections() {
  if (!persistEnabled) return
  try {
    const rows = JSON.parse(readFileSync(persistFile, 'utf8')) as ExtensionConnection[]
    if (!Array.isArray(rows)) return
    for (const row of rows) {
      if (row?.userId && row.lastSeenAt) connections.set(row.userId, row)
    }
  } catch {
    // No previous connection file.
  }
}

loadConnections()

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
  saveConnections()
  return current
}

export function heartbeatExtensionConnection(userId: string): ExtensionConnection | null {
  const current = connections.get(userId)
  if (!current) return null
  current.lastSeenAt = new Date().toISOString()
  connections.set(userId, current)
  saveConnections()
  return current
}

export function setActiveExtensionItem(userId: string, itemId: string | null) {
  const current = connections.get(userId)
  if (!current) return
  current.activeItemId = itemId
  current.lastSeenAt = new Date().toISOString()
  connections.set(userId, current)
  saveConnections()
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
    saveConnections()
  }
}
