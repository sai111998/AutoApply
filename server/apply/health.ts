import { existsSync } from 'node:fs'
import { BROWSER_LAUNCH_TIMEOUT_MS, PAGE_NAVIGATION_TIMEOUT_MS, withTimeout } from './timeouts'
import { inspectApplicationUrl } from './validate'

export type AutomationRuntime = 'node-server' | 'serverless'

export interface AutomationHealth {
  available: boolean
  playwright: boolean
  browser: 'chromium' | null
  runtime: AutomationRuntime
  reason?: string
}

export interface PlaywrightLike {
  chromium: {
    launch: (options?: { headless?: boolean; args?: string[] }) => Promise<{
      close: () => Promise<void>
      newPage: () => Promise<{
        goto: (url: string, options?: { waitUntil?: string; timeout?: number }) => Promise<unknown>
        title?: () => Promise<string>
        close?: () => Promise<unknown>
      }>
    }>
  }
}

export type PlaywrightLoader = () => Promise<PlaywrightLike | null>

const HEALTH_PAGE = 'https://example.com'
const CACHE_MS = 30_000

let cachedHealth: { at: number; value: AutomationHealth } | null = null

export function detectAutomationRuntime(
  env: NodeJS.ProcessEnv = process.env,
): AutomationRuntime {
  if (
    env.VERCEL ||
    env.VERCEL_ENV ||
    env.VERCEL_URL ||
    env.NOW_REGION ||
    env.AWS_LAMBDA_FUNCTION_NAME ||
    env.FUNCTION_TARGET ||
    env.FUNCTIONS_WORKER_RUNTIME ||
    env.LAMBDA_TASK_ROOT
  ) {
    return 'serverless'
  }
  return 'node-server'
}

export function needsChromiumSandboxWorkaround(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(
    env.CI ||
      env.PLAYWRIGHT_NO_SANDBOX === '1' ||
      process.getuid?.() === 0 ||
      existsSync('/.dockerenv'),
  )
}

export function chromiumLaunchOptions(env: NodeJS.ProcessEnv = process.env): {
  headless: true
  args: string[]
} {
  return {
    headless: true,
    args: needsChromiumSandboxWorkaround(env)
      ? ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
      : [],
  }
}

export const PLAYWRIGHT_MISSING_REASON =
  'Playwright is not installed. Run npm install && npm run playwright:install, then restart npm run dev.'

export async function importPlaywright(): Promise<PlaywrightLike | null> {
  try {
    return (await import('playwright')) as PlaywrightLike
  } catch (first) {
    try {
      const { createRequire } = await import('node:module')
      const require = createRequire(`${process.cwd()}/package.json`)
      const resolved = require.resolve('playwright')
      return (await import(resolved)) as PlaywrightLike
    } catch {
      if (process.env.NODE_ENV !== 'production') {
        const message = first instanceof Error ? first.message : String(first)
        console.info('[AutoApply] playwright-import-failed', {
          message: /secret|token|key|bearer/i.test(message) ? '[redacted]' : message.slice(0, 180),
        })
      }
      return null
    }
  }
}

export function userFacingBrowserError(error: unknown): string {
  const text = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  if (/executable doesn't exist|browserType\.launch|chromium/i.test(text) && /exist|download|install/i.test(text)) {
    return 'Chromium executable not found'
  }
  if (/executable doesn't exist/i.test(text)) return 'Chromium executable not found'
  if (/sandbox/i.test(text)) return 'Chromium could not launch in this environment.'
  if (/playwright/i.test(text) && /cannot find|not found|err_module/i.test(text)) {
    return 'Playwright is not installed'
  }
  return 'Browser automation is not available. JobPilot cannot open the employer application in this environment.'
}

export function serverlessAutomationReason(): string {
  return 'Browser automation requires the long-running Node API (npm run dev). This serverless runtime cannot keep a Playwright session.'
}

export async function getAutomationHealth(
  options: {
    probe?: boolean
    loadPlaywright?: PlaywrightLoader
    runtime?: AutomationRuntime
    now?: number
    useCache?: boolean
  } = {},
): Promise<AutomationHealth> {
  const now = options.now ?? Date.now()
  if (options.probe !== false && options.useCache !== false && cachedHealth && now - cachedHealth.at < CACHE_MS) {
    return cachedHealth.value
  }

  const runtime = options.runtime ?? detectAutomationRuntime()
  if (runtime === 'serverless') {
    const health: AutomationHealth = {
      available: false,
      playwright: false,
      browser: null,
      runtime,
      reason: serverlessAutomationReason(),
    }
    cachedHealth = { at: now, value: health }
    return health
  }

  const load = options.loadPlaywright ?? importPlaywright
  const playwright = await load()
  if (!playwright) {
    const health: AutomationHealth = {
      available: false,
      playwright: false,
      browser: null,
      runtime,
      reason: PLAYWRIGHT_MISSING_REASON,
    }
    cachedHealth = { at: now, value: health }
    return health
  }

  if (options.probe === false) {
    return {
      available: true,
      playwright: true,
      browser: 'chromium',
      runtime,
    }
  }

  try {
    const launched = await probeChromium(playwright)
    const health: AutomationHealth = launched.ok
      ? { available: true, playwright: true, browser: 'chromium', runtime }
      : {
          available: false,
          playwright: true,
          browser: null,
          runtime,
          reason: launched.reason,
        }
    cachedHealth = { at: now, value: health }
    return health
  } catch (error) {
    const health: AutomationHealth = {
      available: false,
      playwright: true,
      browser: null,
      runtime,
      reason: userFacingBrowserError(error),
    }
    cachedHealth = { at: now, value: health }
    return health
  }
}

export async function probeChromium(playwright: PlaywrightLike): Promise<{
  ok: boolean
  title?: string
  reason?: string
  closed: boolean
}> {
  const inspected = inspectApplicationUrl(HEALTH_PAGE)
  if (!inspected.ok) {
    return { ok: false, closed: true, reason: 'The browser health page is not a valid URL.' }
  }
  const browser = await withTimeout(
    playwright.chromium.launch(chromiumLaunchOptions()),
    BROWSER_LAUNCH_TIMEOUT_MS,
    'BROWSER_LAUNCH_TIMEOUT',
    'The browser did not start within the allowed time.',
  )
  let closed = false
  try {
    const page = await withTimeout(
      browser.newPage(),
      BROWSER_LAUNCH_TIMEOUT_MS,
      'BROWSER_LAUNCH_TIMEOUT',
      'The browser did not start within the allowed time.',
    )
    await withTimeout(
      page.goto(HEALTH_PAGE, { waitUntil: 'domcontentloaded', timeout: PAGE_NAVIGATION_TIMEOUT_MS }),
      PAGE_NAVIGATION_TIMEOUT_MS,
      'BROWSER_NAVIGATION_TIMEOUT',
      'The employer application page did not load within the allowed time.',
    )
    const title = (await page.title?.()) ?? ''
    await page.close?.()
    await browser.close()
    closed = true
    if (!title.trim()) {
      return { ok: false, closed, reason: 'Chromium launched but the health page could not be read.' }
    }
    return { ok: true, title, closed }
  } catch (error) {
    try {
      await browser.close()
      closed = true
    } catch {
      closed = false
    }
    return { ok: false, closed, reason: userFacingBrowserError(error) }
  }
}

export function resetAutomationHealthCache() {
  cachedHealth = null
}

export function publicAutomationHealth(health: AutomationHealth): AutomationHealth {
  return {
    available: health.available,
    playwright: health.playwright,
    browser: health.browser,
    runtime: health.runtime,
    ...(health.reason ? { reason: health.reason } : {}),
  }
}
