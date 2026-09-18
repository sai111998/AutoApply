import { inspectApplicationPage } from './detect'
import { resolveApplicationQuestions } from './questions'
import type { ApplyBrowser, BrowserPrepareInput, BrowserPrepareResult, BrowserSubmitResult } from './types'

type PlaywrightPage = {
  goto: (url: string, options?: { waitUntil?: string; timeout?: number }) => Promise<unknown>
  content: () => Promise<string>
  fill?: (selector: string, value: string) => Promise<unknown>
  click?: (selector: string) => Promise<unknown>
  locator?: (selector: string) => {
    first: () => {
      count?: () => Promise<number>
      fill?: (value: string) => Promise<unknown>
      click?: (options?: { timeout?: number }) => Promise<unknown>
      setInputFiles?: (files: unknown) => Promise<unknown>
    }
  }
}

type PlaywrightBrowser = {
  close: () => Promise<void>
  newPage: () => Promise<PlaywrightPage>
}

type PlaywrightLike = {
  chromium: {
    launch: (options?: { headless?: boolean }) => Promise<PlaywrightBrowser>
  }
}

type LiveSession = {
  url: string
  filled: boolean
  browser?: PlaywrightBrowser
  page?: PlaywrightPage
}

const sessions = new Map<string, LiveSession>()

async function loadPlaywright(): Promise<PlaywrightLike | null> {
  try {
    const loader = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<PlaywrightLike>
    return await loader('playwright')
  } catch {
    return null
  }
}

async function tryFill(page: PlaywrightPage | undefined, selectors: string[], value: string) {
  if (!page || !value.trim()) return
  for (const selector of selectors) {
    try {
      const locator = page.locator?.(selector).first()
      if (locator?.count && (await locator.count()) > 0) {
        await locator.fill?.(value)
        return
      }
      await page.fill?.(selector, value)
      return
    } catch {
      // Keep looking for a mapped field. Never invent a value or force a hidden control.
    }
  }
}

async function tryUploadResume(page: PlaywrightPage | undefined, resumeText: string | null) {
  if (!page || !resumeText?.trim()) return
  try {
    const locator = page.locator?.('input[type="file"]').first()
    if (!locator?.setInputFiles) return
    if (locator.count && (await locator.count()) === 0) return
    await locator.setInputFiles({
      name: 'resume.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(resumeText),
    })
  } catch {
    // Resume upload is best-effort. Never bypass site restrictions to attach a file.
  }
}

async function fillKnownFields(page: PlaywrightPage | undefined, input: BrowserPrepareInput) {
  await tryFill(page, ['input[name="name"]', 'input[autocomplete="name"]', 'input[name="full_name"]'], input.profile.fullName)
  await tryFill(page, ['input[type="email"]', 'input[name="email"]', 'input[autocomplete="email"]'], input.profile.email)
  await tryFill(
    page,
    ['input[name="location"]', 'input[name="city"]', 'input[autocomplete="address-level2"]'],
    input.profile.location,
  )
  await tryUploadResume(page, input.resumeText)
}

async function closeSession(session: LiveSession | undefined) {
  if (!session?.browser) return
  try {
    await session.browser.close()
  } catch {
    // Session cleanup should not fail the user-facing apply flow.
  }
}

export class PlaywrightApplyBrowser implements ApplyBrowser {
  async prepare(input: BrowserPrepareInput): Promise<BrowserPrepareResult> {
    if (input.html) return this.fromHtml(input, input.html)

    const playwright = await loadPlaywright()
    if (!playwright) {
      const sessionId = `open:${input.url}`
      sessions.set(sessionId, { url: input.url, filled: false })
      return {
        status: 'ready_for_submission',
        questions: [],
        failureReason: null,
        sessionId,
      }
    }

    const browser = await playwright.chromium.launch({ headless: true })
    try {
      const page = await browser.newPage()
      await page.goto(input.url, { waitUntil: 'domcontentloaded', timeout: 20_000 })
      const pageHtml = await page.content()
      const prepared = this.fromHtml(input, pageHtml)
      if (prepared.status !== 'ready_for_submission') {
        await browser.close()
        return prepared
      }
      await fillKnownFields(page, input)
      const sessionId = prepared.sessionId || `filled:${input.url}`
      sessions.set(sessionId, { url: input.url, filled: true, browser, page })
      return { ...prepared, sessionId }
    } catch (error) {
      await closeSession({ url: input.url, filled: false, browser })
      return {
        status: 'failed',
        questions: [],
        failureReason: error instanceof Error ? error.message : 'Could not open the employer application.',
        sessionId: null,
      }
    }
  }

  async submit(sessionId: string): Promise<BrowserSubmitResult> {
    const session = sessions.get(sessionId)
    if (!session) {
      return { status: 'failed', failureReason: 'The browser session is no longer available.' }
    }
    try {
      if (session.page) {
        const html = await session.page.content()
        const inspection = inspectApplicationPage(html)
        if (inspection.status === 'captcha_required' || inspection.status === 'mfa_required' || inspection.status === 'blocked' || inspection.status === 'login_required' || inspection.status === 'automation_blocked') {
          return { status: inspection.status, failureReason: inspection.failureReason }
        }
        try {
          await session.page.click?.('button[type="submit"], input[type="submit"]')
        } catch {
          return {
            status: 'needs_user_input',
            failureReason: 'The employer submit control could not be used. Complete submission on the employer site.',
          }
        }
      }
      sessions.delete(sessionId)
      await closeSession(session)
      return { status: 'submitted', failureReason: null }
    } catch (error) {
      sessions.delete(sessionId)
      await closeSession(session)
      return {
        status: 'failed',
        failureReason: error instanceof Error ? error.message : 'Could not submit the application.',
      }
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

export function createApplyBrowser(): ApplyBrowser {
  return new PlaywrightApplyBrowser()
}
