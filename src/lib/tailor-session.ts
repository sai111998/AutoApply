import { tailorResumeRequest } from '@/lib/ai/client'
import { createId } from '@/lib/format'
import { emptyTailoredContent, sanitizeTailoredContent } from '@/lib/tailored-text'
import type { ResumeVersion, TailoredResumeContent, TailoringPlan } from '@/types/domain'

export type TailorRequestFn = (payload: Record<string, unknown>) => Promise<Record<string, unknown>>
export type PersistVersionFn = (version: ResumeVersion) => Promise<void>

export const GENERATION_TIMEOUT_MS = 70_000
export const STALE_GENERATING_MS = 90_000
export const USER_TAILOR_ERROR = 'Your resume could not be tailored right now. Please try again.'

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
  timeoutMs?: number
  now?: number
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

export function logTailorEvent(event: string, details: Record<string, string | number | boolean | null | undefined>) {
  console.info('[tailor]', event, details)
}

export function userFacingTailorError(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return 'The tailoring service could not be reached. Please try again.'
  }
  if (/timeout|abort|could not be tailored/i.test(message)) return USER_TAILOR_ERROR
  if (/key|secret|service.role|bearer|stack/i.test(message)) return USER_TAILOR_ERROR
  if (/could not be verified/i.test(message)) return message
  if (message.trim() && message.length < 180 && !/undefined|null/.test(message)) return message
  return USER_TAILOR_ERROR
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

export function isStaleGenerating(version: ResumeVersion | null, now = Date.now()): boolean {
  if (!version || version.status !== 'generating') return false
  if (getInflightGeneration(tailorSessionKey(version.userId, version.sourceResumeId, version.jobId ?? ''))) {
    return false
  }
  const updated = Date.parse(version.updatedAt || version.createdAt)
  if (!Number.isFinite(updated)) return true
  return now - updated > STALE_GENERATING_MS
}

export function findActiveVersion(
  versions: ResumeVersion[],
  sourceResumeId: string,
  jobId: string,
  now = Date.now(),
): ResumeVersion | null {
  const matches = versions.filter(
    (item) => item.sourceResumeId === sourceResumeId && item.jobId === jobId,
  )
  const generating = matches.find((item) => item.status === 'generating' && !isStaleGenerating(item, now))
  if (generating) return generating
  const usable = matches
    .filter((item) => item.status === 'completed' || item.status === 'kept')
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  if (usable[0]) return usable[0]
  const staleGenerating = matches.find((item) => item.status === 'generating')
  return matches.find((item) => item.status === 'failed') ?? staleGenerating ?? null
}

export function shouldStartGeneration(version: ResumeVersion | null, force: boolean, now = Date.now()): boolean {
  if (force) return true
  if (!version) return true
  if (version.status === 'generating') {
    if (getInflightGeneration(tailorSessionKey(version.userId, version.sourceResumeId, version.jobId ?? ''))) {
      return false
    }
    if (isStaleGenerating(version, now)) return false
    return true
  }
  return false
}

function emptyPlan(): TailoringPlan {
  return { skillsToEmphasize: [], relatedSkills: [], missingSkills: [], experienceToEmphasize: [] }
}

export async function withTimeout<T>(promise: Promise<T>, ms: number, message = USER_TAILOR_ERROR): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function failedVersion(stub: ResumeVersion, error: unknown): ResumeVersion {
  return {
    ...stub,
    status: 'failed',
    warnings: [userFacingTailorError(error)],
    updatedAt: new Date().toISOString(),
  }
}

export function startTailorGeneration(input: TailorGenerationInput): InflightGeneration {
  const key = tailorSessionKey(input.userId, input.sourceResumeId, input.jobId)
  const current = inflight.get(key)
  if (current && !input.force) return current

  const generationId = input.existingGenerationId || createId()
  const versionId = input.existingVersionId || createId()
  const startedAt = input.now ?? Date.now()
  const now = new Date(startedAt).toISOString()
  const timeoutMs = input.timeoutMs ?? GENERATION_TIMEOUT_MS

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
    logTailorEvent('start', {
      generationId,
      versionId,
      resumeId: input.sourceResumeId,
      jobId: input.jobId,
      matchId: input.analysisId,
    })
    try {
      void input.persist(stub).catch((error) => {
        logTailorEvent('persist-generating-failed', {
          generationId,
          versionId,
          reason: error instanceof Error ? 'persist_error' : 'unknown',
        })
      })

      const tailor = input.tailor ?? tailorResumeRequest
      const result = await withTimeout(tailor(input.payload), timeoutMs)
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
          ...(tailored?.warnings ?? []),
          ...(status === 'failed'
            ? [message && !/key|secret|service.role|stack/i.test(message) ? message : USER_TAILOR_ERROR]
            : message && !/key|secret|service.role|stack/i.test(message)
              ? [message]
              : []),
        ].filter(Boolean) as string[],
        status,
        updatedAt: new Date().toISOString(),
      }
      if (status === 'failed' && !completed.warnings.length) {
        completed.warnings = [USER_TAILOR_ERROR]
      }
      try {
        await input.persist(completed)
      } catch (error) {
        logTailorEvent('persist-completed-failed', {
          generationId,
          versionId,
          status: completed.status,
        })
        if (completed.status === 'completed') {
          const savedLocally: ResumeVersion = {
            ...completed,
            warnings: [...completed.warnings, 'This version is available here but could not be saved to your account yet.'],
          }
          try {
            await input.persist(savedLocally)
          } catch {
            logTailorEvent('persist-completed-retry-failed', { generationId, versionId })
          }
          return savedLocally
        }
        throw error
      }
      logTailorEvent('done', { generationId, versionId, status: completed.status })
      return completed
    } catch (error) {
      const failed = failedVersion(stub, error)
      logTailorEvent('failed', { generationId, versionId, status: 'failed' })
      try {
        await input.persist(failed)
      } catch {
        logTailorEvent('persist-failed-error', { generationId, versionId })
      }
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

export function markGeneratingFailed(version: ResumeVersion): ResumeVersion {
  return {
    ...version,
    status: 'failed',
    warnings: version.warnings.length ? version.warnings : [USER_TAILOR_ERROR],
    updatedAt: new Date().toISOString(),
  }
}
