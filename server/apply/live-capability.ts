import { clickApplyControl } from './apply-action'
import { applicationPreflight, decisionFromLivePreflight, type ApplicationPreflightDecision } from './application-preflight'
import { applyRegistryToCapabilityDecision } from '../application/capability'
import { diagnoseLivePage, logBrowserNavigation, printApplicationDiagnostic, responseUrlFromGoto, uniqueUrls } from './diagnose'
import { documentsFromEvidencePage } from './page-evidence'
import type { BrowserEvidencePage } from './page-evidence'
import { inspectApplicationUrl } from './validate'
import { chromiumLaunchOptions, importPlaywright } from './health'

export type LiveCapabilityPage = BrowserEvidencePage & {
  goto: (
    url: string,
    options?: { waitUntil?: 'load' | 'domcontentloaded' | 'commit' | 'networkidle'; timeout?: number },
  ) => Promise<unknown>
  waitForLoadState?: (state?: 'load' | 'domcontentloaded' | 'networkidle', options?: { timeout?: number }) => Promise<unknown>
  waitForTimeout?: (ms: number) => Promise<unknown>
  waitForURL?: (predicate: (value: URL) => boolean, options?: { timeout?: number }) => Promise<unknown>
  getByRole?: (
    role: 'button' | 'link',
    options?: { name?: string | RegExp },
  ) => {
    count?: () => Promise<number>
    click?: (options?: { timeout?: number }) => Promise<unknown>
    innerText?: () => Promise<string>
    first?: () => {
      count?: () => Promise<number>
      click?: (options?: { timeout?: number }) => Promise<unknown>
      innerText?: () => Promise<string>
    }
  }
  locator?: (selector: string) => {
    count?: () => Promise<number>
    click?: (options?: { timeout?: number }) => Promise<unknown>
    first?: () => {
      count?: () => Promise<number>
      click?: (options?: { timeout?: number }) => Promise<unknown>
    }
  }
}

function pageUrl(page: LiveCapabilityPage, fallback: string): string {
  if (!page.url) return fallback
  return typeof page.url === 'function' ? page.url() : page.url
}

export function shouldRunLiveCapabilityPreflight(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.JOBPILOT_LIVE_PREFLIGHT === '0') return false
  if (env.JOBPILOT_LIVE_PREFLIGHT === '1') return true
  return !env.VITEST
}

export async function liveCapabilityPreflight(input: {
  jobId?: string | null
  title?: string | null
  company?: string | null
  applicationUrl: string
  page: LiveCapabilityPage
}): Promise<ApplicationPreflightDecision> {
  const inspected = inspectApplicationUrl(input.applicationUrl)
  if (!inspected.ok || !inspected.url) {
    return applicationPreflight({ url: input.applicationUrl, applicationUrl: input.applicationUrl, accessible: false })
  }
  const initialUrl = inspected.url.toString()
  const navigationResult = await input.page.goto(initialUrl, { waitUntil: 'domcontentloaded', timeout: 16_000 })
  await input.page.waitForLoadState?.('domcontentloaded', { timeout: 8_000 }).catch(() => undefined)
  let currentUrl = pageUrl(input.page, initialUrl)
  const redirectChain = uniqueUrls([initialUrl, responseUrlFromGoto(navigationResult), currentUrl])
  logBrowserNavigation({
    initialUrl,
    responseUrl: responseUrlFromGoto(navigationResult),
    finalUrl: currentUrl,
    redirectChain,
  })
  let diagnostic = await diagnoseLivePage({
    job: {
      jobId: input.jobId,
      company: input.company,
      title: input.title,
      applicationUrl: initialUrl,
    },
    page: input.page,
    navigation: {
      initialUrl,
      responseUrl: responseUrlFromGoto(navigationResult),
      finalUrl: currentUrl,
      redirectChain,
    },
  })
  printApplicationDiagnostic(diagnostic)

  let applyFollowed = false
  const shouldFollowApply =
    diagnostic.page.pageType === 'JOB_DETAIL_PAGE' ||
    (diagnostic.preflight.analysis.hasApplyControl &&
      !diagnostic.preflight.applicationDetected &&
      diagnostic.page.pageType !== 'APPLICATION_PAGE' &&
      diagnostic.page.pageType !== 'CAPTCHA_PAGE' &&
      diagnostic.page.pageType !== 'LOGIN_PAGE' &&
      diagnostic.page.pageType !== 'MFA_PAGE' &&
      diagnostic.page.pageType !== 'BLOCKED_PAGE')
  if (shouldFollowApply) {
    const clicked = await clickApplyControl(input.page)
    applyFollowed = clicked.clicked
    if (clicked.clicked) {
      if (input.page.waitForURL) {
        await input.page
          .waitForURL((value) => value.href !== currentUrl || /\/apply\b|#application/i.test(`${value.pathname}${value.hash}`), {
            timeout: 8_000,
          })
          .catch(() => undefined)
      }
      await input.page.waitForLoadState?.('domcontentloaded', { timeout: 8_000 }).catch(() => undefined)
      await input.page.waitForTimeout?.(600)
      currentUrl = pageUrl(input.page, currentUrl)
      diagnostic = await diagnoseLivePage({
        job: {
          jobId: input.jobId,
          company: input.company,
          title: input.title,
          applicationUrl: initialUrl,
        },
        page: input.page,
        navigation: {
          initialUrl,
          responseUrl: currentUrl,
          finalUrl: currentUrl,
          redirectChain: uniqueUrls([...redirectChain, currentUrl]),
        },
      })
      printApplicationDiagnostic(diagnostic)
      await documentsFromEvidencePage(input.page, currentUrl)
    }
  }

  const html = (await input.page.content?.().catch(() => '')) || ''
  return applyRegistryToCapabilityDecision(decisionFromLivePreflight(diagnostic.preflight, { initialUrl, applyFollowed }), {
    url: currentUrl || initialUrl,
    html,
  })
}

export async function livePreflightApplicationUrl(input: {
  jobId?: string | null
  title?: string | null
  company?: string | null
  applicationUrl: string
}): Promise<ApplicationPreflightDecision> {
  const playwright = await importPlaywright()
  if (!playwright) {
    return applicationPreflight({
      url: input.applicationUrl,
      applicationUrl: input.applicationUrl,
      accessible: false,
    })
  }
  let browser: { close: () => Promise<void>; newPage: () => Promise<LiveCapabilityPage> } | undefined
  try {
    browser = (await playwright.chromium.launch(chromiumLaunchOptions())) as unknown as {
      close: () => Promise<void>
      newPage: () => Promise<LiveCapabilityPage>
    }
    const page = await browser.newPage()
    return await liveCapabilityPreflight({ ...input, page })
  } catch {
    return applicationPreflight({
      url: input.applicationUrl,
      applicationUrl: input.applicationUrl,
      accessible: false,
    })
  } finally {
    await browser?.close().catch(() => undefined)
  }
}
