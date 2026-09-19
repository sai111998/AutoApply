import {
  detectSubmissionConfirmation,
  inspectPostSubmitPage,
  isFinalSubmitLabel,
  logExternalSubmit,
  safeEmployerHost,
  type BrowserSubmitContext,
  type ExternalSubmissionResult,
} from './confirm'
import { inspectApplicationPage } from './detect'
import { ApplyError, isApplyError } from './errors'
import {
  chromiumLaunchOptions,
  detectAutomationRuntime,
  getAutomationHealth,
  importPlaywright,
  PLAYWRIGHT_MISSING_REASON,
  serverlessAutomationReason,
  userFacingBrowserError,
  type PlaywrightLoader,
} from './health'
import { logAutoApplyStep } from './log'
import { resolveApplicationQuestions } from './questions'
import { mergeApplyTimeouts, withTimeout, type ApplyTimeouts } from './timeouts'
import type { ApplyBrowser, BrowserPrepareInput, BrowserPrepareResult, BrowserSubmitResult } from './types'
import { inspectApplicationUrl } from './validate'

type PlaywrightLocatorHandle = {
  count?: () => Promise<number>
  fill?: (value: string) => Promise<unknown>
  click?: (options?: { timeout?: number }) => Promise<unknown>
  setInputFiles?: (files: unknown) => Promise<unknown>
  innerText?: () => Promise<string>
  getAttribute?: (name: string) => Promise<string | null>
}

type PlaywrightLocator = PlaywrightLocatorHandle & {
  first: () => PlaywrightLocatorHandle
}

export type PlaywrightPage = {
  goto: (url: string, options?: { waitUntil?: string; timeout?: number }) => Promise<unknown>
  content: () => Promise<string>
  url?: (() => string) | string
  title?: () => Promise<string>
  waitForLoadState?: (state?: string, options?: { timeout?: number }) => Promise<unknown>
  fill?: (selector: string, value: string) => Promise<unknown>
  click?: (selector: string) => Promise<unknown>
  locator?: (selector: string) => PlaywrightLocator
}

type PlaywrightBrowser = {
  close: () => Promise<void>
  newPage: () => Promise<PlaywrightPage>
}

type PlaywrightLike = {
  chromium: {
    launch: (options?: { headless?: boolean; args?: string[] }) => Promise<PlaywrightBrowser>
  }
}

export interface BrowserRuntimeDeps {
  loadPlaywright?: PlaywrightLoader
  health?: () => Promise<{ available: boolean; reason?: string; runtime?: string }>
  timeouts?: Partial<ApplyTimeouts>
}

export type LiveSession = {
  url: string
  filled: boolean
  browser?: PlaywrightBrowser
  page?: PlaywrightPage
}

const sessions = new Map<string, LiveSession>()

const FINAL_SUBMIT_SELECTORS = [
  'button[type="submit"]',
  'input[type="submit"]',
  'button',
  'input[type="button"]',
  '[role="button"]',
]

async function loadPlaywright(loader?: PlaywrightLoader): Promise<PlaywrightLike | null> {
  return (loader ?? importPlaywright)() as Promise<PlaywrightLike | null>
}

async function bounded<T>(promise: Promise<T>, ms: number, code: 'BROWSER_SELECTOR_TIMEOUT' | 'BROWSER_NAVIGATION_TIMEOUT' | 'BROWSER_LAUNCH_TIMEOUT', message: string) {
  return withTimeout(promise, ms, code, message)
}

async function tryFill(
  page: PlaywrightPage | undefined,
  selectors: string[],
  value: string,
  timeouts: ApplyTimeouts,
) {
  if (!page || !value.trim()) return
  for (const selector of selectors) {
    try {
      const locator = page.locator?.(selector).first()
      if (locator?.count) {
        const count = await bounded(
          locator.count(),
          timeouts.selectorMs,
          'BROWSER_SELECTOR_TIMEOUT',
          'The application form did not respond within the allowed time.',
        )
        if (count > 0) {
          await bounded(
            Promise.resolve(locator.fill?.(value)),
            timeouts.fillMs,
            'BROWSER_SELECTOR_TIMEOUT',
            'The application form did not respond within the allowed time.',
          )
          return
        }
        continue
      }
      await bounded(
        Promise.resolve(page.fill?.(selector, value)),
        timeouts.fillMs,
        'BROWSER_SELECTOR_TIMEOUT',
        'The application form did not respond within the allowed time.',
      )
      return
    } catch (error) {
      if (isApplyError(error) && error.code === 'BROWSER_SELECTOR_TIMEOUT') throw error
      // Keep looking for a mapped field. Never invent a value or force a hidden control.
    }
  }
}

async function tryUploadResume(page: PlaywrightPage | undefined, resumeText: string | null, timeouts: ApplyTimeouts) {
  if (!page || !resumeText?.trim()) return
  try {
    const locator = page.locator?.('input[type="file"]').first()
    if (!locator?.setInputFiles) return
    if (locator.count) {
      const count = await bounded(
        locator.count(),
        timeouts.selectorMs,
        'BROWSER_SELECTOR_TIMEOUT',
        'The application form did not respond within the allowed time.',
      )
      if (count === 0) return
    }
    await bounded(
      Promise.resolve(
        locator.setInputFiles({
          name: 'resume.txt',
          mimeType: 'text/plain',
          buffer: Buffer.from(resumeText),
        }),
      ),
      timeouts.fillMs,
      'BROWSER_SELECTOR_TIMEOUT',
      'The application form did not respond within the allowed time.',
    )
  } catch (error) {
    if (isApplyError(error) && error.code === 'BROWSER_SELECTOR_TIMEOUT') throw error
    // Resume upload is best-effort. Never bypass site restrictions to attach a file.
  }
}

async function fillKnownFields(page: PlaywrightPage | undefined, input: BrowserPrepareInput, timeouts: ApplyTimeouts) {
  await tryFill(page, ['input[name="name"]', 'input[autocomplete="name"]', 'input[name="full_name"]'], input.profile.fullName, timeouts)
  await tryFill(page, ['input[type="email"]', 'input[name="email"]', 'input[autocomplete="email"]'], input.profile.email, timeouts)
  await tryFill(
    page,
    ['input[name="location"]', 'input[name="city"]', 'input[autocomplete="address-level2"]'],
    input.profile.location,
    timeouts,
  )
  await tryUploadResume(page, input.resumeText, timeouts)
}

async function closeSession(session: LiveSession | undefined) {
  if (!session?.browser) return
  try {
    await session.browser.close()
  } catch {
    // Session cleanup should not fail the user-facing apply flow.
  }
}

function pageUrl(page: PlaywrightPage | undefined, fallback: string): string {
  if (!page?.url) return fallback
  return typeof page.url === 'function' ? page.url() : page.url
}

async function pageTitle(page: PlaywrightPage | undefined): Promise<string> {
  try {
    return (await page?.title?.()) ?? ''
  } catch {
    return ''
  }
}

async function waitForPage(page: PlaywrightPage | undefined) {
  try {
    await page?.waitForLoadState?.('domcontentloaded', { timeout: 8_000 })
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 800))
  }
}

function resultFromInspection(
  status: BrowserSubmitResult['status'],
  failureReason: string | null,
  extras: Partial<ExternalSubmissionResult> = {},
): BrowserSubmitResult {
  return {
    status,
    failureReason,
    success: false,
    confirmationDetected: false,
    finalActionCompleted: extras.finalActionCompleted ?? false,
    resultingUrl: extras.resultingUrl,
    pageTitle: extras.pageTitle,
    confirmationNumber: extras.confirmationNumber,
    confirmationText: extras.confirmationText,
    reason: extras.reason ?? failureReason ?? undefined,
  }
}

async function readLocatorLabel(locator: PlaywrightLocatorHandle, selector: string): Promise<string> {
  try {
    const text = (await locator.innerText?.()) ?? ''
    if (text.trim()) return text
  } catch {
    // Fall through to attributes.
  }
  try {
    const value = (await locator.getAttribute?.('value')) ?? ''
    if (value.trim()) return value
  } catch {
    // Ignore missing attributes.
  }
  return selector
}

export async function clickFinalSubmit(page: PlaywrightPage): Promise<{ clicked: boolean; reason: string }> {
  for (const selector of FINAL_SUBMIT_SELECTORS) {
    try {
      const locator = page.locator?.(selector).first()
      if (!locator) continue
      if (locator.count && (await locator.count()) === 0) continue
      const label = await readLocatorLabel(locator, selector)
      const isSubmitType = selector.includes('[type="submit"]')
      if (!isSubmitType && !isFinalSubmitLabel(label)) continue
      await locator.click?.({ timeout: 5_000 })
      return { clicked: true, reason: `Clicked ${label || selector}` }
    } catch {
      // Try the next known final control.
    }
  }
  if (!page.click) {
    return {
      clicked: false,
      reason: 'The employer submit control could not be used. Complete submission on the employer site.',
    }
  }
  try {
    await page.click('button[type="submit"]')
    return { clicked: true, reason: 'Clicked button[type="submit"]' }
  } catch {
    return {
      clicked: false,
      reason: 'The employer submit control could not be used. Complete submission on the employer site.',
    }
  }
}

export async function evaluateExternalSubmission(
  page: PlaywrightPage,
  context: BrowserSubmitContext = {},
): Promise<BrowserSubmitResult> {
  const currentUrl = pageUrl(page, context.applicationUrl ?? '')
  const htmlBefore = await page.content()
  const inspection = inspectApplicationPage(htmlBefore)
  if (
    inspection.status === 'captcha_required' ||
    inspection.status === 'mfa_required' ||
    inspection.status === 'login_required' ||
    inspection.status === 'blocked' ||
    inspection.status === 'automation_blocked'
  ) {
    return resultFromInspection(inspection.status, inspection.failureReason, { resultingUrl: currentUrl })
  }

  logExternalSubmit('Preparing external submission')
  logExternalSubmit(`Job: ${context.identityKey || context.jobId || 'unknown'}`)
  logExternalSubmit(`Application ID: ${context.applicationId || 'unknown'}`)
  logExternalSubmit(`Employer hostname: ${safeEmployerHost(currentUrl) || 'unknown'}`)

  const clicked = await clickFinalSubmit(page)
  if (!clicked.clicked) {
    return resultFromInspection('needs_user_input', clicked.reason, { resultingUrl: currentUrl, reason: clicked.reason })
  }

  logExternalSubmit('Final submit action completed')
  await waitForPage(page)

  const resultingUrl = pageUrl(page, currentUrl)
  const title = await pageTitle(page)
  const html = await page.content()
  const blocked = inspectPostSubmitPage(html)
  if (blocked) {
    logExternalSubmit(`Post-submit pause: ${blocked.status}`)
    return resultFromInspection(blocked.status, blocked.failureReason, {
      finalActionCompleted: true,
      resultingUrl,
      pageTitle: title,
      reason: blocked.failureReason ?? undefined,
    })
  }

  const confirmation = detectSubmissionConfirmation({ html, url: resultingUrl, title })
  logExternalSubmit(`Resulting URL: ${safeEmployerHost(resultingUrl) || resultingUrl || 'unknown'}`)
  logExternalSubmit(`Page title: ${title || 'unknown'}`)
  logExternalSubmit(`Confirmation detected: ${confirmation.detected ? 'yes' : 'no'}`)
  if (confirmation.confirmationNumber) {
    logExternalSubmit(`Confirmation number: ${confirmation.confirmationNumber}`)
  }
  if (confirmation.confirmationText) {
    logExternalSubmit(`Confirmation text: ${confirmation.confirmationText}`)
  }

  if (!confirmation.detected) {
    return resultFromInspection(
      'needs_user_confirmation',
      'Submission could not be confirmed on the employer site. Complete or verify it there.',
      {
        finalActionCompleted: true,
        resultingUrl,
        pageTitle: title,
        reason: 'No reliable employer confirmation was detected after the final submit action.',
      },
    )
  }

  return {
    status: 'submitted',
    failureReason: null,
    success: true,
    confirmationDetected: true,
    confirmationNumber: confirmation.confirmationNumber,
    confirmationText: confirmation.confirmationText,
    resultingUrl,
    pageTitle: title,
    finalActionCompleted: true,
  }
}

export class PlaywrightApplyBrowser implements ApplyBrowser {
  private readonly timeouts: ApplyTimeouts

  constructor(private readonly deps: BrowserRuntimeDeps = {}) {
    this.timeouts = mergeApplyTimeouts(deps.timeouts)
  }

  async prepare(input: BrowserPrepareInput): Promise<BrowserPrepareResult> {
    const inspected = inspectApplicationUrl(input.html ? 'https://jobs.example.com/html' : input.url)
    if (!input.html && !inspected.ok) {
      throw new ApplyError(
        422,
        inspected.code ?? 'INVALID_APPLICATION_URL',
        inspected.code === 'APPLICATION_URL_MISSING'
          ? 'This listing does not include a valid application URL.'
          : 'This listing does not include a valid application URL.',
      )
    }
    if (input.html) return this.fromHtml(input, input.html)

    const health = this.deps.health
      ? await this.deps.health()
      : await getAutomationHealth({
          loadPlaywright: this.deps.loadPlaywright,
          probe: false,
        })
    if (!health.available) {
      return {
        status: 'automation_blocked',
        questions: [],
        failureReason:
          health.reason ||
          (health.runtime === 'serverless'
            ? serverlessAutomationReason()
            : 'Browser automation is not available. JobPilot cannot open the employer application in this environment.'),
        sessionId: null,
      }
    }

    const playwright = await loadPlaywright(this.deps.loadPlaywright)
    if (!playwright) {
      return {
        status: 'automation_blocked',
        questions: [],
        failureReason: PLAYWRIGHT_MISSING_REASON,
        sessionId: null,
      }
    }

    let browser: PlaywrightBrowser | undefined
    try {
      logAutoApplyStep(6, 'Browser initialization started')
      browser = await bounded(
        playwright.chromium.launch(chromiumLaunchOptions()),
        this.timeouts.launchMs,
        'BROWSER_LAUNCH_TIMEOUT',
        'The browser did not start within the allowed time.',
      )
      const page = await bounded(
        browser.newPage(),
        this.timeouts.launchMs,
        'BROWSER_LAUNCH_TIMEOUT',
        'The browser did not start within the allowed time.',
      )
      logAutoApplyStep(7, 'Browser initialized')
      logAutoApplyStep(8, 'Employer URL opening', { host: inspected.url?.hostname ?? null })
      try {
        await bounded(
          page.goto(input.url, { waitUntil: 'commit', timeout: this.timeouts.navigationMs }),
          this.timeouts.navigationMs,
          'BROWSER_NAVIGATION_TIMEOUT',
          'The employer application page did not load within the allowed time.',
        )
      } catch (error) {
        if (isApplyError(error)) throw error
        throw new ApplyError(
          504,
          'BROWSER_NAVIGATION_TIMEOUT',
          'The employer application page did not load within the allowed time.',
        )
      }
      logAutoApplyStep(9, 'Employer page loaded')
      try {
        await bounded(
          Promise.resolve(page.waitForLoadState?.('domcontentloaded', { timeout: this.timeouts.selectorMs })),
          this.timeouts.selectorMs,
          'BROWSER_SELECTOR_TIMEOUT',
          'The application form did not respond within the allowed time.',
        )
      } catch {
        // Navigation already committed. Continue with the HTML that is available.
      }
      const pageHtml = await bounded(
        page.content(),
        this.timeouts.selectorMs,
        'BROWSER_SELECTOR_TIMEOUT',
        'The application form did not respond within the allowed time.',
      )
      logAutoApplyStep(10, 'Application form detection started')
      const prepared = this.fromHtml(input, pageHtml)
      logAutoApplyStep(11, 'Application form detected', { applicationStatus: prepared.status })
      if (prepared.status !== 'ready_for_submission') {
        await browser.close()
        return prepared
      }
      await fillKnownFields(page, input, this.timeouts)
      const sessionId = prepared.sessionId || `filled:${input.url}`
      sessions.set(sessionId, { url: input.url, filled: true, browser, page })
      return { ...prepared, sessionId }
    } catch (error) {
      await closeSession({ url: input.url, filled: false, browser })
      if (isApplyError(error)) throw error
      return {
        status: detectAutomationRuntime() === 'serverless' ? 'automation_blocked' : 'failed',
        questions: [],
        failureReason: userFacingBrowserError(error),
        sessionId: null,
      }
    }
  }

  async submit(sessionId: string, context: BrowserSubmitContext = {}): Promise<BrowserSubmitResult> {
    const session = sessions.get(sessionId)
    if (!session) {
      return resultFromInspection('failed', 'The browser session is no longer available.')
    }
    try {
      if (!session.page) {
        sessions.delete(sessionId)
        await closeSession(session)
        return resultFromInspection(
          'needs_user_confirmation',
          'The employer application was not opened in a browser session. Complete submission on the employer site.',
          { resultingUrl: session.url, reason: 'No live browser page was available for the final submit action.' },
        )
      }
      const result = await evaluateExternalSubmission(session.page, {
        ...context,
        applicationUrl: context.applicationUrl ?? session.url,
      })
      sessions.delete(sessionId)
      await closeSession(session)
      return result
    } catch (error) {
      sessions.delete(sessionId)
      await closeSession(session)
      return resultFromInspection(
        'failed',
        error instanceof Error ? error.message : 'Could not submit the application.',
      )
    }
  }

  async close(sessionId: string): Promise<void> {
    const session = sessions.get(sessionId)
    sessions.delete(sessionId)
    await closeSession(session)
  }

  private fromHtml(input: BrowserPrepareInput, html: string): BrowserPrepareResult {
    const inspection = inspectApplicationPage(html)
    if (inspection.status === 'captcha_required' || inspection.status === 'mfa_required' || inspection.status === 'blocked' || inspection.status === 'login_required' || inspection.status === 'automation_blocked') {
      return {
        status: inspection.status,
        questions: [],
        failureReason: inspection.failureReason,
        sessionId: null,
      }
    }
    if (
      !inspection.hasSubmit &&
      !inspection.hasFileInput &&
      inspection.mappedFields.length === 0 &&
      inspection.questions.length === 0
    ) {
      return {
        status: 'failed',
        questions: [],
        failureReason: 'The employer application form could not be found.',
        sessionId: null,
      }
    }
    const resolved = resolveApplicationQuestions(inspection.questions, input.profile)
    if (resolved.unknown.length) {
      return {
        status: 'needs_user_input',
        questions: [...resolved.answered, ...resolved.unknown],
        failureReason: null,
        sessionId: null,
      }
    }
    const sessionId = `filled:${input.url}`
    sessions.set(sessionId, { url: input.url, filled: true })
    return {
      status: 'ready_for_submission',
      questions: resolved.answered,
      failureReason: null,
      sessionId,
    }
  }
}

export function createApplyBrowser(deps: BrowserRuntimeDeps = {}): ApplyBrowser {
  return new PlaywrightApplyBrowser(deps)
}

export function setBrowserSessionForTests(sessionId: string, session: LiveSession) {
  sessions.set(sessionId, session)
}

export function clearBrowserSessionsForTests() {
  sessions.clear()
}
