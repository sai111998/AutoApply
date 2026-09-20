import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { analyzeApplicationSurface, mergeSurfaceDocuments } from './surface'
import { buildLivePreflight, type LivePreflightResult } from './live-preflight'
import { collectLivePageEvidence, documentsFromEvidencePage, type BrowserEvidencePage } from './page-evidence'
import { inspectStoredApplicationUrl } from './stored-url'

export interface DiagnoseJobInput {
  jobId?: string | null
  company?: string | null
  title?: string | null
  applicationUrl?: string | null
  applicationId?: string | null
}

export interface BrowserNavigationLog {
  initialUrl: string
  responseUrl: string | null
  finalUrl: string
  redirectChain: string[]
}

export interface ApplicationDiagnostic {
  job: { jobId: string | null; company: string | null; title: string | null }
  urls: BrowserNavigationLog & { storedApplicationUrl: string | null }
  page: {
    pageType: LivePreflightResult['pageType']
    title: string
    provider: string
    iframeCount: number
  }
  application: {
    applicationDetected: boolean
    confidence: LivePreflightResult['confidence']
    fields: string[]
    buttons: string[]
  }
  blockers: {
    captcha: boolean
    login: boolean
    mfa: boolean
  }
  result: string
  preflight: LivePreflightResult
  screenshotPath?: string | null
}

function logLine(prefix: string, label: string, value: unknown) {
  console.info(`${prefix} ${label}${value === undefined ? '' : String(value)}`)
}

export function logStoredApplication(input: DiagnoseJobInput) {
  const stored = inspectStoredApplicationUrl(input.applicationUrl)
  logLine('[AutoApply]', 'jobId=', input.jobId ?? '')
  logLine('[AutoApply]', 'company=', input.company ?? '')
  logLine('[AutoApply]', 'title=', input.title ?? '')
  logLine('[AutoApply]', 'storedApplicationUrl=', stored.url ?? input.applicationUrl ?? '')
  if (!stored.ok) logLine('[AutoApply]', 'storedApplicationUrlInvalid=', stored.reason)
  return stored
}

export function logBrowserNavigation(log: BrowserNavigationLog) {
  logLine('[Browser]', 'Initial URL: ', log.initialUrl)
  logLine('[Browser]', 'Response URL: ', log.responseUrl ?? '')
  logLine('[Browser]', 'Final URL: ', log.finalUrl)
  logLine('[Browser]', 'Redirect chain: ', log.redirectChain.join(' -> '))
}

export function uniqueUrls(urls: Array<string | null | undefined>): string[] {
  return [...new Set(urls.map((item) => item?.trim() ?? '').filter(Boolean))]
}

export function responseUrlFromGoto(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null
  const record = result as { url?: (() => string) | string }
  if (typeof record.url === 'function') return record.url()
  if (typeof record.url === 'string') return record.url
  return null
}

export async function saveFailureScreenshot(
  page: { screenshot?: (options?: { path?: string; fullPage?: boolean }) => Promise<unknown> },
  applicationId: string | null | undefined,
  outputDir = path.join(process.cwd(), 'debug/application-failure'),
): Promise<string | null> {
  if (process.env.NODE_ENV === 'production') return null
  if (!page.screenshot) return null
  const id = (applicationId || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_')
  await mkdir(outputDir, { recursive: true })
  const filePath = path.join(outputDir, `${id}.png`)
  try {
    await page.screenshot({ path: filePath, fullPage: false })
    return filePath
  } catch {
    return null
  }
}

export async function diagnoseLivePage(input: {
  job: DiagnoseJobInput
  page: BrowserEvidencePage & { screenshot?: (options?: { path?: string; fullPage?: boolean }) => Promise<unknown> }
  navigation: BrowserNavigationLog
}): Promise<ApplicationDiagnostic> {
  const documents = await documentsFromEvidencePage(input.page, input.navigation.finalUrl)
  const evidence = await collectLivePageEvidence(input.page, input.navigation.finalUrl)
  const html = documents[0]?.html ?? ''
  const preflight = buildLivePreflight({
    jobId: input.job.jobId,
    applicationUrl: input.job.applicationUrl,
    finalUrl: input.navigation.finalUrl,
    html,
    documents,
    evidence,
    title: evidence.title,
  })
  const screenshotPath = await saveFailureScreenshot(input.page, input.job.applicationId)
  const result = preflight.applicationDetected
    ? `Application detected (${preflight.confidence}) with fields: ${preflight.detectedFields.join(', ') || 'none'}.`
    : preflight.reason || `Page classified as ${preflight.pageType}.`
  return {
    job: {
      jobId: input.job.jobId ?? null,
      company: input.job.company ?? null,
      title: input.job.title ?? null,
    },
    urls: {
      storedApplicationUrl: input.job.applicationUrl ?? null,
      ...input.navigation,
    },
    page: {
      pageType: preflight.pageType,
      title: evidence.title,
      provider: preflight.provider,
      iframeCount: evidence.iframes,
    },
    application: {
      applicationDetected: preflight.applicationDetected,
      confidence: preflight.confidence,
      fields: preflight.detectedFields,
      buttons: preflight.detectedButtons,
    },
    blockers: {
      captcha: preflight.captchaDetected,
      login: preflight.loginDetected,
      mfa: preflight.mfaDetected,
    },
    result,
    preflight,
    screenshotPath,
  }
}

export function printApplicationDiagnostic(diagnostic: ApplicationDiagnostic) {
  console.info('[AutoApply] JOB')
  console.info(`[AutoApply] company=${diagnostic.job.company ?? ''}`)
  console.info(`[AutoApply] title=${diagnostic.job.title ?? ''}`)
  console.info('[AutoApply] URL')
  console.info(`[AutoApply] stored application URL=${diagnostic.urls.storedApplicationUrl ?? ''}`)
  console.info(`[AutoApply] initial URL=${diagnostic.urls.initialUrl}`)
  console.info(`[AutoApply] final URL=${diagnostic.urls.finalUrl}`)
  console.info('[AutoApply] PAGE')
  console.info(`[AutoApply] page type=${diagnostic.page.pageType}`)
  console.info(`[AutoApply] title=${diagnostic.page.title}`)
  console.info(`[AutoApply] provider=${diagnostic.page.provider}`)
  console.info(`[AutoApply] iframe count=${diagnostic.page.iframeCount}`)
  console.info('[AutoApply] APPLICATION')
  console.info(`[AutoApply] application detected=${diagnostic.application.applicationDetected}`)
  console.info(`[AutoApply] confidence=${diagnostic.application.confidence}`)
  console.info(`[AutoApply] fields=${diagnostic.application.fields.join(', ')}`)
  console.info(`[AutoApply] buttons=${diagnostic.application.buttons.join(', ')}`)
  console.info('[AutoApply] BLOCKERS')
  console.info(`[AutoApply] captcha=${diagnostic.blockers.captcha}`)
  console.info(`[AutoApply] login=${diagnostic.blockers.login}`)
  console.info(`[AutoApply] mfa=${diagnostic.blockers.mfa}`)
  console.info('[AutoApply] RESULT')
  console.info(`[AutoApply] ${diagnostic.result}`)
}

export function analyzeDocuments(documents: Array<{ html: string; url?: string; inIframe?: boolean }>) {
  if (!documents.length) return analyzeApplicationSurface('', {})
  return mergeSurfaceDocuments(documents)
}
