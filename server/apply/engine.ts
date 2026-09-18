import { randomUUID } from 'node:crypto'
import { conservativeTailor } from '../tailor/engine'
import { tailoredResumeToText } from '../tailor/match-optimize'
import { listLiveJobs, type LiveJobsRequest } from '../jobs/list'
import type { ServerConfig } from '../config'
import type { FetchLike } from '../jobs/http'
import { createApplyBrowser } from './browser'
import {
  applicationIdentity,
  isEligibleForAutoApply,
  jobApplicationUrl,
} from './eligibility'
import type {
  ApplyBrowser,
  AutoApplyConfig,
  AutoApplyCounts,
  AutoApplyQueueItem,
  AutoApplyRun,
  AutoApplyStartInput,
  ListedAutoApplyJob,
} from './types'
import { memoryStore, persistRun, type AutoApplyStore } from './store'

const MATCH_PRESETS = [70, 75, 80, 85, 90, 95]
const DEFAULT_DELAY_MS = 250

let applyChain: Promise<unknown> = Promise.resolve()

function withApplyLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = applyChain.then(fn, fn)
  applyChain = next.then(() => undefined, () => undefined)
  return next
}

export function normalizeMinimumMatchRate(value: number): number {
  if (!Number.isFinite(value)) return 85
  const rounded = Math.round(value)
  return Math.min(99, Math.max(50, rounded))
}

export function suggestedMatchRates(): number[] {
  return [...MATCH_PRESETS]
}

function emptyCounts(): AutoApplyCounts {
  return {
    found: 0,
    eligible: 0,
    tailored: 0,
    ready: 0,
    needsInput: 0,
    submitted: 0,
    skipped: 0,
    failed: 0,
  }
}

export function recount(items: AutoApplyQueueItem[]): AutoApplyCounts {
  const counts = emptyCounts()
  counts.found = items.length
  for (const item of items) {
    if (
      item.applicationStatus !== 'failed' &&
      item.applicationStatus !== 'skipped' &&
      item.applicationStatus !== 'cancelled'
    ) {
      counts.eligible += 1
    }
    if (item.resumeVersionName.toLowerCase().includes('tailored')) counts.tailored += 1
    if (item.applicationStatus === 'ready' || item.applicationStatus === 'ready_for_submission') counts.ready += 1
    if (
      item.applicationStatus === 'needs_user_input' ||
      item.applicationStatus === 'captcha_required' ||
      item.applicationStatus === 'mfa_required'
    ) {
      counts.needsInput += 1
    }
    if (item.applicationStatus === 'submitted') counts.submitted += 1
    if (item.applicationStatus === 'skipped') counts.skipped += 1
    if (item.applicationStatus === 'failed' || item.applicationStatus === 'blocked') counts.failed += 1
  }
  return counts
}

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
}

export async function startAutoApply(
  config: ServerConfig,
  input: AutoApplyStartInput,
  fetchImpl?: FetchLike,
  deps: AutoApplyEngineDeps = {},
): Promise<{ run: AutoApplyRun; items: AutoApplyQueueItem[] }> {
  const store = deps.store ?? memoryStore
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

  const listJobs =
    deps.listJobs ??
    (async (request: LiveJobsRequest) => listLiveJobs(config, request, fetchImpl))
  const listed = await listJobs({
    q: input.config.q,
    country: input.config.country || 'US',
    state: input.config.state,
    location: input.config.location,
    remote: input.config.remotePreference,
    employmentType: 'any',
    seniority: '',
    page: 1,
    limit: 50,
    resumeText: input.resumeText,
    resumeVersionId: input.resumeVersionId ?? undefined,
    sort: 'match',
    jobType: input.config.jobType,
  })

  const keywords = input.config.keywords.map((item) => item.trim().toLowerCase()).filter(Boolean)
  const jobs = listed.jobs.filter((job) => {
    if (!keywords.length) return true
    const haystack = `${job.title} ${job.company} ${job.description ?? ''}`.toLowerCase()
    return keywords.every((keyword) => haystack.includes(keyword))
  })

  const masterSnapshot = input.masterResumeText
  const items: AutoApplyQueueItem[] = []
  const previous = await store.list(input.userId)
  const queueIdentities = [
    ...(input.existingQueueIdentities ?? []),
    ...previous.flatMap((entry) =>
      entry.items
        .filter((item) => !['skipped', 'cancelled', 'failed', 'submitted'].includes(item.applicationStatus))
        .map((item) => item.identityKey),
    ),
  ]
  let found = jobs.length

  for (const job of jobs) {
    if (items.length >= run.config.maxJobs) break
    const initial = job.match?.score ?? job.matchScore ?? null
    let finalScore = initial
    let tailoredText: string | null = null
    let resumeVersionId: string | null = input.resumeVersionId
    let resumeVersionName = 'Master'
    const timestamp = nowIso()

    if (input.config.autoTailorResume) {
      const tailored = tailorForJob({ resumeText: input.resumeText, job })
      finalScore = tailored.score
      tailoredText = tailored.text
      resumeVersionId = randomUUID()
      resumeVersionName = `Tailored v1 — ${job.title}`
    }

    const eligibility = isEligibleForAutoApply(job, {
      minimumMatchRate: run.config.minimumMatchRate,
      finalMatchScore: finalScore,
      existingApplications: input.existingApplications,
      existingQueueIdentities: queueIdentities,
    })
    if (!eligibility.ok) continue

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
      title: job.title,
      company: job.company,
      applicationUrl: jobApplicationUrl(job),
      initialMatchScore: initial,
      finalMatchScore: finalScore,
      c2cStatus: job.c2cStatus,
      c2cEvidence: job.c2cEvidence,
      applicationStatus: 'ready',
      failureReason: null,
      questions: [],
      tailoredResumeText: tailoredText ?? input.resumeText,
      masterResumeUnchanged: masterSnapshot === input.masterResumeText,
      sessionId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
  }

  run.counts = { ...recount(items), found }
  run.status = items.length ? 'paused' : 'completed'
  run.updatedAt = nowIso()
  await persistRun(store, run, items, config)
  return { run, items }
}

export async function prepareQueueItem(
  runId: string,
  itemId: string,
  input: { profile: AutoApplyStartInput['profile']; html?: string },
  deps: AutoApplyEngineDeps = {},
  config?: ServerConfig,
): Promise<{ run: AutoApplyRun; item: AutoApplyQueueItem } | null> {
  return withApplyLock(() => prepareQueueItemLocked(runId, itemId, input, deps, config))
}

async function prepareQueueItemLocked(
  runId: string,
  itemId: string,
  input: { profile: AutoApplyStartInput['profile']; html?: string },
  deps: AutoApplyEngineDeps = {},
  config?: ServerConfig,
): Promise<{ run: AutoApplyRun; item: AutoApplyQueueItem } | null> {
  const store = deps.store ?? memoryStore
  const current = await store.get(runId)
  if (!current) return null
  const item = current.items.find((entry) => entry.id === itemId)
  if (!item) return null
  if (item.applicationStatus === 'submitted' || item.applicationStatus === 'cancelled') {
    return { run: current.run, item }
  }
  item.applicationStatus = 'opening'
  item.updatedAt = nowIso()
  const browser = deps.browser ?? createApplyBrowser()
  if (deps.delayMs ?? DEFAULT_DELAY_MS) await delay(deps.delayMs ?? DEFAULT_DELAY_MS)
  item.applicationStatus = 'filling'
  const prepared = await browser.prepare({
    url: item.applicationUrl || '',
    profile: input.profile,
    resumeText: item.tailoredResumeText,
    html: input.html,
  })
  item.applicationStatus = prepared.status
  item.questions = prepared.questions
  item.failureReason = prepared.failureReason
  item.sessionId = prepared.sessionId
  item.updatedAt = nowIso()
  current.run.counts = { ...recount(current.items), found: current.run.counts.found }
  current.run.updatedAt = nowIso()
  await persistRun(store, current.run, current.items, config)
  return { run: current.run, item }
}

export async function submitQueueItem(
  runId: string,
  itemId: string,
  deps: AutoApplyEngineDeps = {},
  config?: ServerConfig,
): Promise<{ run: AutoApplyRun; item: AutoApplyQueueItem } | null> {
  return withApplyLock(() => submitQueueItemLocked(runId, itemId, deps, config))
}

async function submitQueueItemLocked(
  runId: string,
  itemId: string,
  deps: AutoApplyEngineDeps = {},
  config?: ServerConfig,
): Promise<{ run: AutoApplyRun; item: AutoApplyQueueItem } | null> {
  const store = deps.store ?? memoryStore
  const current = await store.get(runId)
  if (!current) return null
  const item = current.items.find((entry) => entry.id === itemId)
  if (!item) return null
  if (item.applicationStatus !== 'ready_for_submission') {
    return { run: current.run, item }
  }
  const browser = deps.browser ?? createApplyBrowser()
  const sessionId = item.sessionId || (item.applicationUrl ? `filled:${item.applicationUrl}` : `open:${item.applicationUrl}`)
  const submitted = await browser.submit(sessionId)
  item.applicationStatus = submitted.status === 'submitted' ? 'submitted' : submitted.status
  item.failureReason = submitted.failureReason
  item.sessionId = null
  item.updatedAt = nowIso()
  current.run.counts = { ...recount(current.items), found: current.run.counts.found }
  current.run.updatedAt = nowIso()
  if (current.items.every((entry) => ['submitted', 'skipped', 'cancelled', 'failed', 'blocked'].includes(entry.applicationStatus))) {
    current.run.status = 'completed'
  }
  await persistRun(store, current.run, current.items, config)
  return { run: current.run, item }
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
  const current = await store.get(runId)
  if (!current) return null
  for (const item of current.items) {
    if (!['submitted', 'skipped', 'cancelled', 'failed'].includes(item.applicationStatus)) {
      item.applicationStatus = 'cancelled'
      item.updatedAt = nowIso()
    }
  }
  current.run.status = 'cancelled'
  current.run.counts = { ...recount(current.items), found: current.run.counts.found }
  current.run.updatedAt = nowIso()
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
  const current = await store.get(runId)
  if (!current) return null
  const item = current.items.find((entry) => entry.id === itemId)
  if (!item) return null
  item.questions = item.questions.map((question) => {
    const next = answers.find((answer) => answer.id === question.id)
    return next ? { ...question, answer: next.answer, source: 'user' as const } : question
  })
  if (item.questions.every((question) => question.answer?.trim())) {
    item.applicationStatus = 'ready_for_submission'
  }
  item.updatedAt = nowIso()
  current.run.counts = { ...recount(current.items), found: current.run.counts.found }
  await persistRun(store, current.run, current.items, config)
  return { run: current.run, item }
}

async function setItemStatus(
  runId: string,
  itemId: string,
  status: AutoApplyQueueItem['applicationStatus'],
  deps: AutoApplyEngineDeps,
  config?: ServerConfig,
) {
  const store = deps.store ?? memoryStore
  const current = await store.get(runId)
  if (!current) return null
  const item = current.items.find((entry) => entry.id === itemId)
  if (!item) return null
  if (item.sessionId) await (deps.browser ?? createApplyBrowser()).close?.(item.sessionId)
  item.applicationStatus = status
  item.sessionId = null
  item.updatedAt = nowIso()
  current.run.counts = { ...recount(current.items), found: current.run.counts.found }
  current.run.updatedAt = nowIso()
  await persistRun(store, current.run, current.items, config)
  return { run: current.run, item }
}

export async function getAutoApplyRun(runId: string, deps: AutoApplyEngineDeps = {}) {
  const store = deps.store ?? memoryStore
  return store.get(runId)
}

export async function listAutoApplyRuns(userId: string, deps: AutoApplyEngineDeps = {}) {
  const store = deps.store ?? memoryStore
  return store.list(userId)
}

export function defaultAutoApplyConfig(partial: Partial<AutoApplyConfig> = {}): AutoApplyConfig {
  return {
    maxJobs: 10,
    minimumMatchRate: 85,
    autoTailorResume: true,
    jobType: 'all',
    remotePreference: 'any',
    keywords: [],
    q: '',
    country: 'US',
    state: '',
    location: '',
    concurrency: 1,
    ...partial,
  }
}
