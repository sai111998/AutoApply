import { applicationPreflight, type ApplicationPreflightDecision } from '../apply/application-preflight'
import {
  canEnterAutonomousApply,
  classifyApplicationCapability,
  type ApplicationCapability,
  type ApplicationCapabilityResult,
} from '../apply/capability'
import { isAutoApplyReady, preflightApplication, type ApplicationPreflightResult } from '../apply/preflight'
import { detectRegisteredProvider } from './providers/registry'

export {
  APPLICATION_CAPABILITIES,
  canEnterAutonomousApply,
  classifyApplicationCapability,
  isJobBoardHost,
  isSyntheticApplicationHost,
  supportedAtsId,
} from '../apply/capability'
export type { ApplicationCapability, ApplicationCapabilityResult, JobSourceKind } from '../apply/capability'
export { applicationPreflight } from '../apply/application-preflight'
export {
  applicationProviderRegistry,
  detectRegisteredProvider,
  isApplicationProviderRegistryPopulated,
} from './providers/registry'

export interface ApplicationCapabilityEvaluation extends ApplicationCapabilityResult {
  preflight: ApplicationPreflightResult
  autoApplyReady: boolean
}

export function applyRegistryToCapabilityDecision(
  decision: ApplicationPreflightDecision,
  extras: { url?: string | null; html?: string | null } = {},
): ApplicationPreflightDecision {
  const url = extras.url || decision.finalUrl || decision.initialUrl
  const detected = detectRegisteredProvider({ url, html: extras.html })
  const provider = detected.provider !== 'unknown' ? detected.provider : decision.provider
  const namedUnsupported =
    detected.provider !== 'unknown' &&
    detected.provider !== 'generic' &&
    !detected.supported &&
    decision.capability === 'auto_apply_supported'
  if (namedUnsupported) {
    return {
      ...decision,
      provider,
      capability: 'unsupported',
      reason: `Application provider (${provider}) is detected but its workflow adapter is not supported for unattended Auto Apply.`,
      evidence: [...detected.evidence, ...decision.evidence],
      confidence: detected.confidence,
      blockers: [...decision.blockers, `unsupported_provider:${provider}`],
    }
  }
  return {
    ...decision,
    provider,
    evidence: [...detected.evidence.filter((item) => !decision.evidence.includes(item)), ...decision.evidence],
  }
}

export function getApplicationCapability(input: {
  url?: string | null
  applicationUrl?: string | null
  html?: string | null
  documents?: Array<{ html: string; url?: string; inIframe?: boolean }>
  discoveryProvider?: string | null
  accessible?: boolean
  applyFollowed?: boolean
}): ApplicationPreflightDecision {
  const decision = applicationPreflight({
    url: input.url,
    applicationUrl: input.applicationUrl,
    html: input.html,
    documents: input.documents,
    discoveryProvider: input.discoveryProvider,
    accessible: input.accessible,
    applyFollowed: input.applyFollowed,
  })
  return applyRegistryToCapabilityDecision(decision, {
    url: input.applicationUrl || input.url || decision.finalUrl || decision.initialUrl,
    html: input.html,
  })
}

export function evaluateApplicationCapability(input: {
  url?: string | null
  applicationUrl?: string | null
  html?: string | null
  discoveryProvider?: string | null
  accessible?: boolean
  profile?: { email?: string | null; fullName?: string | null }
}): ApplicationCapabilityEvaluation {
  const classified = classifyApplicationCapability({
    url: input.url,
    applicationUrl: input.applicationUrl,
    html: input.html,
    discoveryProvider: input.discoveryProvider,
  })
  const decision = getApplicationCapability(input)
  const preflight = preflightApplication({
    url: input.url,
    applicationUrl: input.applicationUrl,
    provider: classified.provider,
    html: input.html,
    accessible: input.accessible,
    profile: input.profile,
  })
  const capability: ApplicationCapability = decision.capability
  return {
    ...classified,
    capability,
    provider: decision.provider,
    reasons: [...classified.reasons, ...decision.evidence.filter((reason) => !classified.reasons.includes(reason))],
    preflight: { ...preflight, capability },
    autoApplyReady: canEnterAutonomousApply(capability) && isAutoApplyReady({ ...preflight, capability }),
  }
}

export function capabilityAllowsUnattendedApply(capability: ApplicationCapability | null | undefined): boolean {
  return canEnterAutonomousApply(capability)
}
