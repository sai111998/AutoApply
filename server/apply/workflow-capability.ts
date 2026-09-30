import { canEnterAutonomousApply, classifyApplicationCapability, isSyntheticApplicationHost, type ApplicationCapability } from './capability'
import type { PageType } from './page-classify'

export const WORKFLOW_PROVIDERS = new Set(['workday', 'greenhouse', 'lever', 'ashby', 'icims', 'generic'])

export interface WorkflowCapabilityInput {
  pageType: PageType
  blockers: string[]
  applicationDetected: boolean
  provider: string
  detectedFields: string[]
  hasResumeUpload: boolean
  iframeDetected?: boolean
  applicationFormInIframe?: boolean
  finalUrl: string | null
  applicationUrl: string | null
}

export function decideWorkflowCapability(
  live: WorkflowCapabilityInput,
  options: { synthetic?: boolean; applyFollowed?: boolean; unknownQuestions?: string[] } = {},
): ApplicationCapability {
  if (live.pageType === 'CAPTCHA_PAGE' || live.pageType === 'LOGIN_PAGE' || live.pageType === 'MFA_PAGE' || live.pageType === 'BLOCKED_PAGE') {
    return 'blocked'
  }
  if (live.pageType === 'ERROR_PAGE') return 'unsupported'
  if (live.blockers.includes('unsupported_provider') || live.blockers.includes('unsupported_application_flow')) {
    return 'unsupported'
  }
  if (live.pageType === 'JOB_DETAIL_PAGE' || live.pageType === 'REDIRECT_PAGE') {
    return options.applyFollowed ? 'unsupported' : 'unknown'
  }
  if (live.pageType === 'APPLICATION_PAGE' && live.applicationDetected) {
    const known = /authorized|sponsor|experience|name|email|phone|location|linkedin|github/i
    const unknown = (options.unknownQuestions ?? []).filter((question) => !known.test(question))
    if (unknown.length) return 'assisted_apply'
    if (!WORKFLOW_PROVIDERS.has(live.provider) && !options.synthetic) return 'unsupported'
    if (!live.detectedFields.length) return 'unsupported'
    if (!live.hasResumeUpload && !options.synthetic) return 'unknown'
    return 'auto_apply_supported'
  }
  if (live.applicationFormInIframe || (live.iframeDetected && !options.applyFollowed && live.pageType === 'UNKNOWN_PAGE')) {
    return 'unknown'
  }
  if (options.synthetic && canEnterAutonomousApply(classifyApplicationCapability({ url: live.finalUrl || live.applicationUrl }).capability)) {
    return 'auto_apply_supported'
  }
  return 'unsupported'
}

export function isSyntheticLiveHost(hostname: string, url: string): boolean {
  return isSyntheticApplicationHost(hostname, url)
}
