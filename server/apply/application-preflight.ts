import { classifyApplicationCapability, type ApplicationCapability } from './capability'
import { buildLivePreflight, type LivePreflightResult } from './live-preflight'
import { inspectApplicationUrl } from './validate'
import { hostnameOf, type ApplicationProviderId } from './providers/types'
import { analyzeApplicationSurface } from './surface'
import { logApplyEvent } from './log'
import { decideWorkflowCapability } from './workflow-capability'
import { isSyntheticApplicationHost } from './capability'
import type { AutoApplyQueueItem } from './types'

export interface ApplicationPreflightDecision {
  capability: ApplicationCapability
  provider: ApplicationProviderId | 'unknown'
  initialUrl: string | null
  finalUrl: string | null
  pageType: LivePreflightResult['pageType'] | 'UNREACHED'
  applicationDetected: boolean
  confidence: 'high' | 'medium' | 'low'
  blockers: string[]
  evidence: string[]
  detectedFields: string[]
  detectedButtons: string[]
  iframeCount: number
  hasResumeUpload: boolean
  applyActionAvailable: boolean
  reason: string | null
  checkedAt: string
}

export function applicationPreflight(input: {
  url?: string | null
  applicationUrl?: string | null
  html?: string | null
  documents?: Array<{ html: string; url?: string; inIframe?: boolean }>
  discoveryProvider?: string | null
  accessible?: boolean
  applyFollowed?: boolean
}): ApplicationPreflightDecision {
  const initialUrl = (input.applicationUrl || input.url || '').trim() || null
  const inspected = inspectApplicationUrl(initialUrl)
  const host = classifyApplicationCapability({
    url: input.url,
    applicationUrl: input.applicationUrl,
    html: input.html,
    discoveryProvider: input.discoveryProvider,
  })
  const checkedAt = new Date().toISOString()
  if (input.accessible === false) {
    return {
      capability: 'unsupported',
      provider: host.provider,
      initialUrl,
      finalUrl: inspected.url?.toString() || initialUrl,
      pageType: 'UNREACHED',
      applicationDetected: false,
      confidence: 'high',
      blockers: ['Application URL was not accessible.'],
      evidence: ['The application URL could not be reached.'],
      detectedFields: [],
      detectedButtons: [],
      iframeCount: 0,
      hasResumeUpload: false,
      applyActionAvailable: false,
      reason: 'The application URL could not be reached.',
      checkedAt,
    }
  }
  if (!input.html && !input.documents?.length) {
    return {
      capability: host.capability,
      provider: host.provider,
      initialUrl,
      finalUrl: inspected.url?.toString() || initialUrl,
      pageType: 'UNREACHED',
      applicationDetected: false,
      confidence: host.confidence,
      blockers: host.capability === 'unsupported' ? host.reasons : [],
      evidence: host.reasons,
      detectedFields: [],
      detectedButtons: [],
      iframeCount: 0,
      hasResumeUpload: false,
      applyActionAvailable: false,
      reason: host.reasons[0] ?? null,
      checkedAt,
    }
  }

  const html = input.html || input.documents?.[0]?.html || ''
  const live = buildLivePreflight({
    applicationUrl: initialUrl,
    finalUrl: inspected.url?.toString() || initialUrl,
    html,
    documents: input.documents,
    applyFollowed: input.applyFollowed === true,
  })
  return decisionFromLivePreflight(live, {
    initialUrl,
    applyFollowed: input.applyFollowed === true,
  })
}

export function decisionFromLivePreflight(
  live: LivePreflightResult,
  extras: { initialUrl?: string | null; applyFollowed?: boolean } = {},
): ApplicationPreflightDecision {
  const hostname = live.evidence.hostname || hostnameOf(live.finalUrl || live.applicationUrl || '')
  const synthetic = isSyntheticApplicationHost(hostname, live.finalUrl || live.applicationUrl || '')
  const surface = live.analysis
  const capability = decideWorkflowCapability(
    {
      pageType: live.pageType,
      blockers: live.blockers,
      applicationDetected: live.applicationDetected,
      provider: live.provider,
      detectedFields: live.detectedFields,
      hasResumeUpload: surface.hasResumeUpload,
      iframeDetected: live.iframeDetected,
      applicationFormInIframe: surface.code === 'APPLICATION_FORM_IN_IFRAME',
      finalUrl: live.finalUrl,
      applicationUrl: live.applicationUrl,
    },
    {
      synthetic,
      applyFollowed: extras.applyFollowed === true,
      unknownQuestions: surface.inspection.questions,
    },
  )
  return {
    capability,
    provider: (live.provider || 'unknown') as ApplicationProviderId | 'unknown',
    initialUrl: extras.initialUrl ?? live.applicationUrl,
    finalUrl: live.finalUrl,
    pageType: live.pageType,
    applicationDetected: live.applicationDetected,
    confidence: live.confidence,
    blockers: live.blockers,
    evidence: [...live.blockers, ...surface.signals, live.reason].filter((item): item is string => Boolean(item)),
    detectedFields: live.detectedFields,
    detectedButtons: live.detectedButtons,
    iframeCount: live.evidence.iframes || live.evidence.frames.length,
    hasResumeUpload: surface.hasResumeUpload,
    applyActionAvailable: surface.hasApplyControl,
    reason: reasonForCapability(capability, live),
    checkedAt: new Date().toISOString(),
  }
}

export { decideWorkflowCapability }

function reasonForCapability(capability: ApplicationCapability, live: LivePreflightResult): string | null {
  if (capability === 'auto_apply_supported') {
    return `Application workflow preflighted (${live.provider}) with fields: ${live.detectedFields.join(', ') || 'none'}.`
  }
  if (capability === 'blocked') return live.reason
  if (capability === 'assisted_apply') return 'Unknown required application questions need user input.'
  if (capability === 'unknown' && live.pageType === 'JOB_DETAIL_PAGE') {
    return 'The job page requires an Apply action before the application form appears.'
  }
  if (capability === 'unknown' && live.analysis.code === 'APPLICATION_FORM_IN_IFRAME') {
    return 'An embedded application frame was found and must be inspected before filling.'
  }
  return live.reason || 'The page was classified after collecting evidence and is not a supported application form.'
}

export function surfaceHasApplicationWorkflow(html: string, url?: string | null): boolean {
  const surface = analyzeApplicationSurface(html, { url })
  return surface.kind === 'application' && surface.fields.length > 0
}

export function applyDecisionToQueueItem(item: AutoApplyQueueItem, decision: ApplicationPreflightDecision): AutoApplyQueueItem {
  item.applicationCapability = decision.capability
  item.applicationProvider = decision.provider
  item.applicationSource = decision.provider
  item.initialUrl = decision.initialUrl || item.initialUrl || item.applicationUrl
  item.finalApplicationUrl = decision.finalUrl
  item.capabilityCheckedAt = decision.checkedAt
  item.capabilityReason = decision.reason
  return item
}

export function logApplicationPreflightReport(input: {
  jobId?: string | null
  title?: string | null
  company?: string | null
  discoveryProvider?: string | null
  storedApplicationUrl?: string | null
  redirectChain?: string[] | null
  decision: ApplicationPreflightDecision
}): void {
  const { decision } = input
  logApplyEvent('application-preflight-report', {
    jobId: input.jobId,
    capability: decision.capability,
    discoveryProvider: input.discoveryProvider,
    applicationProvider: decision.provider,
    initialUrl: decision.initialUrl,
    finalUrl: decision.finalUrl,
    pageType: decision.pageType,
    detectedFields: decision.detectedFields,
    blockingReason: decision.reason,
    applicationUrl: decision.finalUrl || decision.initialUrl,
  })
  console.info('[AutoApply] capability-report', {
    JOB: {
      title: input.title ?? null,
      company: input.company ?? null,
      jobId: input.jobId ?? null,
    },
    DISCOVERY: {
      discoveryProvider: input.discoveryProvider ?? null,
    },
    URL: {
      storedApplicationUrl: input.storedApplicationUrl ?? decision.initialUrl,
      initialUrl: decision.initialUrl,
      finalUrl: decision.finalUrl,
      redirectChain: input.redirectChain ?? [],
    },
    PAGE: {
      pageType: decision.pageType,
    },
    PROVIDER: {
      applicationProvider: decision.provider,
    },
    PREFLIGHT: {
      capability: decision.capability,
      confidence: decision.confidence,
      evidence: decision.evidence.slice(0, 12),
    },
    APPLICATION: {
      applicationDetected: decision.applicationDetected,
      detectedFields: decision.detectedFields,
      detectedButtons: decision.detectedButtons,
      iframeCount: decision.iframeCount,
    },
    BLOCKERS: {
      captcha: decision.pageType === 'CAPTCHA_PAGE' || decision.blockers.some((item) => /captcha/i.test(item)),
      login: decision.pageType === 'LOGIN_PAGE' || decision.blockers.some((item) => /login/i.test(item)),
      mfa: decision.pageType === 'MFA_PAGE' || decision.blockers.some((item) => /multi-factor|mfa/i.test(item)),
      unknownRequiredQuestion: decision.capability === 'assisted_apply',
    },
    RESULT: decision.reason,
  })
}

export function statusFromCapability(decision: ApplicationPreflightDecision): {
  status: AutoApplyQueueItem['applicationStatus']
  failureReason: string | null
} {
  if (decision.capability === 'auto_apply_supported') {
    return { status: 'queued', failureReason: null }
  }
  if (decision.pageType === 'CAPTCHA_PAGE') return { status: 'captcha_required', failureReason: null }
  if (decision.pageType === 'LOGIN_PAGE') return { status: 'login_required', failureReason: null }
  if (decision.pageType === 'MFA_PAGE') return { status: 'mfa_required', failureReason: null }
  if (decision.capability === 'blocked') return { status: 'blocked', failureReason: decision.reason }
  if (decision.capability === 'assisted_apply') return { status: 'needs_user_input', failureReason: null }
  return { status: 'skipped', failureReason: decision.reason }
}
