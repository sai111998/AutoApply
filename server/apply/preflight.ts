import { analyzeCaptcha } from './captcha'
import {
  canEnterAutonomousApply,
  classifyApplicationCapability,
  type ApplicationCapability,
  type ApplicationCapabilityResult,
} from './capability'
import { inspectApplicationPage } from './detect'
import { analyzeApplicationSurface } from './surface'
import { inspectApplicationUrl } from './validate'
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
  const targetUrl = input.applicationUrl || input.url
  const source = classifyApplicationCapability({
    url: input.url,
    applicationUrl: input.applicationUrl,
    html: input.html,
    discoveryProvider: input.provider,
  })
  const reasons = [...source.reasons]
  const blockers: string[] = []
  const inspected = inspectApplicationUrl(targetUrl)
  let capability = source.capability
  let confidence = source.confidence
  const captcha = analyzeCaptcha(input.html ?? '')

  if (!inspected.ok) {
    blockers.push('URL is missing or invalid.')
    capability = 'unsupported'
    confidence = 'high'
  }
  if (input.accessible === false) {
    blockers.push('Application URL was not accessible.')
    capability = 'unsupported'
    confidence = 'high'
    reasons.push('The application URL could not be reached.')
  }

  if (input.html) {
    const page = inspectApplicationPage(input.html)
    const surface = analyzeApplicationSurface(input.html, { url: inspected.url?.toString() || targetUrl })
    if (page.captcha || page.status === 'captcha_required') {
      blockers.push('CAPTCHA challenge detected.')
      capability = 'blocked'
      confidence = page.captchaDetectionConfidence === 'high' ? 'high' : 'medium'
      reasons.push(...page.captchaEvidence)
    } else if (page.status === 'login_required') {
      blockers.push('Employer login is required.')
      capability = 'blocked'
      confidence = 'high'
      reasons.push('Login wall detected before the application form.')
    } else if (page.status === 'mfa_required') {
      blockers.push('Multi-factor authentication is required.')
      capability = 'blocked'
      confidence = 'high'
      reasons.push('MFA challenge detected.')
    } else if (page.status === 'automation_blocked' || page.status === 'blocked') {
      blockers.push('Automated access is blocked.')
      capability = 'blocked'
      confidence = 'high'
    } else if (surface.kind === 'unknown' && !surface.hasApplyControl && surface.fields.length === 0) {
      blockers.push('Application form was not found.')
      if (canEnterAutonomousApply(capability)) {
        capability = 'unknown'
        confidence = 'low'
      }
      reasons.push('No apply action or application fields were detectable.')
    } else if (surface.kind === 'job_details' && !surface.hasApplyControl) {
      blockers.push('Apply action is not available.')
      capability = capability === 'auto_apply_supported' ? 'unknown' : capability
      reasons.push('Job page does not expose a supported Apply action.')
    } else if (page.questions.length && surface.kind === 'application') {
      const known = /authorized|sponsor|experience|name|email|phone|location|linkedin|github/i
      const unknown = page.questions.filter((question) => !known.test(question))
      if (unknown.length) {
        capability = 'assisted_apply'
        confidence = 'medium'
        reasons.push('Unknown required application questions need user input.')
        blockers.push('Unknown required question.')
      }
    }

    if (surface.hasApplyControl) reasons.push('Apply action is available.')
    if (surface.kind === 'application') reasons.push('Application form is reachable.')
    if (surface.fields.length) reasons.push(`Expected fields detected: ${surface.fields.slice(0, 6).join(', ')}.`)
    if (surface.hasResumeUpload) reasons.push('Resume upload is supported.')
    if (input.profile && (!input.profile.email || !input.profile.fullName)) {
      blockers.push('Required profile fields are missing.')
      if (capability === 'auto_apply_supported') capability = 'assisted_apply'
      reasons.push('Candidate profile is missing name or email.')
    }
  }

  return {
    capability,
    provider: source.provider,
    confidence,
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
