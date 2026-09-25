import type { Browser, BrowserContext, Page } from 'playwright'
import { existsSync } from 'node:fs'
import { V2Error } from './errors'

export interface V2BrowserHandle {
  browser: Browser
  context: BrowserContext
  page: Page
  close: () => Promise<void>
}

export interface V2OpenResult {
  finalUrl: string
  redirectChain: string[]
  title: string
  html: string
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
  console.log('[V2] BROWSER_STARTED headless=' + headless)
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

export async function openV2Url(page: Page, url: string, timeoutMs = 16000): Promise<V2OpenResult> {
  const redirectChain: string[] = [url]
  const onResponse = (response: { url: () => string; status: () => number }) => {
    try {
      const responseUrl = response.url()
      const status = response.status()
      if (status >= 300 && status < 400 && responseUrl && redirectChain.at(-1) !== responseUrl) {
        redirectChain.push(responseUrl)
      }
    } catch {
      // ignore redirect tracking failures
    }
  }
  page.on('response', onResponse)
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs })
  } catch (error) {
    page.off('response', onResponse)
    throw new V2Error(
      'APPLICATION_PAGE_NOT_FOUND',
      error instanceof Error ? `Navigation to ${url} failed: ${error.message}` : 'Navigation failed.',
      502,
    )
  } finally {
    page.off('response', onResponse)
  }
  const finalUrl = page.url()
  if (redirectChain.at(-1) !== finalUrl) redirectChain.push(finalUrl)
  let title = ''
  let html = ''
  try {
    title = await page.title()
  } catch {
    title = ''
  }
  try {
    html = await page.content()
  } catch {
    html = ''
  }
  console.log(`[V2] JOB_PAGE_OPENED finalUrl=${finalUrl} titleChars=${title.length}`)
  return { finalUrl, redirectChain, title, html }
}
