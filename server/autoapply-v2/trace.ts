import { logV2, v2LogChannel } from './log'
import { getV2Run, updateV2Run } from './queue'
import { V2_STAGES, type V2QueueItem, type V2Stage, type V2TraceEntry, type V2TraceEvent } from './types'

export function v2TraceEntry(stage: V2TraceEvent): V2TraceEntry {
  return { stage, at: new Date().toISOString() }
}

export function traceV2(runId: string, stage: V2TraceEvent, details: Record<string, string | number | boolean | null> = {}) {
  const run = getV2Run(runId)
  if (run && !run.trace?.some((entry) => entry.stage === stage)) {
    updateV2Run(runId, { trace: [...(run.trace ?? []), v2TraceEntry(stage)] })
  }
  logV2(stage, details, v2LogChannel(run?.source))
}

function reachedV2Stages(run: Pick<V2QueueItem, 'trace'>): Set<V2TraceEvent> {
  return new Set(run.trace?.map((entry) => entry.stage))
}

export function firstMissingV2Stage(run: Pick<V2QueueItem, 'trace'>): V2Stage | null {
  const reached = reachedV2Stages(run)
  return V2_STAGES.find((stage) => !reached.has(stage)) ?? null
}

export function currentV2Stage(run: Pick<V2QueueItem, 'trace'>): V2Stage | null {
  const reached = reachedV2Stages(run)
  return [...V2_STAGES].reverse().find((stage) => reached.has(stage)) ?? null
}
