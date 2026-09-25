import type { CanonicalCandidateProfile } from '../application/candidate-profile'
import type { V2Resume } from './types'

export interface V2RunInputs {
  profile: CanonicalCandidateProfile
  resume: V2Resume
}

// Kept in memory only: the profile and resume file loaded with the user's session never touch the queue file.
const inputsByRun = new Map<string, V2RunInputs>()

export function rememberV2RunInputs(runId: string, inputs: V2RunInputs) {
  inputsByRun.set(runId, inputs)
}

export function takeV2RunInputs(runId: string): V2RunInputs | null {
  const inputs = inputsByRun.get(runId) ?? null
  inputsByRun.delete(runId)
  return inputs
}

export function resetV2RunInputsForTests() {
  inputsByRun.clear()
}
