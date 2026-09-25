import { chromiumLaunchOptions } from '../apply/health'
import { ensureBrowserProfileDirectory, isHeadlessBrowser } from './profile'
import type { BrowserPageLike } from './types'

export interface PersistentBrowserRuntime {
  contextId: string
  userDataDir: string
  newPage(): Promise<BrowserRuntimePage>
  close(): Promise<void>
}

export interface BrowserRuntimePage {
  id: string
  page: BrowserPageLike
  close(): Promise<void>
}

type PersistentContext = {
  newPage: () => Promise<BrowserPageLike & { close?: () => Promise<unknown> }>
  close: () => Promise<void>
}

let runtime: PersistentBrowserRuntime | null = null
let context: PersistentContext | null = null
let pageSeq = 0

export async function resetBrowserRuntimeForTests() {
  try {
    await context?.close()
  } catch {
    // Tests should not fail because Chromium is already closed.
  }
  runtime = null
  context = null
  pageSeq = 0
}

export async function launchPersistentBrowser(options: { userDataDir?: string; headless?: boolean } = {}): Promise<PersistentBrowserRuntime> {
  if (runtime && context) return runtime
  const playwright = await import('playwright')
  const userDataDir = options.userDataDir ?? ensureBrowserProfileDirectory()
  const headless = options.headless ?? isHeadlessBrowser()
  context = (await playwright.chromium.launchPersistentContext(userDataDir, {
    ...chromiumLaunchOptions(),
    headless,
  })) as unknown as PersistentContext
  runtime = {
    contextId: `ctx-${userDataDir}`,
    userDataDir,
    async newPage() {
      if (!context) throw new Error('The browser worker is not running.')
      const page = await context.newPage()
      pageSeq += 1
      const id = `page-${pageSeq}`
      return {
        id,
        page,
        async close() {
          if (page.close) await page.close()
        },
      }
    },
    async close() {
      const current = context
      runtime = null
      context = null
      await current?.close()
    },
  }
  return runtime
}

export function getPersistentBrowserRuntime(): PersistentBrowserRuntime | null {
  return runtime
}

export async function probeBrowserLaunch(): Promise<{ ok: boolean; reason?: string }> {
  try {
    if (runtime) return { ok: true }
    const instance = await launchPersistentBrowser({ headless: true })
    const opened = await instance.newPage()
    await opened.close()
    return { ok: true }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'Chromium could not launch.' }
  }
}
