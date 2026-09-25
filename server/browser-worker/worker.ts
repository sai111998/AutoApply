import { mergeApplyTimeouts } from '../apply/timeouts'
import { getStoredProfile } from '../extension/profile-store'
import { memoryStore, persistRun } from '../apply/store'
import { detectSubmissionConfirmation } from '../apply/confirm'
import { persistConfirmedSubmission, applyConfirmationToQueueItem } from '../apply/confirmed'
import { getServerConfig } from '../config'
import type { AutoApplyQueueItem, BrowserSubmitResult } from '../apply/types'
import { runApplicationAgent } from '../application/agent'
import { runExecutionBrowser } from './browser'
import { isIsolatedRealEmployerUrl, isSyntheticExecutionUrl, isolateRealEmployerItem } from '../agent/worker'
import { logExecution } from '../agent/campaign'
import { persistExecutionState } from '../agent/state'
import { recoverStuckBrowserJobs } from './recovery'
import { resolveUserIntervention } from './intervention'
import { getBrowserApplicationSession, listBrowserApplicationSessions, markBrowserSessionState } from './session'
import {
  claimNextBrowserJob,
  notifyBrowserWorker,
  onBrowserWorkerWake,
  persistBrowserJob,
  profileForJob,
  releaseBrowserJob,
  resetBrowserWorkerQueueForTests,
  waitForBrowserJob,
} from './queue'
import { launchPersistentBrowser, resetBrowserRuntimeForTests, type PersistentBrowserRuntime } from './runtime'
import { detectAtsAdapter } from './providers'
import { startWorkerHeartbeatLoop, stopWorkerHeartbeatLoop, touchWorkerHeartbeat } from '../automation/heartbeat'

const livePages = new Map<string, { close: () => Promise<void>; page: import('./types').BrowserPageLike }>()

export interface BrowserWorkerOptions {
  headless?: boolean
  userDataDir?: string
  autoSubmit?: boolean
  pollMs?: number
}

export interface BrowserWorker {
  start(): Promise<void>
  stop(): Promise<void>
  processOnce(): Promise<AutoApplyQueueItem | null>
  running(): boolean
}

let worker: BrowserWorker | null = null
let loop: Promise<void> | null = null
let stopped = true
let processing = false

export function getBrowserWorker(): BrowserWorker | null {
  return worker
}

export async function resetBrowserWorkerForTests() {
  worker = null
  loop = null
  stopped = true
  processing = false
  livePages.clear()
  stopWorkerHeartbeatLoop(false)
  resetBrowserWorkerQueueForTests()
  await resetBrowserRuntimeForTests()
}

async function runClaimedJob(
  runtime: PersistentBrowserRuntime,
  claimed: NonNullable<Awaited<ReturnType<typeof claimNextBrowserJob>>>,
  options: BrowserWorkerOptions,
): Promise<AutoApplyQueueItem> {
  const { stored, item } = claimed
  const userId = stored.run.userId
  if (isIsolatedRealEmployerUrl(item.applicationUrl)) {
    isolateRealEmployerItem(item)
    await persistBrowserJob(stored, item)
    releaseBrowserJob(item.id)
    return item
  }
  if (isSyntheticExecutionUrl(item.applicationUrl)) {
    logExecution('WORKER_PICKED_UP')
    persistExecutionState(item.id, 'opening')
    const result = await runExecutionBrowser({ item, userId })
    item.applicationStatus = result.status === 'needs_confirmation' ? 'needs_confirmation' : result.status
    item.failureReason = result.failureReason
    item.confirmationNumber = result.confirmationNumber
    item.confirmationText = result.confirmationText
    item.finalApplicationUrl = result.finalUrl
    if (result.status === 'submitted') {
      item.submittedAt = new Date().toISOString()
      item.applicationUrl = result.finalUrl
      await persistBrowserJob(stored, item)
      await persistConfirmedSubmission({ userId, item, provider: 'synthetic', config: getServerConfig() })
      logExecution('APPLICATION_PERSISTED')
    } else {
      await persistBrowserJob(stored, item)
    }
    releaseBrowserJob(item.id)
    return item
  }
  const profile = profileForJob(userId, item).profile ?? getStoredProfile(userId)
  if (!profile) {
    item.applicationStatus = 'failed'
    item.failureReason = 'The JobPilot profile required for this application is missing.'
    await persistBrowserJob(stored, item)
    releaseBrowserJob(item.id)
    return item
  }
  const opened = await runtime.newPage()
  try {
    const resume = profileForJob(userId, item).resume
    if (resume?.text) item.tailoredResumeText = resume.text
    const result = await runApplicationAgent({
      item,
      userId,
      profile,
      page: opened.page,
      pageId: opened.id,
      contextId: runtime.contextId,
      autoSubmit: options.autoSubmit,
    })
    item.applicationStatus = result.status
    item.failureReason = result.failureReason
    item.questions = result.questions
    item.sessionId = result.session.pageId
    if (result.confirmation) {
      applyConfirmationToQueueItem(item, {
        ...result.confirmation,
        detected: Boolean(result.confirmation.detected ?? result.confirmation.confirmed),
      })
    }
    await persistBrowserJob(stored, item)
    if (item.applicationStatus === 'submitted') {
      await persistConfirmedSubmission({ userId, item, provider: result.session.provider, config: getServerConfig() })
    }
    if (['captcha_required', 'mfa_required', 'login_required', 'needs_user_input', 'ready_for_submission', 'needs_user_confirmation', 'needs_confirmation'].includes(item.applicationStatus)) {
      livePages.set(item.id, opened)
    } else {
      await opened.close()
    }
    releaseBrowserJob(item.id)
    return item
  } catch (error) {
    item.applicationStatus = 'failed'
    item.failureReason = error instanceof Error ? error.message : 'The browser worker could not complete this application.'
    await persistBrowserJob(stored, item)
    await opened.close().catch(() => undefined)
    releaseBrowserJob(item.id)
    return item
  }
}

export async function createBrowserWorker(options: BrowserWorkerOptions = {}): Promise<BrowserWorker> {
  const runtime = await launchPersistentBrowser({
    headless: options.headless,
    userDataDir: options.userDataDir,
  })
  const instance: BrowserWorker = {
    running: () => !stopped,
    async start() {
      if (!stopped && loop) return
      stopped = false
      startWorkerHeartbeatLoop()
      const runs = memoryStore.listAll ? await memoryStore.listAll() : []
      for (const stored of runs) {
        recoverStuckBrowserJobs(stored.items, {
          stuckMs: mergeApplyTimeouts().stuckMs,
          liveItemIds: new Set(listBrowserApplicationSessions().map((session) => session.itemId)),
        })
        stored.run.updatedAt = new Date().toISOString()
        await persistRun(memoryStore, stored.run, stored.items)
      }
      loop = (async () => {
        while (!stopped) {
          touchWorkerHeartbeat()
          await instance.processOnce()
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, options.pollMs ?? 750)
            onBrowserWorkerWake(() => {
              clearTimeout(timer)
              resolve()
            })
          })
        }
      })()
    },
    async processOnce() {
      if (processing) return null
      processing = true
      try {
        const claimed = await claimNextBrowserJob()
        if (!claimed) return null
        return await runClaimedJob(runtime, claimed, options)
      } finally {
        processing = false
      }
    },
    async stop() {
      stopped = true
      notifyBrowserWorker()
      await loop?.catch(() => undefined)
      loop = null
      await runtime.close()
      stopWorkerHeartbeatLoop()
      if (worker === instance) worker = null
    },
  }
  worker = instance
  return instance
}

export async function startEmbeddedWorker(options: BrowserWorkerOptions = {}) {
  if (process.env.JOBPILOT_EMBED_WORKER === '0') return null
  if (process.env.VITEST === 'true') return null
  const instance = worker ?? (await createBrowserWorker({ headless: true, ...options }))
  await instance.start()
  return instance
}

export async function submitBrowserWorkerItem(itemId: string): Promise<BrowserSubmitResult | null> {
  const live = livePages.get(itemId)
  if (!live) return null
  const html = await live.page.content()
  const url = typeof live.page.url === 'function' ? live.page.url() : live.page.url || ''
  const adapter = detectAtsAdapter({ url, html })
  markBrowserSessionState(itemId, 'submitting', { currentUrl: url })
  const submitted = await adapter.submit(live.page)
  await live.page.waitForLoadState?.('domcontentloaded', { timeout: 8_000 }).catch(() => undefined)
  const confirmationHtml = await live.page.content()
  const title = (await live.page.title?.()) ?? ''
  const confirmationUrl = typeof live.page.url === 'function' ? live.page.url() : live.page.url || url
  const confirmation = detectSubmissionConfirmation({ html: confirmationHtml, title, url: confirmationUrl, provider: adapter.id })
  livePages.delete(itemId)
  await live.close().catch(() => undefined)
  if (!submitted || !confirmation.confirmed) {
    markBrowserSessionState(itemId, 'failed', {
      currentUrl: confirmationUrl,
      failureReason: confirmation.reason ?? 'Submission could not be confirmed on the employer site.',
    })
    return {
      status: submitted ? 'needs_confirmation' : 'failed',
      failureReason: confirmation.reason ?? 'Submission could not be confirmed on the employer site.',
      confirmationDetected: false,
      success: false,
      confirmationNumber: confirmation.confirmationNumber,
      confirmationText: confirmation.confirmationText,
      resultingUrl: confirmationUrl,
      pageTitle: title,
      finalActionCompleted: submitted,
    }
  }
  markBrowserSessionState(itemId, 'submitted', { currentUrl: confirmationUrl })
  return {
    status: 'submitted',
    failureReason: null,
    confirmationDetected: true,
    success: true,
    confirmationNumber: confirmation.confirmationNumber,
    confirmationText: confirmation.confirmationText,
    resultingUrl: confirmationUrl,
    pageTitle: title,
    finalActionCompleted: true,
  }
}

export { notifyBrowserWorker, waitForBrowserJob, resolveUserIntervention, getBrowserApplicationSession }
