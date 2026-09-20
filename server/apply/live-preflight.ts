import { analyzeCaptcha } from './captcha'
import { canEnterAutonomousApply, classifyApplicationCapability, isJobBoardHost } from './capability'
import { inspectApplicationPage } from './detect'
import { classifyPageType, unsupportedProviderName, type PageType } from './page-classify'
import { evidenceFromHtml, type PageEvidence } from './page-evidence'
import { detectApplicationProvider } from './providers'
import { mergeSurfaceDocuments, type ApplicationAnalysis } from './surface'
import { inspectStoredApplicationUrl } from './stored-url'
import { hostnameOf } from './providers/types'

export interface LivePreflightResult {
  jobId: string | null
  applicationUrl: string | null
  finalUrl: string | null
  pageType: PageType
  provider: string
  applicationDetected: boolean
  confidence: 'high' | 'medium' | 'low'
  detectedFields: string[]
  detectedButtons: string[]
  iframeDetected: boolean
  captchaDetected: boolean
  loginDetected: boolean
  mfaDetected: boolean
  blockers: string[]
  evidence: PageEvidence
  capability: ReturnType<typeof classifyApplicationCapability>['capability']
  analysis: ApplicationAnalysis
  reason: string | null
}

export function detectedButtonsFromHtml(html: string): string[] {
  const labels = [...html.matchAll(/<(button|a)[^>]*>([\s\S]*?)<\/\1>/gi)]
    .map((match) => match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((label) => label.length > 0 && label.length < 40)
  const aria = [...html.matchAll(/aria-label=['"]([^'"]+)['"]/gi)].map((match) => match[1].trim())
  return [...new Set([...labels, ...aria])].slice(0, 12)
}

export function reasonForPageType(
  pageType: PageType,
  input: { hostname?: string | null; provider?: string; iframeDetected?: boolean },
): string | null {
  if (pageType === 'CAPTCHA_PAGE') return 'CAPTCHA was detected. JobPilot will not bypass it.'
  if (pageType === 'LOGIN_PAGE') return 'The employer site requires login.'
  if (pageType === 'MFA_PAGE') return 'Multi-factor authentication was detected.'
  if (pageType === 'BLOCKED_PAGE') return 'The employer site blocked automated interaction.'
  if (pageType === 'ERROR_PAGE') return 'This job is no longer available.'
  if (pageType === 'JOB_DETAIL_PAGE') {
    return 'The job page requires an Apply action before the application form appears.'
  }
  if (pageType === 'APPLICATION_PAGE') return null
  if (pageType === 'REDIRECT_PAGE') return 'The employer page is still redirecting.'
  const hostname = input.hostname ?? ''
  if (isJobBoardHost(hostname)) {
    return 'This listing does not lead to a supported application flow.'
  }
  const unsupported = unsupportedProviderName(hostname)
  if (unsupported) {
    return `This application provider (${unsupported}) is not supported for autonomous Auto Apply.`
  }
  if (input.iframeDetected) {
    return 'An application-like frame was found, but its fields could not be read yet.'
  }
  return 'The page was classified after collecting evidence and is not a supported application form.'
}

export function buildLivePreflight(input: {
  jobId?: string | null
  applicationUrl?: string | null
  finalUrl?: string | null
  html: string
  documents?: Array<{ html: string; url?: string; inIframe?: boolean }>
  evidence?: PageEvidence
  title?: string
}): LivePreflightResult {
  const stored = inspectStoredApplicationUrl(input.applicationUrl)
  const documents = input.documents?.length
    ? input.documents
    : [{ html: input.html, url: input.finalUrl || input.applicationUrl || '', inIframe: false }]
  const analysis = mergeSurfaceDocuments(
    documents.map((document) => ({
      html: document.html,
      url: document.url || input.finalUrl || input.applicationUrl || '',
      inIframe: document.inIframe,
    })),
  )
  const finalUrl = input.finalUrl || analysis.snapshot.finalUrl || stored.url
  const inspection = inspectApplicationPage(input.html)
  const classification = classifyPageType({
    html: input.html,
    url: finalUrl,
    inspection,
    applicationScore: analysis.score,
    applicationKind: analysis.kind,
    hasApplyControl: analysis.hasApplyControl,
    inIframe: analysis.inIframe,
  })
  const provider = analysis.kind === 'application' || classification.applicationDetected
    ? analysis.provider
    : detectApplicationProvider({ url: finalUrl, html: input.html }).id
  const captcha = analyzeCaptcha(input.html)
  const evidence = input.evidence ?? evidenceFromHtml(input.html, finalUrl || '', { title: input.title })
  const pageType = classification.pageType
  const capabilitySource = classifyApplicationCapability({
    url: finalUrl,
    applicationUrl: stored.url,
    html: input.html,
  })
  let capability = capabilitySource.capability
  const blockers: string[] = []
  if (!stored.ok) {
    blockers.push(stored.reason || 'Application URL is invalid.')
    capability = 'unsupported'
  }
  if (pageType === 'CAPTCHA_PAGE') {
    blockers.push('CAPTCHA challenge detected.')
    capability = 'blocked'
  } else if (pageType === 'LOGIN_PAGE') {
    blockers.push('Employer login is required.')
    capability = 'blocked'
  } else if (pageType === 'MFA_PAGE') {
    blockers.push('Multi-factor authentication is required.')
    capability = 'blocked'
  } else if (pageType === 'BLOCKED_PAGE') {
    blockers.push('Automated access is blocked.')
    capability = 'blocked'
  } else if (pageType === 'ERROR_PAGE') {
    blockers.push('Job is no longer available.')
    capability = 'unsupported'
  } else if (pageType === 'UNKNOWN_PAGE' && isJobBoardHost(evidence.hostname || hostnameOf(finalUrl || ''))) {
    blockers.push('unsupported_application_flow')
    capability = 'unsupported'
  } else if (pageType === 'UNKNOWN_PAGE' && unsupportedProviderName(evidence.hostname || '')) {
    blockers.push('unsupported_provider')
    capability = 'unsupported'
  } else if (pageType === 'UNKNOWN_PAGE' && !classification.applicationDetected && !analysis.hasApplyControl) {
    blockers.push('unsupported_application_flow')
    if (canEnterAutonomousApply(capability)) capability = 'unknown'
  }

  return {
    jobId: input.jobId ?? null,
    applicationUrl: stored.url,
    finalUrl,
    pageType,
    provider,
    applicationDetected: classification.applicationDetected || analysis.kind === 'application',
    confidence: classification.confidence,
    detectedFields: analysis.fields,
    detectedButtons: detectedButtonsFromHtml(input.html),
    iframeDetected: analysis.inIframe || evidence.iframes > 0 || evidence.frames.length > 0,
    captchaDetected: captcha.captcha || pageType === 'CAPTCHA_PAGE',
    loginDetected: pageType === 'LOGIN_PAGE',
    mfaDetected: pageType === 'MFA_PAGE',
    blockers,
    evidence,
    capability,
    analysis,
    reason: reasonForPageType(pageType, {
      hostname: evidence.hostname,
      provider,
      iframeDetected: analysis.inIframe,
    }),
  }
}

export function livePreflightStatus(result: LivePreflightResult): {
  status:
    | 'ready'
    | 'job_details'
    | 'captcha_required'
    | 'login_required'
    | 'mfa_required'
    | 'blocked'
    | 'failed'
    | 'skipped'
  failureReason: string | null
} {
  if (result.pageType === 'CAPTCHA_PAGE') return { status: 'captcha_required', failureReason: null }
  if (result.pageType === 'LOGIN_PAGE') return { status: 'login_required', failureReason: null }
  if (result.pageType === 'MFA_PAGE') return { status: 'mfa_required', failureReason: null }
  if (result.pageType === 'BLOCKED_PAGE') return { status: 'blocked', failureReason: result.reason }
  if (result.pageType === 'APPLICATION_PAGE') return { status: 'ready', failureReason: null }
  if (result.pageType === 'JOB_DETAIL_PAGE' || result.pageType === 'REDIRECT_PAGE') {
    return { status: 'job_details', failureReason: result.reason }
  }
  if (result.blockers.includes('unsupported_provider') || result.blockers.includes('unsupported_application_flow')) {
    return { status: 'skipped', failureReason: result.reason }
  }
  return { status: 'failed', failureReason: result.reason }
}
