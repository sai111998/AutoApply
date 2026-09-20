import type { InterventionReason, UserIntervention } from './types'

const interventions = new Map<string, UserIntervention>()

function nowIso() {
  return new Date().toISOString()
}

export function resetInterventionsForTests() {
  interventions.clear()
}

export function recordUserIntervention(input: {
  applicationId: string
  itemId: string
  reason: InterventionReason
  currentUrl: string
}): UserIntervention {
  const existing = interventions.get(input.itemId)
  const createdAt = existing?.createdAt ?? nowIso()
  const record: UserIntervention = {
    applicationId: input.applicationId,
    itemId: input.itemId,
    reason: input.reason,
    currentUrl: input.currentUrl,
    createdAt,
    updatedAt: nowIso(),
    resolvedAt: null,
  }
  interventions.set(input.itemId, record)
  return record
}

export function getUserIntervention(itemId: string): UserIntervention | null {
  return interventions.get(itemId) ?? null
}

export function listOpenInterventions(): UserIntervention[] {
  return [...interventions.values()].filter((item) => !item.resolvedAt)
}

export function resolveUserIntervention(itemId: string): UserIntervention | null {
  const current = interventions.get(itemId)
  if (!current) return null
  const next = { ...current, resolvedAt: nowIso(), updatedAt: nowIso() }
  interventions.set(itemId, next)
  return next
}
