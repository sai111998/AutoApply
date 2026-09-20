import { analyzeCaptcha } from './captcha'
import { isJobBoardHost, supportedAtsId } from './capability'
import { inspectApplicationPage, type PageInspection } from './detect'
import { hasApplyControl, pageVisibleText } from './page-snapshot'
import { detectApplicationProvider } from './providers'
import { hostnameOf, type ApplicationProviderId } from './providers/types'

export const PAGE_TYPES = [
  'JOB_DETAIL_PAGE',
  'APPLICATION_PAGE',
  'LOGIN_PAGE',
  'CAPTCHA_PAGE',
  'MFA_PAGE',
  'ERROR_PAGE',
  'REDIRECT_PAGE',
  'BLOCKED_PAGE',
  'UNKNOWN_PAGE',
] as const

export type PageType = (typeof PAGE_TYPES)[number]

export interface PageClassification {
  pageType: PageType
  provider: ApplicationProviderId | 'unknown'
  confidence: 'high' | 'medium' | 'low'
  reasons: string[]
  applicationDetected: boolean
}

const UNSUPPORTED_PROVIDER_HOSTS: Array<[RegExp, string]> = [
  [/(?:^|\.)smartrecruiters\.com$/i, 'smartrecruiters'],
  [/(?:^|\.)workable\.com$/i, 'workable'],
  [/(?:^|\.)taleo\.net$/i, 'taleo'],
]

export function unsupportedProviderName(hostname: string): string | null {
  const match = UNSUPPORTED_PROVIDER_HOSTS.find(([pattern]) => pattern.test(hostname))
  return match?.[1] ?? null
}

export function looksLikeRedirectPage(html: string, text: string): boolean {
  if (/http-equiv=['"]refresh['"]/i.test(html)) return true
  if (/window\.location|document\.location/i.test(html) && /redirect/i.test(html)) return true
  return /^(redirecting|please wait|loading application)\b/i.test(text) && text.length < 200
}

export function classifyPageType(input: {
  html: string
  url?: string | null
  inspection?: PageInspection
  applicationScore?: number
  applicationKind?: 'blocked' | 'job_details' | 'application' | 'unknown'
  hasApplyControl?: boolean
  inIframe?: boolean
}): PageClassification {
  const url = input.url ?? ''
  const html = input.html ?? ''
  const text = pageVisibleText(html)
  const inspection = input.inspection ?? inspectApplicationPage(html)
  const hostname = hostnameOf(url)
  const provider = detectApplicationProvider({ url, html }).id
  const reasons: string[] = []
  const applyControl = input.hasApplyControl ?? hasApplyControl(html, text)
  const captcha = analyzeCaptcha(html, text)

  if (inspection.status === 'captcha_required' || captcha.captcha) {
    reasons.push('Strong CAPTCHA evidence is present.')
    return { pageType: 'CAPTCHA_PAGE', provider, confidence: 'high', reasons, applicationDetected: false }
  }
  if (inspection.status === 'mfa_required') {
    reasons.push('MFA challenge controls are present.')
    return { pageType: 'MFA_PAGE', provider, confidence: 'high', reasons, applicationDetected: false }
  }
  if (inspection.status === 'login_required') {
    reasons.push('Employer login controls are present.')
    return { pageType: 'LOGIN_PAGE', provider, confidence: 'high', reasons, applicationDetected: false }
  }
  if (inspection.status === 'automation_blocked' || inspection.status === 'blocked') {
    reasons.push('The employer site blocked automated access.')
    return { pageType: 'BLOCKED_PAGE', provider, confidence: 'high', reasons, applicationDetected: false }
  }
  if (
    /page you are looking for doesn't exist|this job is no longer available|this job posting is no longer|job has been filled|requisition is closed/i.test(
      text,
    )
  ) {
    reasons.push('The employer page reports the job is missing or closed.')
    return { pageType: 'ERROR_PAGE', provider, confidence: 'high', reasons, applicationDetected: false }
  }
  if (input.applicationKind === 'application' || (input.applicationScore ?? 0) >= 3) {
    reasons.push(input.inIframe ? 'Application signals were found inside a frame.' : 'Application signals were found on the page.')
    return { pageType: 'APPLICATION_PAGE', provider, confidence: 'high', reasons, applicationDetected: true }
  }
  if (looksLikeRedirectPage(html, text)) {
    reasons.push('The page looks like an intermediate redirect.')
    return { pageType: 'REDIRECT_PAGE', provider, confidence: 'medium', reasons, applicationDetected: false }
  }
  if (input.applicationKind === 'job_details' || (applyControl && /job description|job requisition|posting date|view more jobs/i.test(text))) {
    reasons.push('A job details page with an Apply action was found.')
    return { pageType: 'JOB_DETAIL_PAGE', provider, confidence: 'high', reasons, applicationDetected: false }
  }
  if (isJobBoardHost(hostname)) {
    reasons.push('The URL is a job-board listing, not a supported employer application.')
    return { pageType: 'UNKNOWN_PAGE', provider: 'unknown', confidence: 'high', reasons, applicationDetected: false }
  }
  if (unsupportedProviderName(hostname)) {
    reasons.push(`Host ${hostname} is an unsupported application provider.`)
    return { pageType: 'UNKNOWN_PAGE', provider: 'unknown', confidence: 'high', reasons, applicationDetected: false }
  }
  if (supportedAtsId(hostname) && applyControl) {
    reasons.push('Supported ATS host with an Apply action, but the application form is not visible yet.')
    return { pageType: 'JOB_DETAIL_PAGE', provider, confidence: 'medium', reasons, applicationDetected: false }
  }
  reasons.push('The page did not match a known application, login, CAPTCHA, or job-detail pattern.')
  return { pageType: 'UNKNOWN_PAGE', provider, confidence: 'low', reasons, applicationDetected: false }
}
