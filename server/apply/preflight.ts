import { analyzeCaptcha } from './captcha'
import {
  canEnterAutonomousApply,
  classifyApplicationCapability,
  type ApplicationCapability,
  type ApplicationCapabilityResult,
} from './capability'
import { applicationPreflight } from './application-preflight'
import type { ApplicationProviderId } from './providers/types'

export interface ApplicationPreflightResult {
  capability: ApplicationCapability
  provider: ApplicationProviderId | 'unknown'
  confidence: 'high' | 'medium' | 'low'
  reasons: string[]
  blockers: string[]
  captcha: boolean
  captchaDetectionConfidence: ReturnType<typeof analyzeCaptcha>['captchaDetectionConfidence']
  captchaEvidence: string[]
  source: ApplicationCapabilityResult
}

export function preflightApplication(input: {
  url?: string | null
  applicationUrl?: string | null
  provider?: string | null
  html?: string | null
  accessible?: boolean
  profile?: { email?: string | null; fullName?: string | null }
}): ApplicationPreflightResult {
  const source = classifyApplicationCapability({
    url: input.url,
    applicationUrl: input.applicationUrl,
    html: input.html,
    discoveryProvider: input.provider,
  })
  const decision = applicationPreflight({
    url: input.url,
    applicationUrl: input.applicationUrl,
    html: input.html,
    discoveryProvider: input.provider,
    accessible: input.accessible,
  })
  const captcha = analyzeCaptcha(input.html ?? '')
  let capability = decision.capability
  const blockers = [...decision.blockers]
  const reasons = [...decision.evidence]
  if (input.profile && (!input.profile.email || !input.profile.fullName) && capability === 'auto_apply_supported') {
    blockers.push('Required profile fields are missing.')
    capability = 'assisted_apply'
    reasons.push('Candidate profile is missing name or email.')
  }
  return {
    capability,
    provider: decision.provider,
    confidence: decision.confidence,
    reasons,
    blockers,
    captcha: captcha.captcha,
    captchaDetectionConfidence: captcha.captchaDetectionConfidence,
    captchaEvidence: captcha.captchaEvidence,
    source,
  }
}

export function isAutoApplyReady(result: ApplicationPreflightResult): boolean {
  return canEnterAutonomousApply(result.capability) && result.blockers.length === 0
}
