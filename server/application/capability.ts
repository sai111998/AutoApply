import {
  canEnterAutonomousApply,
  classifyApplicationCapability,
  type ApplicationCapability,
  type ApplicationCapabilityResult,
} from '../apply/capability'
import { isAutoApplyReady, preflightApplication, type ApplicationPreflightResult } from '../apply/preflight'

export {
  APPLICATION_CAPABILITIES,
  canEnterAutonomousApply,
  classifyApplicationCapability,
  isJobBoardHost,
  isSyntheticApplicationHost,
  supportedAtsId,
} from '../apply/capability'
export type { ApplicationCapability, ApplicationCapabilityResult, JobSourceKind } from '../apply/capability'

export interface ApplicationCapabilityEvaluation extends ApplicationCapabilityResult {
  preflight: ApplicationPreflightResult
  autoApplyReady: boolean
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
  const preflight = preflightApplication({
    url: input.url,
    applicationUrl: input.applicationUrl,
    provider: classified.provider,
    html: input.html,
    accessible: input.accessible,
    profile: input.profile,
  })
  const capability: ApplicationCapability = preflight.capability
  return {
    ...classified,
    capability,
    reasons: [...classified.reasons, ...preflight.reasons.filter((reason) => !classified.reasons.includes(reason))],
    preflight,
    autoApplyReady: canEnterAutonomousApply(capability) && isAutoApplyReady(preflight),
  }
}

export function capabilityAllowsUnattendedApply(capability: ApplicationCapability | null | undefined): boolean {
  return canEnterAutonomousApply(capability)
}
