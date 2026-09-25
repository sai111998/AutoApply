import type { AutoApplyProfile, AutoApplyQueueItem } from '../apply/types'

interface StoredUserContext {
  profile: AutoApplyProfile
  resumes: Map<string, { text: string; versionId: string | null; name: string }>
}

const contexts = new Map<string, StoredUserContext>()

export function resetExtensionProfilesForTests() {
  contexts.clear()
}

export function rememberAutoApplyProfile(userId: string, profile: AutoApplyProfile) {
  const current = contexts.get(userId) ?? { profile, resumes: new Map() }
  current.profile = profile
  contexts.set(userId, current)
}

export function rememberQueueResume(userId: string, item: AutoApplyQueueItem) {
  const current = contexts.get(userId) ?? {
    profile: {
      fullName: '',
      email: '',
      location: '',
      yearsOfExperience: null,
      workAuthorization: null,
      sponsorshipRequired: false,
      preferredWorkArrangement: null,
      targetSalaryMin: null,
      targetSalaryMax: null,
    },
    resumes: new Map(),
  }
  const key = item.applicationId || item.id
  current.resumes.set(key, {
    text: item.tailoredResumeText ?? '',
    versionId: item.resumeVersionId,
    name: item.resumeVersionName,
  })
  contexts.set(userId, current)
}

export function getStoredProfile(userId: string): AutoApplyProfile | null {
  return contexts.get(userId)?.profile ?? null
}

export function getStoredResume(userId: string, applicationId: string) {
  return contexts.get(userId)?.resumes.get(applicationId) ?? null
}
