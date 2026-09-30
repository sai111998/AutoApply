import type { V2RunSource, V2TraceEvent } from './types'

export type V2LogEvent = V2TraceEvent | 'FORM_CLASSIFIED' | 'NEXT_STEP' | 'RUN_STOPPED' | 'APPLICATION_NOT_PERSISTED'

export type V2LogChannel = 'OneClickApply' | 'AutoApplyV2'

export function v2LogChannel(source: V2RunSource | null | undefined): V2LogChannel {
  return source === 'auto-apply' ? 'AutoApplyV2' : 'OneClickApply'
}

export function logV2(
  event: V2LogEvent,
  details: Record<string, string | number | boolean | null> = {},
  channel: V2LogChannel = 'OneClickApply',
) {
  const suffix = Object.entries(details)
    .map(([key, value]) => `${key}=${value}`)
    .join(' ')
  console.log(`[${channel}] ${event}${suffix ? ` ${suffix}` : ''}`)
}
