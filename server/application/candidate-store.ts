import type { AutoApplyProfile } from '../apply/types'

export interface StoredCandidateRecord {
  userId: string
  profile: AutoApplyProfile
  resumeText: string | null
  resumeVersionId: string | null
}

const records = new Map<string, StoredCandidateRecord>()

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
  const stored: StoredCandidateRecord = {
    userId,
    profile: input.profile,
    resumeText: input.resumeText?.trim() || null,
    resumeVersionId: input.resumeVersionId?.trim() || null,
  }
  records.set(userId, stored)
  return stored
}

export function getCandidateProfile(userId: string): StoredCandidateRecord | null {
  return records.get(userId.trim()) ?? null
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
