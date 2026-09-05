import type { TailoredResume, TailoringPlan } from './types'

export interface ResumeVersionRecord {
  id: string
  userId: string
  sourceResumeId: string
  jobId: string | null
  analysisId: string | null
  versionName: string
  resumeContent: TailoredResume
  tailoringSummary: TailoringPlan
  changes: TailoredResume['changes']
  warnings: string[]
  createdAt: string
  updatedAt: string
}

export function assertSameUser(actorId: string, ownerId: string): boolean {
  return Boolean(actorId && ownerId && actorId === ownerId)
}

export function createResumeVersion(
  store: ResumeVersionRecord[],
  input: Omit<ResumeVersionRecord, 'createdAt' | 'updatedAt'> & { createdAt?: string },
): ResumeVersionRecord {
  if (!input.userId) throw new Error('A signed-in user is required to save a resume version.')
  if (!input.sourceResumeId) throw new Error('A source resume is required.')
  if (!input.resumeContent) throw new Error('Validated resume content is required.')
  const now = input.createdAt ?? new Date().toISOString()
  const record: ResumeVersionRecord = {
    ...input,
    createdAt: now,
    updatedAt: now,
  }
  store.unshift(record)
  return record
}

export function deleteResumeVersion(
  store: ResumeVersionRecord[],
  userId: string,
  versionId: string,
  sourceResumeIds: string[],
): { deleted: boolean; remainingSourceIds: string[] } {
  const index = store.findIndex((item) => item.id === versionId)
  if (index === -1) return { deleted: false, remainingSourceIds: sourceResumeIds }
  const record = store[index]
  if (!assertSameUser(userId, record.userId)) {
    throw new Error('You can only delete your own resume versions.')
  }
  store.splice(index, 1)
  return { deleted: true, remainingSourceIds: sourceResumeIds }
}

export function versionsForUser(store: ResumeVersionRecord[], userId: string): ResumeVersionRecord[] {
  return store.filter((item) => item.userId === userId)
}
