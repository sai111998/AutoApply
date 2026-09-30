import { detectApplicationProvider, hostnameOf } from './providers'
import type { ApplicationProviderId } from './providers/types'
import { inspectApplicationUrl } from './validate'

export const APPLICATION_CAPABILITIES = [
  'auto_apply_supported',
  'assisted_apply',
  'unsupported',
  'blocked',
  'unknown',
] as const

export type ApplicationCapability = (typeof APPLICATION_CAPABILITIES)[number]

export type JobSourceKind = 'discovery_only' | 'auto_apply_ready' | 'mixed'

export interface ApplicationCapabilityResult {
  capability: ApplicationCapability
  provider: ApplicationProviderId | 'unknown'
  discoverySource: string | null
  applicationSource: string | null
  sourceKind: JobSourceKind
  confidence: 'high' | 'medium' | 'low'
  reasons: string[]
}

const JOB_BOARD_HOSTS = [
  /(?:^|\.)indeed\.com$/i,
  /(?:^|\.)linkedin\.com$/i,
  /(?:^|\.)ziprecruiter\.com$/i,
  /(?:^|\.)glassdoor\.com$/i,
  /(?:^|\.)jooble\.org$/i,
  /(?:^|\.)simplyhired\.com$/i,
  /(?:^|\.)monster\.com$/i,
  /(?:^|\.)dice\.com$/i,
  /(?:^|\.)careerbuilder\.com$/i,
  /(?:^|\.)usajobs\.gov$/i,
  /(?:^|\.)wellfound\.com$/i,
]

const SUPPORTED_ATS: Array<[RegExp, ApplicationProviderId]> = [
  [/(?:^|\.)myworkdayjobs\.com$/i, 'workday'],
  [/(?:^|\.)greenhouse\.io$/i, 'greenhouse'],
  [/(?:^|\.)jobs\.lever\.co$/i, 'lever'],
  [/(?:^|\.)lever\.co$/i, 'lever'],
  [/(?:^|\.)ashbyhq\.com$/i, 'ashby'],
  [/(?:^|\.)icims\.com$/i, 'icims'],
]

export function isJobBoardHost(hostname: string): boolean {
  return JOB_BOARD_HOSTS.some((pattern) => pattern.test(hostname))
}

export function supportedAtsId(hostname: string): ApplicationProviderId | null {
  const match = SUPPORTED_ATS.find(([pattern]) => pattern.test(hostname))
  return match?.[1] ?? null
}

export function isSyntheticApplicationHost(hostname: string, url: string): boolean {
  return (
    /(?:^|\.)jobs\.example\.com$/i.test(hostname) ||
    /\/test-employer(?:\/|$)/i.test(url) ||
    /\/browser-worker\/synthetic\//i.test(url) ||
    /\/extension\/test\//i.test(url)
  )
}

export function canEnterAutonomousApply(capability: ApplicationCapability | null | undefined): boolean {
  return capability === 'auto_apply_supported'
}

export function classifyApplicationCapability(input: {
  url?: string | null
  applicationUrl?: string | null
  html?: string | null
  discoveryProvider?: string | null
}): ApplicationCapabilityResult {
  const rawUrl = (input.applicationUrl || input.url || '').trim()
  const inspected = inspectApplicationUrl(rawUrl)
  const hostname = inspected.url ? inspected.url.hostname.toLowerCase() : hostnameOf(rawUrl)
  const url = inspected.url?.toString() || rawUrl
  const detected = detectApplicationProvider({ url, html: input.html })
  const discoverySource = input.discoveryProvider?.trim() || null
  const applicationSource = hostname || null
  const reasons: string[] = []

  if (!rawUrl) {
    return {
      capability: 'unsupported',
      provider: 'unknown',
      discoverySource,
      applicationSource,
      sourceKind: 'discovery_only',
      confidence: 'high',
      reasons: ['Application URL is missing.'],
    }
  }
  if (!inspected.ok) {
    return {
      capability: 'unsupported',
      provider: 'unknown',
      discoverySource,
      applicationSource,
      sourceKind: 'discovery_only',
      confidence: 'high',
      reasons: ['Application URL is invalid.'],
    }
  }

  if (isJobBoardHost(hostname)) {
    reasons.push('Listing points at a job board rather than a supported employer ATS.')
    return {
      capability: 'unsupported',
      provider: 'unknown',
      discoverySource,
      applicationSource,
      sourceKind: 'discovery_only',
      confidence: 'high',
      reasons,
    }
  }

  if (isSyntheticApplicationHost(hostname, url)) {
    reasons.push('Synthetic or controlled employer application is Auto-Apply capable.')
    return {
      capability: 'auto_apply_supported',
      provider: detected.id === 'generic' ? 'generic' : detected.id,
      discoverySource,
      applicationSource,
      sourceKind: 'auto_apply_ready',
      confidence: 'high',
      reasons,
    }
  }

  const ats = supportedAtsId(hostname) ?? (detected.id !== 'generic' && detected.id !== 'oraclecloud' && detected.id !== 'smartrecruiters' ? detected.id : null)
  if (ats === 'workday' || ats === 'greenhouse' || ats === 'lever' || ats === 'ashby' || ats === 'icims') {
    reasons.push(`Known ATS host detected (${ats}). Workflow support is unknown until application preflight.`)
    return {
      capability: 'unknown',
      provider: ats,
      discoverySource,
      applicationSource,
      sourceKind: discoverySource && discoverySource !== ats ? 'mixed' : 'discovery_only',
      confidence: 'medium',
      reasons,
    }
  }

  reasons.push('Application provider is unknown. This listing is discovery-only until a supported workflow is confirmed.')
  return {
    capability: 'unknown',
    provider: detected.id === 'generic' ? 'unknown' : detected.id,
    discoverySource,
    applicationSource,
    sourceKind: 'discovery_only',
    confidence: 'low',
    reasons,
  }
}

export function isKnownAtsProvider(provider: string | null | undefined): boolean {
  return provider === 'workday' || provider === 'greenhouse' || provider === 'lever' || provider === 'ashby' || provider === 'icims'
}

export function isAutoApplyCandidateHost(result: ApplicationCapabilityResult): boolean {
  if (result.capability === 'auto_apply_supported') return true
  if (result.capability === 'unsupported' || result.capability === 'blocked') return false
  return isKnownAtsProvider(result.provider)
}
