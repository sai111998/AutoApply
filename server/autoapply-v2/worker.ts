import { randomUUID } from 'node:crypto'
import type { AutoApplyQueueItem } from '../apply/types'
import { persistConfirmedSubmission, sanitizeJobDescriptionSnapshot } from '../apply/confirmed'
import { getServerConfig } from '../config'
import { readRuntimeJson, writeRuntimeJson } from '../automation/runtime-io'
import { runV2Application, type V2AgentResult } from './agent'
import { isV2BrowserAvailable, launchV2Browser, type V2BrowserHandle } from './browser'
import { isV2Error } from './errors'
import { takeV2RunInputs } from './inputs'
import { logV2 } from './log'
import { requireV2Profile } from './profile'
import { getV2Run, listV2Runs, updateV2Run, v2QueueDepth } from './queue'
import { loadV2Resume } from './resume'
import { createV2Session, updateV2Session } from './session'
import type { V2QueueItem, V2Resume, V2RunStatus } from './types'
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
      console.error('[AutoApplyV2] worker error', error instanceof Error ? error.message : error)
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

function stopV2Run(runId: string, status: V2RunStatus, failureReason: string): V2QueueItem | null {
  updateV2Run(runId, { status, failureReason })
  updateV2Session(runId, { state: status })
  logV2('RUN_STOPPED', { status, reason: failureReason.split(':')[0] })
  return getV2Run(runId)
}

async function processV2Run(runId: string): Promise<V2QueueItem | null> {
  const run = getV2Run(runId)
  if (!run) return null
  createV2Session({
    runId: run.runId,
    jobId: run.jobId,
    userId: run.userId,
    resumeVersionId: run.resumeVersionId,
  })

  const handedOver = takeV2RunInputs(runId)
  let profile = handedOver?.profile
  if (!profile) {
    try {
      profile = await requireV2Profile(run.userId)
    } catch (error) {
      if (isV2Error(error) && error.code === 'PROFILE_INCOMPLETE') {
        return stopV2Run(runId, 'needs_user_input', `PROFILE_INCOMPLETE: missing ${error.missingFields?.join(',') ?? 'profile'}`)
      }
      const code = isV2Error(error) ? error.code : 'PROFILE_DATABASE_ERROR'
      return stopV2Run(runId, 'failed', `${code}: ${error instanceof Error ? error.message : 'profile unavailable.'}`)
    }
  }

  let resume: V2Resume
  try {
    resume = handedOver?.resume ?? (await loadV2Resume(run.userId, run.resumeVersionId))
  } catch (error) {
    return stopV2Run(runId, 'failed', `RESUME_NOT_FOUND: ${error instanceof Error ? error.message : 'resume unavailable.'}`)
  }

  let handle: V2BrowserHandle
  try {
    handle = await launchV2Browser(true)
  } catch (error) {
    return stopV2Run(runId, 'failed', `BROWSER_UNAVAILABLE: ${error instanceof Error ? error.message : 'Chromium could not start.'}`)
  }
  let result: V2AgentResult
  try {
    result = await runV2Application({ run, profile, resume, page: handle.page })
  } catch (error) {
    await handle.close().catch(() => null)
    const submitted = getV2Run(runId)?.submitClicked === true
    return stopV2Run(
      runId,
      submitted ? 'submission_uncertain' : 'failed',
      `${submitted ? 'SUBMISSION_UNCERTAIN' : 'SUBMISSION_FAILED'}: ${error instanceof Error ? error.message : 'worker crashed.'}`,
    )
  }
  await handle.close().catch(() => null)
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
    const record = await persistV2Application(getV2Run(runId) ?? run, resume)
    logV2('APPLICATION_PERSISTED', { runId, recorded: Boolean(record) })
  }
  return getV2Run(runId)
}

export async function persistV2Application(run: V2QueueItem, resume: V2Resume | null) {
  if (run.status !== 'submitted') return null
  const now = run.submittedAt ?? new Date().toISOString()
  const applicationRecordId = run.applicationRecordId ?? randomUUID()
  const persistedJobId = run.persistedJobId ?? randomUUID()
  const submittedResumeText = resume?.text?.trim() ? resume.text : null
  const submittedResumeVersionId = submittedResumeText ? (run.submittedResumeVersionId ?? randomUUID()) : null
  updateV2Run(run.runId, { applicationRecordId, persistedJobId, submittedResumeVersionId, submittedResumeText })
  const item: AutoApplyQueueItem = {
    id: run.runId,
    runId: run.runId,
    jobId: persistedJobId,
    applicationId: applicationRecordId,
    title: run.title,
    company: run.company,
    location: run.location,
    applicationUrl: run.applicationUrl,
    finalApplicationUrl: run.finalUrl ?? run.applicationUrl,
    resumeVersionId: submittedResumeVersionId,
    resumeVersionName: `Submitted — ${run.title}`,
    sourceResumeId: run.resumeVersionId,
    initialMatchScore: null,
    finalMatchScore: null,
    tailoredResumeText: submittedResumeText,
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
