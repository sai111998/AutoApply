import { logV2, v2LogChannel } from './log'
import { getV2Run, updateV2Run } from './queue'
import { V2_STAGES, type V2QueueItem, type V2Stage, type V2TraceEntry } from './types'

export function v2TraceEntry(stage: V2Stage): V2TraceEntry {
  return { stage, at: new Date().toISOString() }
}

export function traceV2(runId: string, stage: V2Stage, details: Record<string, string | number | boolean | null> = {}) {
  const run = getV2Run(runId)
  if (run && !run.trace?.some((entry) => entry.stage === stage)) {
    updateV2Run(runId, { trace: [...(run.trace ?? []), v2TraceEntry(stage)] })
  }
  logV2(stage, details, v2LogChannel(run?.source))
}

export function firstMissingV2Stage(run: Pick<V2QueueItem, 'trace'>): V2Stage | null {
  const reached = new Set(run.trace?.map((entry) => entry.stage))
  // The employer link can open the application form directly, in which case there is no Apply action to find.
  const openedOnApplication = reached.has('APPLICATION_DETECTED') && !reached.has('APPLY_FOUND')
  for (const stage of V2_STAGES) {
    if (reached.has(stage)) continue
    if (openedOnApplication && (stage === 'APPLY_FOUND' || stage === 'APPLY_CLICKED')) continue
    return stage
  }
  return null
}
