import { ApplyError, type ApplyErrorCode } from './errors'

export const BROWSER_LAUNCH_TIMEOUT_MS = 12_000
export const PAGE_NAVIGATION_TIMEOUT_MS = 16_000
export const SELECTOR_DETECTION_TIMEOUT_MS = 6_000
export const FIELD_FILL_TIMEOUT_MS = 8_000
export const DATABASE_TIMEOUT_MS = 8_000
export const PREPARE_TIMEOUT_MS = 40_000
export const APPLY_LOCK_TIMEOUT_MS = 45_000
export const STUCK_PREPARATION_MS = PREPARE_TIMEOUT_MS

export interface ApplyTimeouts {
  launchMs: number
  navigationMs: number
  selectorMs: number
  fillMs: number
  databaseMs: number
  prepareMs: number
  lockMs: number
  stuckMs: number
  spaWaitMs: number
}

export const DEFAULT_APPLY_TIMEOUTS: ApplyTimeouts = {
  launchMs: BROWSER_LAUNCH_TIMEOUT_MS,
  navigationMs: PAGE_NAVIGATION_TIMEOUT_MS,
  selectorMs: SELECTOR_DETECTION_TIMEOUT_MS,
  fillMs: FIELD_FILL_TIMEOUT_MS,
  databaseMs: DATABASE_TIMEOUT_MS,
  prepareMs: PREPARE_TIMEOUT_MS,
  lockMs: APPLY_LOCK_TIMEOUT_MS,
  stuckMs: STUCK_PREPARATION_MS,
  spaWaitMs: 10_000,
}

export function mergeApplyTimeouts(partial: Partial<ApplyTimeouts> = {}): ApplyTimeouts {
  return { ...DEFAULT_APPLY_TIMEOUTS, ...partial }
}

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  code: ApplyErrorCode,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new ApplyError(504, code, message))
    }, ms)
  })
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

export function timeoutError(code: ApplyErrorCode, message?: string): ApplyError {
  return new ApplyError(504, code, message)
}
