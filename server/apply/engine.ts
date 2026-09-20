import { randomUUID } from 'node:crypto'
import { conservativeTailor } from '../tailor/engine'
import { tailoredResumeToText } from '../tailor/match-optimize'
import type { LiveJobsRequest } from '../jobs/list'
import type { ServerConfig } from '../config'
import type { FetchLike } from '../jobs/http'
import { createApplyBrowser } from './browser'
import {
  applicationIdentity,
  hasDuplicateApplication,
  hasDuplicateQueueEntry,
  isExcludedCompany,
  jobApplicationUrl,
  meetsMatchThreshold,
} from './eligibility'
import { canEnterAutonomousApply, classifyApplicationCapability } from './capability'
import { preflightApplication } from './preflight'
import type {
  ApplyBrowser,
  AutoApplyConfig,
  AutoApplyMutationResult,
  AutoApplyQueueItem,
  AutoApplyRun,
  AutoApplyStartInput,
  ListedAutoApplyJob,
} from './types'
import { ApplyError, isApplyError } from './errors'
import { emptyCounts, recount, recountWithDiscovery, syncRunStatus } from './counts'
import { getAutomationHealth } from './health'
import { logApplyEvent, logAutoApplyStep, logQueueItem } from './log'
import {
  loadRunFromDatabase,
  loadRunsFromDatabase,
  memoryStore,
  persistRun,
  type AutoApplyStore,
  type StoredRun,
} from './store'
import {
  mergeApplyTimeouts,
  withTimeout,
  type ApplyTimeouts,
} from './timeouts'
import { rememberAutoApplyProfile, rememberQueueResume } from '../extension/profile-store'
import { releaseExtensionItem } from '../extension/connection'
import { assertCanPrepareItem } from './validate'
import { persistConfirmedSubmission, applyConfirmationToQueueItem } from './confirmed'
import { getBrowserWorker, notifyBrowserWorker, submitBrowserWorkerItem, waitForBrowserJob } from '../browser-worker/worker'
import { c2cOnly, remainingDailySlots, utcDayKey } from '../agent/policy'
import { discoverCampaignJobs } from '../agent/discovery'
import { rememberUserAnswers } from './questions'

const MATCH_PRESETS = [70, 75, 80, 85, 90, 95]
const DEFAULT_DELAY_MS = 250

let applyChain: Promise<unknown> = Promise.resolve()
const inFlightPrepares = new Map<string, Promise<AutoApplyMutationResult>>()

function prepareKey(runId: string, itemId: string) {
  return `${runId}:${itemId}`
}

function withApplyLock<T>(fn: () => Promise<T>, lockMs: number): Promise<T> {
  const next = applyChain.then(
    () => withTimeout(fn(), lockMs, 'PREPARE_TIMEOUT', 'Application preparation timed out.'),
    () => withTimeout(fn(), lockMs, 'PREPARE_TIMEOUT', 'Application preparation timed out.'),
  )
  applyChain = next.then(() => undefined, () => undefined)
  return next
}

export function resetAutoApplyEngineForTests() {
  applyChain = Promise.resolve()
  inFlightPrepares.clear()
}

export function normalizeMinimumMatchRate(value: number): number {
  if (!Number.isFinite(value)) return 85
  const rounded = Math.round(value)
  return Math.min(99, Math.max(50, rounded))
}

export function suggestedMatchRates(): number[] {
  return [...MATCH_PRESETS]
}

export { recount, recountWithDiscovery, emptyCounts, syncRunStatus }

function nowIso(): string {
  return new Date().toISOString()
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function tailorForJob(input: {
  resumeText: string
  job: ListedAutoApplyJob
}): { score: number; text: string; versionName: string } {
  const result = conservativeTailor({
    resumeText: input.resumeText,
    jobDescription: input.job.description ?? '',
  })
  const tailored = result.tailored ?? result.original
  return {
    score: result.tailoredMatchScore ?? result.originalMatchScore ?? 0,
    text: tailoredResumeToText(tailored),
    versionName: 'Tailored v1',
  }
}

export interface AutoApplyEngineDeps {
  listJobs?: (request: LiveJobsRequest) => Promise<{ jobs: ListedAutoApplyJob[] }>
  browser?: ApplyBrowser
  store?: AutoApplyStore
  delayMs?: number
  timeouts?: Partial<ApplyTimeouts>
}

async function listCampaignJobs(
  config: ServerConfig,
  input: AutoApplyStartInput,
  fetchImpl: FetchLike | undefined,
  deps: AutoApplyEngineDeps,
): Promise<ListedAutoApplyJob[]> {
  return discoverCampaignJobs(config, input, fetchImpl, deps)
}

function enqueueEligibleJobs(input: {
  run: AutoApplyRun
  items: AutoApplyQueueItem[]
  jobs: ListedAutoApplyJob[]
  startInput: AutoApplyStartInput
  previous: StoredRun[]
}): { added: number; found: number; eligible: number; autoApplyCapable: number } {
  const { run, items, jobs, startInput, previous } = input
  const masterSnapshot = startInput.masterResumeText
  const day = utcDayKey()
  const priorToday = previous
    .filter((entry) => entry.run.id !== run.id)
    .flatMap((entry) => entry.items)
  const queueIdentities = [
    ...items.map((item) => item.identityKey),
    ...(startInput.existingQueueIdentities ?? []),
    ...previous.flatMap((entry) =>
      entry.items
        .filter((item) => !['skipped', 'cancelled', 'failed'].includes(item.applicationStatus))
        .map((item) => item.identityKey),
    ),
  ]
  let added = 0
  let eligible = 0
  let autoApplyCapable = 0
  for (const job of jobs) {
    if (remainingDailySlots([...items, ...priorToday], run.config.maxJobs, day) <= 0) break
    if (c2cOnly(run.config) && job.c2cStatus !== 'confirmed') continue
    if (isExcludedCompany(job.company, run.config.excludedCompanies)) continue
    if (!jobApplicationUrl(job)) continue
    if (hasDuplicateApplication(job, startInput.existingApplications)) continue
    if (hasDuplicateQueueEntry(job, queueIdentities)) continue

    const initial = job.match?.score ?? job.matchScore ?? null
    let finalScore = initial
    let tailoredText: string | null = null
    let resumeVersionId: string | null = randomUUID()
    let resumeVersionName = 'Master'
    const timestamp = nowIso()

    if (startInput.config.autoTailorResume) {
      const identity = applicationIdentity(job)
      const reused = [...previous.flatMap((entry) => entry.items), ...items].find(
        (item) =>
          item.identityKey === identity &&
          Boolean(item.tailoredResumeText?.trim()) &&
          /tailored/i.test(item.resumeVersionName),
      )
      if (reused?.tailoredResumeText) {
        finalScore = reused.finalMatchScore ?? initial
        tailoredText = reused.tailoredResumeText
        resumeVersionId = reused.resumeVersionId
        resumeVersionName = reused.resumeVersionName
      } else {
        const tailored = tailorForJob({ resumeText: startInput.resumeText, job })
        finalScore = tailored.score
        tailoredText = tailored.text
        resumeVersionId = randomUUID()
        resumeVersionName = `Tailored v1 — ${job.title}`
      }
    }

    if (!meetsMatchThreshold(finalScore, run.config.minimumMatchRate)) continue
    eligible += 1

    const applicationUrl = jobApplicationUrl(job)
    const capability = classifyApplicationCapability({
      url: job.url,
      applicationUrl,
      discoveryProvider: job.provider,
    })
    const staticPreflight = preflightApplication({
      url: job.url,
      applicationUrl,
      provider: job.provider,
    })
    if (!canEnterAutonomousApply(capability.capability) || !canEnterAutonomousApply(staticPreflight.capability)) {
      logApplyEvent('capability-skip', {
        jobId: job.id,
        applicationUrl,
        matchScore: finalScore,
        code: capability.capability,
      })
      continue
    }
    autoApplyCapable += 1

    const identity = applicationIdentity(job)
    queueIdentities.push(identity)
    items.push({
      id: randomUUID(),
      runId: run.id,
      jobId: job.id,
      identityKey: identity,
      applicationId: randomUUID(),
      resumeVersionId,
      resumeVersionName,
      sourceResumeId: startInput.resumeId,
      title: job.title,
      company: job.company,
      applicationUrl,
      initialMatchScore: initial,
      finalMatchScore: finalScore,
      c2cStatus: job.c2cStatus,
      c2cEvidence: job.c2cEvidence,
      applicationStatus: 'queued',
      failureReason: null,
      questions: [],
      tailoredResumeText: tailoredText ?? startInput.resumeText,
      jobDescriptionSnapshot: job.description ?? null,
      location: job.location ?? null,
      confirmationNumber: null,
      confirmationText: null,
      submittedAt: null,
      masterResumeUnchanged: masterSnapshot === startInput.masterResumeText,
      sessionId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      applicationCapability: capability.capability,
      discoverySource: capability.discoverySource,
      applicationSource: capability.applicationSource,
      applicationProvider: capability.provider,
      initialUrl: applicationUrl,
      redirectUrls: [],
      finalApplicationUrl: null,
      preflight: staticPreflight,
    })
    added += 1
  }
  return { added, found: jobs.length, eligible, autoApplyCapable }
}

export async function startAutoApply(
  config: ServerConfig,
  input: AutoApplyStartInput,
  fetchImpl?: FetchLike,
  deps: AutoApplyEngineDeps = {},
): Promise<{ run: AutoApplyRun; items: AutoApplyQueueItem[] }> {
  const store = deps.store ?? memoryStore
  const automation = await getAutomationHealth({ probe: false })
  logApplyEvent('automation-health', {
    code: automation.available ? 'OK' : 'BROWSER_AUTOMATION_ERROR',
    error: automation.available ? undefined : automation.reason,
  })
  const createdAt = nowIso()
  const run: AutoApplyRun = {
    id: randomUUID(),
    userId: input.userId,
    status: 'running',
    config: {
      ...input.config,
      minimumMatchRate: normalizeMinimumMatchRate(input.config.minimumMatchRate),
      maxJobs: Math.min(25, Math.max(1, Math.round(input.config.maxJobs || 10))),
      concurrency: 1,
    },
    counts: emptyCounts(),
    createdAt,
    updatedAt: createdAt,
  }

  const jobs = await listCampaignJobs(config, input, fetchImpl, deps)
  const items: AutoApplyQueueItem[] = []
  const previous = await store.list(input.userId)
  const queued = enqueueEligibleJobs({ run, items, jobs, startInput: input, previous })

  run.counts = {
    ...recount(items),
    found: queued.found,
    eligible: queued.eligible,
    autoApplyCapable: queued.autoApplyCapable,
  }
  syncRunStatus(run, items)
  run.updatedAt = nowIso()
  rememberAutoApplyProfile(input.userId, input.profile)
  for (const item of items) rememberQueueResume(input.userId, item)
  await persistRun(store, run, items, config)
  notifyBrowserWorker()
  return { run, items }
}

export async function refreshAutoApplyRun(
  runId: string,
  config: ServerConfig,
  input: AutoApplyStartInput,
  fetchImpl?: FetchLike,
  deps: AutoApplyEngineDeps = {},
): Promise<{ run: AutoApplyRun; items: AutoApplyQueueItem[]; added: number } | null> {
  const store = deps.store ?? memoryStore
  const current = await loadCurrent(runId, store, config)
  if (!current) return null
  if (current.run.status === 'paused' || current.run.status === 'cancelled' || current.run.status === 'stopped') {
    return { run: current.run, items: current.items, added: 0 }
  }
  const jobs = await listCampaignJobs(config, input, fetchImpl, deps)
  const previous = await store.list(input.userId)
  const { added, found, eligible, autoApplyCapable } = enqueueEligibleJobs({
    run: current.run,
    items: current.items,
    jobs,
    startInput: input,
    previous,
  })
  current.run.counts = {
    ...recount(current.items),
    found: Math.max(current.run.counts.found, found),
    eligible: Math.max(current.run.counts.eligible, eligible),
    autoApplyCapable: Math.max(current.run.counts.autoApplyCapable, autoApplyCapable),
  }
  syncRunStatus(current.run, current.items)
  current.run.updatedAt = nowIso()
  rememberAutoApplyProfile(input.userId, input.profile)
  for (const item of current.items) rememberQueueResume(input.userId, item)
  await persistRun(store, current.run, current.items, config)
  if (added) notifyBrowserWorker()
  return { run: current.run, items: current.items, added }
}

export async function pauseRun(runId: string, deps: AutoApplyEngineDeps = {}, config?: ServerConfig) {
  const store = deps.store ?? memoryStore
  const current = await loadCurrent(runId, store, config)
  if (!current) throw new ApplyError(404, 'APPLICATION_NOT_FOUND')
  current.run.status = 'paused'
  current.run.updatedAt = nowIso()
  await persistRun(store, current.run, current.items, config)
  return current
}

export async function resumeRun(runId: string, deps: AutoApplyEngineDeps = {}, config?: ServerConfig) {
  const store = deps.store ?? memoryStore
  const current = await loadCurrent(runId, store, config)
  if (!current) throw new ApplyError(404, 'APPLICATION_NOT_FOUND')
  current.run.status = 'running'
  syncRunStatus(current.run, current.items)
  current.run.updatedAt = nowIso()
  await persistRun(store, current.run, current.items, config)
  notifyBrowserWorker()
  return current
}

function toResult(current: StoredRun, item: AutoApplyQueueItem): AutoApplyMutationResult {
  return { success: true as const, run: current.run, items: current.items, item }
}

async function loadCurrent(runId: string, store: AutoApplyStore, config?: ServerConfig): Promise<StoredRun | null> {
  return (await store.get(runId)) ?? loadRunFromDatabase(runId, config)
}

const PAUSED_PREPARE_STATUSES = new Set([
  'ready_for_submission',
  'submitting',
  'needs_user_input',
  'needs_user_confirmation',
  'captcha_required',
  'mfa_required',
  'login_required',
  'blocked',
])

const IN_PROGRESS_PREPARE_STATUSES = new Set(['preparing', 'filling', 'opening', 'tailoring'])

function isStuckPreparation(item: AutoApplyQueueItem, stuckMs: number, now = Date.now()) {
  if (!IN_PROGRESS_PREPARE_STATUSES.has(item.applicationStatus)) return false
  if (inFlightPrepares.has(prepareKey(item.runId, item.id))) return false
  const updated = Date.parse(item.updatedAt)
  if (!Number.isFinite(updated)) return true
  return now - updated > stuckMs
}

async function persistPrepared(
  store: AutoApplyStore,
  current: StoredRun,
  item: AutoApplyQueueItem,
  config: ServerConfig | undefined,
  timeouts: ApplyTimeouts,
  logSteps = false,
) {
  item.updatedAt = nowIso()
  current.run.counts = recountWithDiscovery(current.items, current.run.counts)
  syncRunStatus(current.run, current.items)
  current.run.updatedAt = nowIso()
  if (logSteps) logAutoApplyStep(13, 'Saving application state', { itemId: item.id, applicationStatus: item.applicationStatus })
  try {
    await withTimeout(
      persistRun(store, current.run, current.items, config),
      timeouts.databaseMs,
      'DATABASE_TIMEOUT',
      'Saving the application timed out.',
    )
  } catch (error) {
    logQueueItem('prepare-persist-error', item, { code: 'DATABASE_ERROR', error })
    if (!(isApplyError(error) && error.code === 'DATABASE_TIMEOUT')) {
      try {
        await withTimeout(
          store.save(current.run, current.items),
          timeouts.databaseMs,
          'DATABASE_TIMEOUT',
          'Saving the application timed out.',
        )
      } catch (memoryError) {
        logQueueItem('prepare-memory-persist-error', item, { code: 'DATABASE_ERROR', error: memoryError })
      }
    }
    if (isApplyError(error)) throw error
    throw new ApplyError(500, 'DATABASE_ERROR', undefined, { runId: current.run.id, itemId: item.id })
  }
  if (logSteps) logAutoApplyStep(14, 'Application state saved', { itemId: item.id, applicationStatus: item.applicationStatus })
}

function failItem(item: AutoApplyQueueItem, reason: string) {
  item.applicationStatus = 'failed'
  item.failureReason = reason
  item.sessionId = null
  item.updatedAt = nowIso()
}

function applyErrorFromUnknown(error: unknown): ApplyError {
  if (isApplyError(error)) return error
  const message = error instanceof Error ? error.message : 'Could not open the employer application.'
  if (/navigation|goto|net::|timeout/i.test(message) && /page|url|load|goto/i.test(message)) {
    return new ApplyError(504, 'BROWSER_NAVIGATION_TIMEOUT', 'The employer application page did not load within the allowed time.')
  }
  if (/launch|browser/i.test(message) && /timeout|timed out/i.test(message)) {
    return new ApplyError(504, 'BROWSER_LAUNCH_TIMEOUT', 'The browser did not start within the allowed time.')
  }
  return new ApplyError(500, 'BROWSER_AUTOMATION_ERROR', message)
}

export function failStuckPreparations(
  items: AutoApplyQueueItem[],
  stuckMs: number,
  now = Date.now(),
): AutoApplyQueueItem[] {
  for (const item of items) {
    if (isStuckPreparation(item, stuckMs, now)) {
      failItem(item, 'Application preparation timed out.')
    }
  }
  return items
}

export async function prepareQueueItem(
  runId: string,
  itemId: string,
  input: { profile: AutoApplyStartInput['profile']; html?: string; userId?: string | null },
  deps: AutoApplyEngineDeps = {},
  config?: ServerConfig,
) {
  const timeouts = mergeApplyTimeouts(deps.timeouts)
  const key = prepareKey(runId, itemId)
  const existing = inFlightPrepares.get(key)
  if (existing) {
    logAutoApplyStep(1, 'Apply request received', { runId, itemId, reused: true })
    return existing
  }
  const promise = withApplyLock(
    () => prepareQueueItemLocked(runId, itemId, input, deps, config, timeouts),
    timeouts.lockMs,
  ).finally(() => {
    if (inFlightPrepares.get(key) === promise) inFlightPrepares.delete(key)
  })
  inFlightPrepares.set(key, promise)
  return promise
}

async function prepareQueueItemLocked(
  runId: string,
  itemId: string,
  input: { profile: AutoApplyStartInput['profile']; html?: string; userId?: string | null },
  deps: AutoApplyEngineDeps,
  config: ServerConfig | undefined,
  timeouts: ApplyTimeouts,
) {
  logAutoApplyStep(1, 'Apply request received', { runId, itemId })
  const store = deps.store ?? memoryStore
  let current: StoredRun | null = null
  let item: AutoApplyQueueItem | undefined
  try {
    current = await withTimeout(
      loadCurrent(runId, store, config),
      timeouts.databaseMs,
      'DATABASE_TIMEOUT',
      'Saving the application timed out.',
    )
    if (!current) throw new ApplyError(404, 'APPLICATION_NOT_FOUND')
    item = current.items.find((entry) => entry.id === itemId)
    if (!item) throw new ApplyError(404, 'APPLICATION_NOT_FOUND')
    failStuckPreparations(current.items, timeouts.stuckMs)
    item = current.items.find((entry) => entry.id === itemId)
    if (!item) throw new ApplyError(404, 'APPLICATION_NOT_FOUND')
    logAutoApplyStep(2, 'Application loaded', { itemId: item.id, applicationStatus: item.applicationStatus })
    logAutoApplyStep(3, 'Resume version loaded', {
      itemId: item.id,
      resumeVersionName: item.resumeVersionName,
      reusedTailoredResume: /tailored/i.test(item.resumeVersionName) && Boolean(item.tailoredResumeText?.trim()),
    })
    logAutoApplyStep(4, 'Job loaded', { itemId: item.id, jobId: item.jobId })
    logQueueItem('prepare-start', item, { userId: input.userId ?? current.run.userId })
    if (item.applicationStatus === 'submitted') {
      logAutoApplyStep(15, 'Returning response', { itemId: item.id, applicationStatus: item.applicationStatus })
      return toResult(current, item)
    }
    if (PAUSED_PREPARE_STATUSES.has(item.applicationStatus)) {
      logAutoApplyStep(15, 'Returning response', { itemId: item.id, applicationStatus: item.applicationStatus })
      return toResult(current, item)
    }
    assertCanPrepareItem(item, { userId: input.userId, runUserId: current.run.userId })
    rememberAutoApplyProfile(current.run.userId, input.profile)
    rememberQueueResume(current.run.userId, item)
    if (!deps.browser && input.html == null) {
      item.applicationStatus = 'queued'
      item.failureReason = null
      item.sessionId = null
      await persistPrepared(store, current, item, config, timeouts)
      notifyBrowserWorker()
      const worker = getBrowserWorker()
      if (worker?.running()) {
        const finished = await waitForBrowserJob(item.id, timeouts.prepareMs)
        const latest = (await loadCurrent(runId, store, config)) ?? current
        const updated = latest.items.find((entry) => entry.id === itemId) ?? finished ?? item
        logAutoApplyStep(15, 'Returning response', { itemId: updated.id, applicationStatus: updated.applicationStatus })
        return toResult(latest, updated)
      }
      logAutoApplyStep(15, 'Returning response', { itemId: item.id, applicationStatus: item.applicationStatus })
      return toResult(current, item)
    }
    if (!deps.browser) {
      const automation = await getAutomationHealth({ probe: false })
      if (!automation.available) {
        item.applicationStatus = 'automation_blocked'
        item.failureReason =
          automation.reason ??
          'Browser automation is not available. JobPilot cannot open the employer application in this environment.'
        item.sessionId = null
        await persistPrepared(store, current, item, config, timeouts)
        logQueueItem('prepare-automation-unavailable', item, { code: 'BROWSER_AUTOMATION_UNAVAILABLE' })
        logAutoApplyStep(15, 'Returning response', { itemId: item.id, applicationStatus: item.applicationStatus })
        return toResult(current, item)
      }
    }
    item.applicationStatus = 'preparing'
    item.failureReason = null
    await persistPrepared(store, current, item, config, timeouts)
    logAutoApplyStep(5, 'Application preparation started', { itemId: item.id })
    const browser = deps.browser ?? createApplyBrowser({ timeouts })
    if (deps.delayMs ?? DEFAULT_DELAY_MS) await delay(deps.delayMs ?? DEFAULT_DELAY_MS)
    item.applicationStatus = 'filling'
    const prepared = await withTimeout(
      browser.prepare({
        url: item.applicationUrl || '',
        profile: input.profile,
        resumeText: item.tailoredResumeText,
        html: input.html,
      }),
      timeouts.prepareMs,
      'PREPARE_TIMEOUT',
      'Application preparation timed out.',
    )
    item.applicationStatus =
      prepared.status === 'submitted' || prepared.status === 'submitting'
        ? 'ready_for_submission'
        : prepared.status === 'preparing' || prepared.status === 'filling' || prepared.status === 'opening'
          ? 'failed'
          : prepared.status
    if (item.applicationStatus === 'failed' && !prepared.failureReason) {
      item.failureReason = 'Application preparation timed out.'
    } else {
      item.failureReason = prepared.failureReason
    }
    item.questions = prepared.questions
    item.sessionId = prepared.sessionId
    logAutoApplyStep(12, 'Preparation completed', { itemId: item.id, applicationStatus: item.applicationStatus })
    await persistPrepared(store, current, item, config, timeouts, true)
    logQueueItem('prepare-complete', item, { userId: current.run.userId })
    logAutoApplyStep(15, 'Returning response', { itemId: item.id, applicationStatus: item.applicationStatus })
    return toResult(current, item)
  } catch (error) {
    const applyError = applyErrorFromUnknown(error)
    if (current && item) {
      if (IN_PROGRESS_PREPARE_STATUSES.has(item.applicationStatus) || item.applicationStatus === 'ready' || item.applicationStatus === 'queued') {
        failItem(item, applyError.message)
      }
      try {
        await persistPrepared(store, current, item, config, timeouts)
      } catch (persistError) {
        failItem(item, applyError.message)
        try {
          await store.save(current.run, current.items)
        } catch {
          // Memory fallback is best-effort after a persist timeout.
        }
        logQueueItem('prepare-fail-persist-error', item, { code: 'DATABASE_ERROR', error: persistError })
      }
      applyError.details = {
        ...applyError.details,
        run: current.run,
        items: current.items,
        item,
        runId,
        itemId,
        jobId: item.jobId,
      }
    }
    logQueueItem('prepare-browser-error', item ?? { id: itemId, runId } as AutoApplyQueueItem, {
      code: applyError.code,
      error: applyError,
    })
    throw applyError
  }
}

export async function submitQueueItem(
  runId: string,
  itemId: string,
  deps: AutoApplyEngineDeps = {},
  config?: ServerConfig,
): Promise<{ run: AutoApplyRun; item: AutoApplyQueueItem } | null> {
  const timeouts = mergeApplyTimeouts(deps.timeouts)
  return withApplyLock(() => submitQueueItemLocked(runId, itemId, deps, config), timeouts.lockMs)
}

async function submitQueueItemLocked(
  runId: string,
  itemId: string,
  deps: AutoApplyEngineDeps = {},
  config?: ServerConfig,
) {
  const store = deps.store ?? memoryStore
  const current = await loadCurrent(runId, store, config)
  if (!current) throw new ApplyError(404, 'APPLICATION_NOT_FOUND')
  const item = current.items.find((entry) => entry.id === itemId)
  if (!item) throw new ApplyError(404, 'APPLICATION_NOT_FOUND')
  if (item.applicationStatus !== 'ready_for_submission') {
    return toResult(current, item)
  }
  item.applicationStatus = 'submitting'
  item.updatedAt = nowIso()
  const workerSubmitted = deps.browser ? null : await submitBrowserWorkerItem(item.id)
  const submitted = workerSubmitted
    ?? (await (deps.browser ?? createApplyBrowser()).submit(
      item.sessionId || (item.applicationUrl ? `filled:${item.applicationUrl}` : `open:${item.applicationUrl}`),
      {
        jobId: item.jobId,
        applicationId: item.applicationId,
        identityKey: item.identityKey,
        applicationUrl: item.applicationUrl,
      },
    ))
  item.applicationStatus = submitted.status === 'submitted' ? 'submitted' : submitted.status
  item.failureReason = submitted.failureReason
  item.sessionId = null
  item.updatedAt = nowIso()
  if (submitted.status === 'submitted') {
    applyConfirmationToQueueItem(item, {
      success: submitted.success !== false,
      confirmed: submitted.confirmationDetected !== false,
      detected: submitted.confirmationDetected !== false,
      confirmationNumber: submitted.confirmationNumber,
      confirmationText: submitted.confirmationText,
      finalUrl: submitted.resultingUrl,
    })
    if (item.applicationStatus === 'submitted') {
      await persistConfirmedSubmission({ userId: current.run.userId, item, config })
    }
  }
  current.run.counts = recountWithDiscovery(current.items, current.run.counts)
  syncRunStatus(current.run, current.items)
  current.run.updatedAt = nowIso()
  await persistRun(store, current.run, current.items, config)
  logQueueItem('submit-complete', item, { userId: current.run.userId })
  return toResult(current, item)
}

export async function skipQueueItem(
  runId: string,
  itemId: string,
  deps: AutoApplyEngineDeps = {},
  config?: ServerConfig,
) {
  return setItemStatus(runId, itemId, 'skipped', deps, config)
}

export async function cancelQueueItem(
  runId: string,
  itemId: string,
  deps: AutoApplyEngineDeps = {},
  config?: ServerConfig,
) {
  return setItemStatus(runId, itemId, 'cancelled', deps, config)
}

export async function cancelRun(
  runId: string,
  deps: AutoApplyEngineDeps = {},
  config?: ServerConfig,
) {
  const store = deps.store ?? memoryStore
  const current = await loadCurrent(runId, store, config)
  if (!current) throw new ApplyError(404, 'APPLICATION_NOT_FOUND')
  for (const item of current.items) {
    if (!['submitted', 'skipped', 'cancelled', 'failed'].includes(item.applicationStatus)) {
      item.applicationStatus = 'cancelled'
      item.updatedAt = nowIso()
    }
  }
  current.run.status = 'cancelled'
  current.run.counts = recountWithDiscovery(current.items, current.run.counts)
  current.run.updatedAt = nowIso()
  for (const item of current.items) releaseExtensionItem(current.run.userId, item.id)
  await persistRun(store, current.run, current.items, config)
  return current
}

export async function answerQueueItem(
  runId: string,
  itemId: string,
  answers: Array<{ id: string; answer: string }>,
  deps: AutoApplyEngineDeps = {},
  config?: ServerConfig,
) {
  const store = deps.store ?? memoryStore
  const current = await loadCurrent(runId, store, config)
  if (!current) throw new ApplyError(404, 'APPLICATION_NOT_FOUND')
  const item = current.items.find((entry) => entry.id === itemId)
  if (!item) throw new ApplyError(404, 'APPLICATION_NOT_FOUND')
  item.questions = item.questions.map((question) => {
    const next = answers.find((answer) => answer.id === question.id)
    return next ? { ...question, answer: next.answer, source: 'user' as const } : question
  })
  rememberUserAnswers(current.run.userId, item.questions)
  if (item.questions.every((question) => question.answer?.trim())) {
    item.applicationStatus = 'ready_for_submission'
  }
  item.updatedAt = nowIso()
  current.run.counts = recountWithDiscovery(current.items, current.run.counts)
  syncRunStatus(current.run, current.items)
  await persistRun(store, current.run, current.items, config)
  return toResult(current, item)
}

async function setItemStatus(
  runId: string,
  itemId: string,
  status: AutoApplyQueueItem['applicationStatus'],
  deps: AutoApplyEngineDeps,
  config?: ServerConfig,
) {
  const store = deps.store ?? memoryStore
  const current = await loadCurrent(runId, store, config)
  if (!current) throw new ApplyError(404, 'APPLICATION_NOT_FOUND')
  const item = current.items.find((entry) => entry.id === itemId)
  if (!item) throw new ApplyError(404, 'APPLICATION_NOT_FOUND')
  if (item.sessionId) await (deps.browser ?? createApplyBrowser()).close?.(item.sessionId)
  item.applicationStatus = status
  item.sessionId = null
  item.updatedAt = nowIso()
  current.run.counts = recountWithDiscovery(current.items, current.run.counts)
  syncRunStatus(current.run, current.items)
  current.run.updatedAt = nowIso()
  releaseExtensionItem(current.run.userId, item.id)
  await persistRun(store, current.run, current.items, config)
  return toResult(current, item)
}

export async function getAutoApplyRun(runId: string, deps: AutoApplyEngineDeps = {}, config?: ServerConfig) {
  const store = deps.store ?? memoryStore
  const current = await loadCurrent(runId, store, config)
  if (!current) return null
  const timeouts = mergeApplyTimeouts(deps.timeouts)
  const before = current.items.map((item) => item.applicationStatus).join('|')
  failStuckPreparations(current.items, timeouts.stuckMs)
  const after = current.items.map((item) => item.applicationStatus).join('|')
  if (before !== after) {
    current.run.counts = recountWithDiscovery(current.items, current.run.counts)
    syncRunStatus(current.run, current.items)
    current.run.updatedAt = nowIso()
    await persistRun(store, current.run, current.items, config)
  }
  return current
}

export async function listAutoApplyRuns(userId: string, deps: AutoApplyEngineDeps = {}, config?: ServerConfig) {
  const store = deps.store ?? memoryStore
  const memory = await store.list(userId)
  if (memory.length) return memory
  return loadRunsFromDatabase(userId, config)
}

export function defaultAutoApplyConfig(partial: Partial<AutoApplyConfig> = {}): AutoApplyConfig {
  return {
    maxJobs: 10,
    minimumMatchRate: 85,
    autoTailorResume: true,
    jobType: 'all',
    remotePreference: 'any',
    employmentType: 'any',
    keywords: [],
    jobTitles: [],
    excludedCompanies: [],
    q: '',
    country: 'US',
    state: '',
    location: '',
    concurrency: 1,
    ...partial,
  }
}
