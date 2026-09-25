export { FIELD_SELECTORS } from '../browser-worker/providers'
import type { AutoApplyProfile } from '../apply/types'
import { candidateFillValues, buildCandidateApplicationProfile } from './profile'

export function profileFieldValues(profile: AutoApplyProfile): Record<string, string> {
  return candidateFillValues(buildCandidateApplicationProfile({ profile }))
}
