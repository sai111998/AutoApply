import { readRuntimeJson, writeRuntimeJson } from '../automation/runtime-io'
import type { AutoApplyProfile } from '../apply/types'

export interface StoredCandidateRecord {
  userId: string
  profile: AutoApplyProfile
  resumeText: string | null
  resumeVersionId: string | null
}

const CANDIDATE_FILE = 'candidates.json'
const records = new Map<string, StoredCandidateRecord>()

function reloadCandidates() {
  const parsed = readRuntimeJson<StoredCandidateRecord[]>(CANDIDATE_FILE)
  if (!parsed) return
  for (const entry of parsed) {
    if (entry?.userId) records.set(entry.userId, entry)
  }
}

function flushCandidates() {
  writeRuntimeJson(CANDIDATE_FILE, [...records.values()])
}

export function resetCandidateStoreForTests() {
  records.clear()
}

export function saveCandidateProfile(input: {
  userId: string
  profile: AutoApplyProfile
  resumeText?: string | null
  resumeVersionId?: string | null
}): StoredCandidateRecord | null {
  const userId = input.userId.trim()
  if (!userId) return null
  reloadCandidates()
  const stored: StoredCandidateRecord = {
    userId,
    profile: input.profile,
    resumeText: input.resumeText?.trim() || null,
    resumeVersionId: input.resumeVersionId?.trim() || null,
  }
  records.set(userId, stored)
  flushCandidates()
  return stored
}

export function getCandidateProfile(userId: string): StoredCandidateRecord | null {
  reloadCandidates()
  return records.get(userId.trim()) ?? null
}

export function listCandidateUserIds(): string[] {
  reloadCandidates()
  return [...records.keys()]
}

export function candidateRequiredFieldsExist(profile: AutoApplyProfile | null | undefined): {
  firstName: 'yes' | 'no'
  lastName: 'yes' | 'no'
  email: 'yes' | 'no'
  phone: 'yes' | 'no'
} {
  const name = profile?.fullName?.trim() ?? ''
  const parts = name.split(/\s+/).filter(Boolean)
  return {
    firstName: parts[0] ? 'yes' : 'no',
    lastName: parts.slice(1).join(' ') ? 'yes' : 'no',
    email: profile?.email?.trim() ? 'yes' : 'no',
    phone: 'phone' in (profile ?? {}) && Boolean((profile as { phone?: string | null }).phone?.trim())
      ? 'yes'
      : 'no',
  }
}
