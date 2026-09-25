import type { Browser, BrowserContext, Page } from 'playwright'
import { existsSync } from 'node:fs'
import { V2Error } from './errors'
import { logV2 } from './log'

export interface V2BrowserHandle {
  browser: Browser
  context: BrowserContext
  page: Page
  close: () => Promise<void>
}

export async function isV2BrowserAvailable(): Promise<boolean> {
  try {
    const { chromium } = await import('playwright')
    return existsSync(chromium.executablePath())
  } catch {
    return false
  }
}

export async function launchV2Browser(headless = true): Promise<V2BrowserHandle> {
  let playwright: typeof import('playwright')
  try {
    playwright = await import('playwright')
  } catch {
    throw new V2Error('BROWSER_UNAVAILABLE', 'Playwright is not installed.', 503)
  }
  let browser: Browser
  try {
    browser = await playwright.chromium.launch({
      headless,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
      timeout: 30000,
    })
  } catch (error) {
    throw new V2Error(
      'BROWSER_UNAVAILABLE',
      error instanceof Error ? `Chromium launch failed: ${error.message}` : 'Chromium launch failed.',
      503,
    )
  }
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
    javaScriptEnabled: true,
  })
  const page = await context.newPage()
  page.setDefaultTimeout(8000)
  page.setDefaultNavigationTimeout(16000)
  logV2('BROWSER_STARTED', { headless })
  return {
    browser,
    context,
    page,
    close: async () => {
      try {
        await context.close()
      } finally {
        await browser.close()
      }
    },
  }
}
