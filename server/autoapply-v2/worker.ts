import type { AutoApplyQueueItem } from '../apply/types'
import { persistConfirmedSubmission, sanitizeJobDescriptionSnapshot } from '../apply/confirmed'
import { getServerConfig } from '../config'
import { readRuntimeJson, writeRuntimeJson } from '../automation/runtime-io'
import { runV2Application } from './agent'
import { isV2BrowserAvailable, launchV2Browser } from './browser'
import { loadV2Profile } from './profile'
import { getV2Run, listV2Runs, v2QueueDepth } from './queue'
import { loadV2Resume } from './resume'
import { createV2Session, updateV2Session } from './session'
import type { V2QueueItem, V2RunStatus } from './types'
import { V2_TERMINAL_STATUSES } from './types'

const V2_HEARTBEAT_FILE = 'autoapply-v2-heartbeat.json'

let workerTimer: NodeJS.Timeout | null = null
let workerProcessing = false
const processedRunIds = new Set<string>()
let lastHeartbeat: string | null = null
let currentState: V2RunStatus | 'idle' = 'idle'

export function resetV2WorkerForTests() {
  workerProcessing = false
  processedRunIds.clear()
  lastHeartbeat = null
  currentState = 'idle'
}

function touchV2Heartbeat() {
  lastHeartbeat = new Date().toISOString()
  writeRuntimeJson(V2_HEARTBEAT_FILE, { lastHeartbeat, workerRunning: workerTimer !== null })
}

export function v2LastHeartbeat(): string | null {
  if (lastHeartbeat) return lastHeartbeat
  return readRuntimeJson<{ lastHeartbeat?: string }>(V2_HEARTBEAT_FILE)?.lastHeartbeat ?? null
}

export function v2WorkerState(): { workerRunning: boolean; agentRunning: boolean; currentState: V2RunStatus | 'idle' } {
  const active = listV2Runs().find((item) => !V2_TERMINAL_STATUSES.has(item.status))
  return {
    workerRunning: workerTimer !== null,
    agentRunning: workerProcessing,
    currentState: active?.status ?? currentState,
  }
}

export function startV2Worker(intervalMs = 1500): void {
  if (workerTimer) return
  touchV2Heartbeat()
  workerTimer = setInterval(() => {
    touchV2Heartbeat()
    void processV2QueueOnce().catch((error) => {
      console.error('[V2] worker error', error instanceof Error ? error.message : error)
    })
  }, intervalMs)
  workerTimer.unref?.()
}

export function stopV2Worker(): void {
  if (workerTimer) clearInterval(workerTimer)
  workerTimer = null
  touchV2Heartbeat()
}

export async function v2Health() {
  const state = v2WorkerState()
  return {
    agentRunning: state.agentRunning,
    workerRunning: state.workerRunning,
    browserAvailable: await isV2BrowserAvailable(),
    queueDepth: v2QueueDepth(),
    lastHeartbeat: v2LastHeartbeat(),
    currentState: state.currentState,
  }
}

export async function processV2QueueOnce(): Promise<V2QueueItem | null> {
  if (workerProcessing) return null
  const next = listV2Runs()
    .filter((item) => item.status === 'queued' && !processedRunIds.has(item.runId))
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))[0]
  if (!next) return null
  workerProcessing = true
  processedRunIds.add(next.runId)
  currentState = next.status
  touchV2Heartbeat()
  try {
    return await processV2Run(next.runId)
  } finally {
    workerProcessing = false
    currentState = getV2Run(next.runId)?.status ?? 'idle'
    touchV2Heartbeat()
  }
}

async function processV2Run(runId: string): Promise<V2QueueItem | null> {
  const { updateV2Run } = await import('./queue')
  const run = getV2Run(runId)
  if (!run) return null
  createV2Session({
    runId: run.runId,
    jobId: run.jobId,
    userId: run.userId,
    resumeVersionId: run.resumeVersionId,
  })

  const { profile, profileReady, missing } = await loadV2Profile(run.userId)
  if (!profileReady) {
    const failureReason = `PROFILE_INCOMPLETE: missing ${missing.join(',')}`
    updateV2Run(runId, { status: 'needs_user_input', failureReason })
    updateV2Session(runId, { state: 'needs_user_input' })
    return getV2Run(runId)
  }

  let resume
  try {
    resume = await loadV2Resume(run.userId)
  } catch (error) {
    const failureReason = `RESUME_NOT_FOUND: ${error instanceof Error ? error.message : 'resume unavailable.'}`
    updateV2Run(runId, { status: 'failed', failureReason })
    updateV2Session(runId, { state: 'failed' })
    return getV2Run(runId)
  }

  const handle = await launchV2Browser(true)
  try {
    const result = await runV2Application({ run, profile, resume, page: handle.page })
    updateV2Run(runId, {
      status: result.status,
      failureReason: result.failureReason,
      pageState: result.pageState,
      provider: result.provider,
      finalUrl: result.finalUrl,
      redirectChain: result.redirectChain,
      fieldsDetected: result.fieldsDetected,
      fieldsFilled: result.fieldsFilled,
      resumeUploaded: result.resumeUploaded,
      submitClicked: result.submitClicked,
      confirmationNumber: result.confirmation?.confirmationNumber ?? null,
      confirmationText: result.confirmation?.confirmationText ?? null,
      confirmationEvidence: result.confirmation?.evidence ?? [],
      submittedAt: result.status === 'submitted' ? new Date().toISOString() : null,
    })
    updateV2Session(runId, { state: result.status, currentUrl: result.finalUrl })
    if (result.status === 'submitted' && result.confirmation?.confirmed) {
      await persistV2Application(getV2Run(runId) ?? run)
      console.log('[V2] APPLICATION_PERSISTED')
    }
    return getV2Run(runId)
  } catch (error) {
    const failureReason = `SUBMISSION_FAILED: ${error instanceof Error ? error.message : 'worker crashed.'}`
    updateV2Run(runId, { status: 'failed', failureReason })
    updateV2Session(runId, { state: 'failed' })
    return getV2Run(runId)
  } finally {
    await handle.close().catch(() => null)
  }
}

export async function persistV2Application(run: V2QueueItem) {
  if (run.status !== 'submitted') return null
  const now = run.submittedAt ?? new Date().toISOString()
  const item: AutoApplyQueueItem = {
    id: run.runId,
    runId: run.runId,
    jobId: run.jobId,
    applicationId: run.jobId,
    title: run.title,
    company: run.company,
    location: run.location,
    applicationUrl: run.finalUrl ?? run.applicationUrl,
    finalApplicationUrl: run.finalUrl ?? run.applicationUrl,
    resumeVersionId: run.resumeVersionId,
    resumeVersionName: run.resumeVersionName,
    sourceResumeId: run.resumeVersionId,
    initialMatchScore: 0,
    finalMatchScore: 0,
    tailoredResumeText: null,
    jobDescriptionSnapshot: sanitizeJobDescriptionSnapshot(run.jdSnapshot),
    questions: [],
    c2cStatus: 'unknown',
    c2cEvidence: [],
    applicationStatus: 'submitted',
    failureReason: null,
    confirmationNumber: run.confirmationNumber,
    confirmationText: run.confirmationText,
    submittedAt: now,
    masterResumeUnchanged: true,
    sessionId: run.runId,
    createdAt: run.createdAt,
    updatedAt: now,
    identityKey: `live:${run.jobId}`,
    discoverySource: null,
    applicationProvider: run.provider,
  }
  return persistConfirmedSubmission({
    userId: run.userId,
    item,
    provider: run.provider,
    config: getServerConfig(),
  })
}
