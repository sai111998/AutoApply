import { isJobBoardHost } from './capability'
import { inspectApplicationPage, type PageInspection } from './detect'
import { classifyPageType, unsupportedProviderName } from './page-classify'
import { hasApplyControl, pageVisibleText, snapshotFromHtml, type PageSnapshot } from './page-snapshot'
import { detectApplicationProvider, type ApplicationProviderId } from './providers'
import { hostnameOf } from './providers/types'

export type ApplicationDetectionCode =
  | 'CAPTCHA_REQUIRED'
  | 'MFA_REQUIRED'
  | 'LOGIN_REQUIRED'
  | 'APPLICATION_PAGE_BLOCKED'
  | 'JOB_PAGE_REQUIRES_APPLY_CLICK'
  | 'APPLICATION_FORM_NOT_RECOGNIZED'
  | 'APPLICATION_FORM_IN_IFRAME'
  | 'APPLICATION_FORM_DETECTED'
  | 'UNSUPPORTED_PROVIDER'
  | 'UNSUPPORTED_APPLICATION_FLOW'
  | 'INVALID_APPLICATION_URL'
  | 'JOB_NOT_FOUND'

export type ApplicationSurfaceKind = 'blocked' | 'job_details' | 'application' | 'unknown'

export interface ApplicationSignal {
  id: string
  weight: number
}

export interface ApplicationAnalysis {
  kind: ApplicationSurfaceKind
  code: ApplicationDetectionCode
  score: number
  signals: string[]
  fields: string[]
  hasApplyControl: boolean
  hasResumeUpload: boolean
  hasNext: boolean
  hasFinalSubmit: boolean
  inIframe: boolean
  provider: ApplicationProviderId
  inspection: PageInspection
  snapshot: PageSnapshot
  failureReason: string | null
}

const CONTROL = '<(input|textarea|select)[^>]*'
const FIELD_PATTERNS: Array<[string, RegExp]> = [
  ['email', new RegExp(`${CONTROL}(type=['"]email['"]|autocomplete=['"]email['"]|name=['"][^'"]*email|id=['"][^'"]*email|aria-label=['"][^'"]*email|placeholder=['"][^'"]*email|data-automation-id=['"]email['"])|<label[^>]*>\\s*email|data-automation-id=['"]formField-email['"]`, 'i')],
  ['first_name', new RegExp(`${CONTROL}(name=['"][^'"]*(first[-_]?name|given)|autocomplete=['"]given-name['"]|aria-label=['"][^'"]*first name)|<label[^>]*>\\s*first name`, 'i')],
  ['last_name', new RegExp(`${CONTROL}(name=['"][^'"]*(last[-_]?name|family|surname)|autocomplete=['"]family-name['"]|aria-label=['"][^'"]*last name)|<label[^>]*>\\s*last name`, 'i')],
  ['full_name', new RegExp(`${CONTROL}(name=['"]([^'"]*full[_-]?name|name)['"]|autocomplete=['"]name['"]|aria-label=['"][^'"]*(full )?name)`, 'i')],
  ['phone', new RegExp(`${CONTROL}(type=['"]tel['"]|autocomplete=['"]tel['"]|name=['"][^'"]*(phone|mobile)|aria-label=['"][^'"]*phone)|<label[^>]*>\\s*(phone|mobile)`, 'i')],
  ['address', new RegExp(`${CONTROL}(autocomplete=['"]street-address['"]|name=['"][^'"]*address|aria-label=['"][^'"]*address)|<label[^>]*>\\s*address`, 'i')],
  ['city', new RegExp(`${CONTROL}(autocomplete=['"]address-level2['"]|name=['"][^'"]*city|aria-label=['"][^'"]*city)|<label[^>]*>\\s*city`, 'i')],
  ['state', new RegExp(`${CONTROL}(autocomplete=['"]address-level1['"]|name=['"][^'"]*state)|<label[^>]*>\\s*state`, 'i')],
  ['zip', new RegExp(`${CONTROL}(autocomplete=['"]postal-code['"]|name=['"][^'"]*(zip|postal))|<label[^>]*>\\s*(zip|postal)`, 'i')],
  ['country', new RegExp(`${CONTROL}(autocomplete=['"]country['"]|name=['"][^'"]*country)|<label[^>]*>\\s*country`, 'i')],
  ['linkedin', new RegExp(`${CONTROL}(name|id|aria-label|placeholder)=['"][^'"]*linkedin`, 'i')],
  ['github', new RegExp(`${CONTROL}(name|id|aria-label|placeholder)=['"][^'"]*github`, 'i')],
  ['resume', /type=['"]file['"]|<label[^>]*>\s*(upload )?(your )?(resume|cv)/i],
  ['cover_letter', new RegExp(`${CONTROL}(name|id|aria-label)=['"][^'"]*cover|label[^>]*>\\s*cover[-_ ]letter`, 'i')],
  ['education', /<label[^>]*>[\s\S]*?(education|school|degree|university)|name=['"][^'"]*(education|school|degree)/i],
  ['experience', /<label[^>]*>[\s\S]*?(work experience|years of experience)|name=['"][^'"]*(experience|employer)/i],
  ['work_authorization', /<label[^>]*>[\s\S]*?(work authorization|authorized to work)|name=['"][^'"]*(work[-_]?auth|authorization)/i],
  ['sponsorship', /<label[^>]*>[\s\S]*?sponsor|name=['"][^'"]*sponsor/i],
  ['salary', /<label[^>]*>[\s\S]*?(salary|compensation|pay rate)|name=['"][^'"]*(salary|compensation)/i],
]

const APPLICATION_SCORE_THRESHOLD = 3

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function collectSignals(html: string): { signals: ApplicationSignal[]; fields: string[] } {
  const fields: string[] = []
  const signals: ApplicationSignal[] = []
  for (const [field, pattern] of FIELD_PATTERNS) {
    if (pattern.test(html)) {
      fields.push(field)
      signals.push({ id: `field:${field}`, weight: field === 'email' || field === 'resume' || field === 'full_name' ? 2 : 1 })
    }
  }
  if (/<label[^>]*>[\s\S]{0,80}(first name|last name|email|phone|resume|cover letter|linkedin|work authorization)/i.test(html)) {
    signals.push({ id: 'semantic_labels', weight: 2 })
  }
  if (/\b(submit application|start application|upload resume|upload cv)\b/i.test(html)) {
    signals.push({ id: 'application_controls', weight: 1 })
  }
  if (/role=['"]textbox['"]|contenteditable=['"]true['"]/i.test(html) && fields.length) {
    signals.push({ id: 'accessible_fields', weight: 1 })
  }
  if (/type=['"]submit['"]|aria-label=['"]next['"]|>\s*next\s*</i.test(html)) signals.push({ id: 'next_or_submit', weight: 1 })
  if (/job application form|application form|candidate experience/i.test(html)) signals.push({ id: 'application_copy', weight: 1 })
  return { signals, fields: unique(fields) }
}

function unknownFailureReason(url: string, inIframe: boolean): { code: ApplicationDetectionCode; failureReason: string } {
  const hostname = hostnameOf(url)
  if (isJobBoardHost(hostname)) {
    return {
      code: 'UNSUPPORTED_APPLICATION_FLOW',
      failureReason: 'This listing does not lead to a supported application flow.',
    }
  }
  const unsupported = unsupportedProviderName(hostname)
  if (unsupported) {
    return {
      code: 'UNSUPPORTED_PROVIDER',
      failureReason: `This application provider (${unsupported}) is not supported for autonomous Auto Apply.`,
    }
  }
  if (inIframe) {
    return {
      code: 'APPLICATION_FORM_IN_IFRAME',
      failureReason: 'An embedded application frame was found and must be inspected before filling.',
    }
  }
  return {
    code: 'APPLICATION_FORM_NOT_RECOGNIZED',
    failureReason: 'The page was classified after collecting evidence and is not a supported application form.',
  }
}

function withQuestionSignals(
  collected: { signals: ApplicationSignal[]; fields: string[] },
  questions: string[],
) {
  if (questions.length) collected.signals.push({ id: 'questions', weight: 2 })
  return collected
}

function blockedCode(status: PageInspection['status']): ApplicationDetectionCode | null {
  if (status === 'captcha_required') return 'CAPTCHA_REQUIRED'
  if (status === 'mfa_required') return 'MFA_REQUIRED'
  if (status === 'login_required') return 'LOGIN_REQUIRED'
  if (status === 'blocked' || status === 'automation_blocked') return 'APPLICATION_PAGE_BLOCKED'
  return null
}

export function looksLikeMissingJobPage(html: string, text = pageVisibleText(html)): boolean {
  return /page you are looking for doesn't exist|this job is no longer available|this job posting is no longer|job has been filled|requisition is closed|errorMessage/i.test(
    `${html} ${text}`,
  ) && /doesn't exist|no longer available|has been filled|requisition is closed/i.test(text)
}

export function looksLikeJobDetailsPage(html: string, score: number, applyControl: boolean): boolean {
  const text = pageVisibleText(html)
  const jobCopy =
    /job description|job identification|job requisition|posting date|view more jobs|job category|time left to apply|jobPostingDescription|jobPostingHeader/i.test(
      `${html} ${text}`,
    )
  const workdayJob = /data-automation-id=['"]jobPosting(Page|Header|Description)['"]/i.test(html)
  return applyControl && score < APPLICATION_SCORE_THRESHOLD && (jobCopy || workdayJob || /\/job\/[^/]+/i.test(html))
}

export function analyzeApplicationSurface(
  html: string,
  input: { url?: string | null; inIframe?: boolean } = {},
): ApplicationAnalysis {
  const url = input.url ?? ''
  const snapshot = snapshotFromHtml(html, url)
  const inspection = inspectApplicationPage(html)
  const provider = detectApplicationProvider({ url, html })
  const applyControl = hasApplyControl(html)
  const collected = withQuestionSignals(collectSignals(html), inspection.questions)
  const score = collected.signals.reduce((sum, signal) => sum + signal.weight, 0)
  const hasResumeUpload = collected.fields.includes('resume') || inspection.hasFileInput
  const hasNext = /aria-label=['"]next['"]|>\s*next\s*<|continue/i.test(html)
  const hasFinalSubmit = /submit application|send application|>\s*submit\s*</i.test(html)
  if (looksLikeMissingJobPage(html)) {
    return {
      kind: 'unknown',
      code: 'JOB_NOT_FOUND',
      score,
      signals: collected.signals.map((item) => item.id),
      fields: collected.fields,
      hasApplyControl: applyControl,
      hasResumeUpload,
      hasNext,
      hasFinalSubmit,
      inIframe: Boolean(input.inIframe),
      provider: provider.id,
      inspection,
      snapshot,
      failureReason: 'This job is no longer available.',
    }
  }
  const blocked = blockedCode(inspection.status)
  if (blocked) {
    return {
      kind: 'blocked',
      code: blocked,
      score,
      signals: collected.signals.map((item) => item.id),
      fields: collected.fields,
      hasApplyControl: applyControl,
      hasResumeUpload,
      hasNext,
      hasFinalSubmit,
      inIframe: Boolean(input.inIframe),
      provider: provider.id,
      inspection,
      snapshot,
      failureReason: inspection.failureReason,
    }
  }

  if (score >= APPLICATION_SCORE_THRESHOLD || (inspection.hasSubmit && collected.fields.length > 0)) {
    return {
      kind: 'application',
      code: 'APPLICATION_FORM_DETECTED',
      score,
      signals: collected.signals.map((item) => item.id),
      fields: collected.fields,
      hasApplyControl: applyControl,
      hasResumeUpload,
      hasNext,
      hasFinalSubmit,
      inIframe: Boolean(input.inIframe),
      provider: provider.id,
      inspection,
      snapshot,
      failureReason: null,
    }
  }

  if (looksLikeJobDetailsPage(html, score, applyControl)) {
    return {
      kind: 'job_details',
      code: 'JOB_PAGE_REQUIRES_APPLY_CLICK',
      score,
      signals: collected.signals.map((item) => item.id),
      fields: collected.fields,
      hasApplyControl: applyControl,
      hasResumeUpload,
      hasNext,
      hasFinalSubmit,
      inIframe: Boolean(input.inIframe),
      provider: provider.id,
      inspection,
      snapshot,
      failureReason: 'The job page requires an Apply action before the application form appears.',
    }
  }

  const applicationFrame = snapshot.iframeUrls.some(
    (frame) => /greenhouse|lever|workday|icims|oraclecloud|ashby|apply/i.test(frame) && !/hcaptcha|recaptcha|turnstile/i.test(frame),
  )
  if (applicationFrame && score < APPLICATION_SCORE_THRESHOLD) {
    return {
      kind: 'unknown',
      code: 'APPLICATION_FORM_IN_IFRAME',
      score,
      signals: collected.signals.map((item) => item.id),
      fields: collected.fields,
      hasApplyControl: applyControl,
      hasResumeUpload,
      hasNext,
      hasFinalSubmit,
      inIframe: true,
      provider: provider.id,
      inspection,
      snapshot,
      failureReason: 'An embedded application frame was found and must be inspected before filling.',
    }
  }

  const classification = classifyPageType({
    html,
    url,
    inspection,
    applicationScore: score,
    applicationKind: 'unknown',
    hasApplyControl: applyControl,
    inIframe: Boolean(input.inIframe) || applicationFrame,
  })
  const unknown = unknownFailureReason(url, Boolean(input.inIframe) || applicationFrame)
  return {
    kind: classification.pageType === 'JOB_DETAIL_PAGE' ? 'job_details' : 'unknown',
    code:
      classification.pageType === 'JOB_DETAIL_PAGE'
        ? 'JOB_PAGE_REQUIRES_APPLY_CLICK'
        : unknown.code,
    score,
    signals: collected.signals.map((item) => item.id),
    fields: collected.fields,
    hasApplyControl: applyControl,
    hasResumeUpload,
    hasNext,
    hasFinalSubmit,
    inIframe: Boolean(input.inIframe) || applicationFrame,
    provider: provider.id,
    inspection,
    snapshot,
    failureReason:
      classification.pageType === 'JOB_DETAIL_PAGE'
        ? 'The job page requires an Apply action before the application form appears.'
        : unknown.failureReason,
  }
}

export function mergeSurfaceDocuments(documents: Array<{ html: string; url?: string; inIframe?: boolean }>): ApplicationAnalysis {
  const analyses = documents.map((document) => analyzeApplicationSurface(document.html, document))
  const blocked = analyses.find((item) => item.kind === 'blocked')
  if (blocked) return blocked
  const application = analyses.find((item) => item.kind === 'application')
  if (application) return application
  const job = analyses.find((item) => item.kind === 'job_details')
  if (job) return job
  return analyses[0] ?? analyzeApplicationSurface('', {})
}

export const APPLICATION_FORM_SCORE_THRESHOLD = APPLICATION_SCORE_THRESHOLD
