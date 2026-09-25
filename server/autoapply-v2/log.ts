export type V2LogEvent =
  | 'REAL_JOB_SELECTED'
  | 'PROFILE_LOADED'
  | 'RESUME_LOADED'
  | 'RUN_QUEUED'
  | 'BROWSER_STARTED'
  | 'APPLICATION_URL_OPENED'
  | 'INITIAL_PAGE_CLASSIFIED'
  | 'APPLY_ACTION_FOUND'
  | 'APPLY_ACTION_CLICKED'
  | 'APPLICATION_PAGE_DETECTED'
  | 'PROVIDER_DETECTED'
  | 'FIELDS_DETECTED'
  | 'FIELDS_FILLED'
  | 'RESUME_UPLOADED'
  | 'NEXT_STEP'
  | 'REVIEW_REACHED'
  | 'FINAL_SUBMIT_FOUND'
  | 'FINAL_SUBMIT_CLICKED'
  | 'CONFIRMATION_DETECTED'
  | 'APPLICATION_PERSISTED'
  | 'RUN_STOPPED'

export function logV2(event: V2LogEvent, details: Record<string, string | number | boolean | null> = {}) {
  const suffix = Object.entries(details)
    .map(([key, value]) => `${key}=${value}`)
    .join(' ')
  console.log(`[AutoApplyV2] ${event}${suffix ? ` ${suffix}` : ''}`)
}
