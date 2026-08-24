import { tailorResumeRequest } from '@/lib/ai/client'
import { createId } from '@/lib/format'
import { emptyTailoredContent, sanitizeTailoredContent } from '@/lib/tailored-text'
import type { ResumeVersion, TailoredResumeContent, TailoringPlan } from '@/types/domain'

export type TailorRequestFn = (payload: Record<string, unknown>) => Promise<Record<string, unknown>>
export type PersistVersionFn = (version: ResumeVersion) => Promise<void>

export interface TailorGenerationInput {
  userId: string
  sourceResumeId: string
  jobId: string
  analysisId: string
  versionName: string
  payload: Record<string, unknown>
  persist: PersistVersionFn
  tailor?: TailorRequestFn
  existingVersionId?: string
  existingGenerationId?: string
  force?: boolean
}

export interface InflightGeneration {
  key: string
  generationId: string
  versionId: string
  startedAt: number
  promise: Promise<ResumeVersion>
}

const inflight = new Map<string, InflightGeneration>()

export function tailorSessionKey(userId: string, sourceResumeId: string, jobId: string): string {
  return `${userId}:${sourceResumeId}:${jobId}`
}

export function getInflightGeneration(key: string): InflightGeneration | null {
  return inflight.get(key) ?? null
}

export function clearInflightGenerations() {
  inflight.clear()
}

export function normalizeResumeVersion(version: ResumeVersion): ResumeVersion {
  return {
    ...version,
    status: version.status ?? 'completed',
    createdBy: version.createdBy ?? 'ai',
    isSelected: Boolean(version.isSelected),
    generationId: version.generationId || version.id,
    comparisonAnalysisId: version.comparisonAnalysisId ?? null,
    originalContent: version.originalContent ?? null,
    changes: version.changes ?? [],
    warnings: version.warnings ?? [],
  }
}

export function findActiveVersion(
  versions: ResumeVersion[],
  sourceResumeId: string,
  jobId: string,
): ResumeVersion | null {
  const matches = versions.filter(
    (item) => item.sourceResumeId === sourceResumeId && item.jobId === jobId,
  )
  const generating = matches.find((item) => item.status === 'generating')
  if (generating) return generating
  const usable = matches
    .filter((item) => item.status === 'completed' || item.status === 'kept')
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  return usable[0] ?? matches.find((item) => item.status === 'failed') ?? null
}

export function shouldStartGeneration(version: ResumeVersion | null, force: boolean): boolean {
  if (force) return true
  if (!version) return true
  if (version.status === 'generating') return !getInflightGeneration(tailorSessionKey(version.userId, version.sourceResumeId, version.jobId ?? ''))
  return false
}

function emptyPlan(): TailoringPlan {
  return { skillsToEmphasize: [], relatedSkills: [], missingSkills: [], experienceToEmphasize: [] }
}

export function startTailorGeneration(input: TailorGenerationInput): InflightGeneration {
  const key = tailorSessionKey(input.userId, input.sourceResumeId, input.jobId)
  const current = inflight.get(key)
  if (current && !input.force) return current

  const generationId = input.existingGenerationId || createId()
  const versionId = input.existingVersionId || createId()
  const startedAt = Date.now()
  const now = new Date().toISOString()

  const stub: ResumeVersion = {
    id: versionId,
    userId: input.userId,
    sourceResumeId: input.sourceResumeId,
    jobId: input.jobId,
    analysisId: input.analysisId,
    versionName: input.versionName,
    resumeContent: emptyTailoredContent(),
    tailoringSummary: emptyPlan(),
    changes: [],
    warnings: [],
    status: 'generating',
    createdBy: 'ai',
    isSelected: false,
    generationId,
    comparisonAnalysisId: null,
    originalContent: null,
    createdAt: now,
    updatedAt: now,
  }

  const promise = (async () => {
    await input.persist(stub)
    try {
      const tailor = input.tailor ?? tailorResumeRequest
      const result = await tailor(input.payload)
      const status = result.status === 'complete' ? 'completed' : 'failed'
      const tailored = (result.tailored as TailoredResumeContent | null) ?? null
      const original = (result.original as TailoredResumeContent | null) ?? null
      const plan = (result.plan as TailoringPlan) ?? emptyPlan()
      const message = typeof result.message === 'string' ? result.message : undefined
      const completed: ResumeVersion = {
        ...stub,
        resumeContent: tailored ? sanitizeTailoredContent(tailored) : emptyTailoredContent(),
        originalContent: original ? sanitizeTailoredContent(original) : original,
        tailoringSummary: plan,
        changes: tailored?.changes ?? [],
        warnings: [
          ...(Array.isArray(result.validation) ? [] : []),
          ...(tailored?.warnings ?? []),
          ...(status === 'failed' && message ? [message] : []),
        ],
        status,
        updatedAt: new Date().toISOString(),
      }
      if (status === 'failed' && !completed.warnings.length) {
        completed.warnings = ['Some generated content could not be verified against your master resume. Please review and regenerate.']
      }
      await input.persist(completed)
      return completed
    } catch (error) {
      const failed: ResumeVersion = {
        ...stub,
        status: 'failed',
        warnings: [error instanceof Error ? error.message : 'Resume tailoring failed.'],
        updatedAt: new Date().toISOString(),
      }
      await input.persist(failed)
      return failed
    }
  })()

  const session: InflightGeneration = { key, generationId, versionId, startedAt, promise }
  inflight.set(key, session)
  void promise.finally(() => {
    const active = inflight.get(key)
    if (active?.generationId === generationId) inflight.delete(key)
  })
  return session
}

export function markVersionSelected(versions: ResumeVersion[], versionId: string, jobId: string | null): ResumeVersion[] {
  return versions.map((item) => {
    if (item.id === versionId) return { ...item, isSelected: true, status: item.status === 'failed' ? item.status : 'kept', updatedAt: new Date().toISOString() }
    if (jobId && item.jobId === jobId && item.isSelected) return { ...item, isSelected: false }
    return item
  })
}
