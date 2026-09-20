import { mergeApplyTimeouts } from '../apply/timeouts'
import { getStoredProfile } from '../extension/profile-store'
import { memoryStore, persistRun } from '../apply/store'
import type { AutoApplyQueueItem, BrowserSubmitResult } from '../apply/types'
import { runApplicationAgent } from '../application/agent'
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
  const profile = getStoredProfile(userId) ?? profileForJob(userId, item).profile
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
    await persistBrowserJob(stored, item)
    if (['captcha_required', 'mfa_required', 'login_required', 'needs_user_input', 'ready_for_submission', 'needs_user_confirmation'].includes(item.applicationStatus)) {
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
      if (worker === instance) worker = null
    },
  }
  worker = instance
  return instance
}

export async function startEmbeddedWorker(options: BrowserWorkerOptions = {}) {
  if (process.env.JOBPILOT_EMBED_WORKER === '0') return null
  if (process.env.VITEST === 'true') return null
  const instance = worker ?? (await createBrowserWorker(options))
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
  const confirmed = submitted && adapter.detectConfirmation({ html: confirmationHtml, title, url: confirmationUrl })
  livePages.delete(itemId)
  await live.close().catch(() => undefined)
  if (!confirmed) {
    markBrowserSessionState(itemId, 'failed', {
      currentUrl: confirmationUrl,
      failureReason: 'Submission could not be confirmed on the employer site.',
    })
    return {
      status: 'failed',
      failureReason: 'Submission could not be confirmed on the employer site.',
      confirmationDetected: false,
      success: false,
    }
  }
  markBrowserSessionState(itemId, 'submitted', { currentUrl: confirmationUrl })
  return {
    status: 'submitted',
    failureReason: null,
    confirmationDetected: true,
    success: true,
    resultingUrl: confirmationUrl,
    pageTitle: title,
    finalActionCompleted: true,
  }
}

export { notifyBrowserWorker, waitForBrowserJob, resolveUserIntervention, getBrowserApplicationSession }
