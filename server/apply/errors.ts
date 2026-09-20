import { HttpError } from '../types'

export const APPLY_ERROR_CODES = [
  'JOB_NOT_FOUND',
  'APPLICATION_NOT_FOUND',
  'APPLICATION_URL_MISSING',
  'RESUME_VERSION_NOT_FOUND',
  'RESUME_VERSION_NOT_READY',
  'RESUME_FILE_MISSING',
  'INVALID_APPLICATION_URL',
  'UNSUPPORTED_PROVIDER',
  'DATABASE_ERROR',
  'DATABASE_TIMEOUT',
  'BROWSER_AUTOMATION_ERROR',
  'BROWSER_AUTOMATION_UNAVAILABLE',
  'BROWSER_LAUNCH_TIMEOUT',
  'BROWSER_NAVIGATION_TIMEOUT',
  'BROWSER_SELECTOR_TIMEOUT',
  'APPLICATION_FORM_NOT_FOUND',
  'APPLICATION_FORM_NOT_RECOGNIZED',
  'APPLICATION_FORM_IN_IFRAME',
  'JOB_PAGE_REQUIRES_APPLY_CLICK',
  'APPLICATION_PAGE_BLOCKED',
  'PREPARE_TIMEOUT',
  'APPLICATION_AUTOMATION_UNSUPPORTED',
  'AUTHENTICATION_FAILURE',
] as const

export type ApplyErrorCode = (typeof APPLY_ERROR_CODES)[number]

export const APPLY_ERROR_MESSAGES: Record<ApplyErrorCode, string> = {
  JOB_NOT_FOUND: 'This job is no longer available.',
  APPLICATION_NOT_FOUND: 'This Auto Apply job is no longer in the queue.',
  APPLICATION_URL_MISSING: 'This listing does not include a valid application URL.',
  RESUME_VERSION_NOT_FOUND: 'The selected resume version could not be found.',
  RESUME_VERSION_NOT_READY: 'The selected resume version is not ready for application preparation.',
  RESUME_FILE_MISSING: 'The selected resume is missing text for this application.',
  INVALID_APPLICATION_URL: 'This listing does not include a valid application URL.',
  UNSUPPORTED_PROVIDER: 'This job source cannot be prepared automatically.',
  DATABASE_ERROR: 'Could not prepare the application.',
  DATABASE_TIMEOUT: 'Saving the application timed out.',
  BROWSER_AUTOMATION_ERROR: 'Could not open the employer application.',
  BROWSER_AUTOMATION_UNAVAILABLE:
    'Browser automation is not available. JobPilot cannot open the employer application in this environment.',
  BROWSER_LAUNCH_TIMEOUT: 'The browser did not start within the allowed time.',
  BROWSER_NAVIGATION_TIMEOUT: 'The employer application page did not load within the allowed time.',
  BROWSER_SELECTOR_TIMEOUT: 'The application form did not respond within the allowed time.',
  APPLICATION_FORM_NOT_FOUND: 'The employer application form could not be found.',
  APPLICATION_FORM_NOT_RECOGNIZED: 'The employer application form could not be found.',
  APPLICATION_FORM_IN_IFRAME: 'The application form is in an embedded frame that JobPilot cannot use.',
  JOB_PAGE_REQUIRES_APPLY_CLICK: 'The job page requires an Apply action before the application form appears.',
  APPLICATION_PAGE_BLOCKED: 'The employer site blocked automated interaction. JobPilot will not bypass that protection.',
  PREPARE_TIMEOUT: 'Application preparation timed out.',
  APPLICATION_AUTOMATION_UNSUPPORTED: 'This employer site cannot be prepared automatically.',
  AUTHENTICATION_FAILURE: 'Sign in to prepare this application.',
}

export class ApplyError extends HttpError {
  code: ApplyErrorCode
  details: Record<string, unknown>

  constructor(status: number, code: ApplyErrorCode, message = APPLY_ERROR_MESSAGES[code], details: Record<string, unknown> = {}) {
    super(status, message)
    this.name = 'ApplyError'
    this.code = code
    this.details = details
  }
}

export function isApplyError(error: unknown): error is ApplyError {
  return error instanceof ApplyError
}

export function applyErrorBody(error: ApplyError) {
  const run = error.details.run
  const items = error.details.items
  const item = error.details.item
  return {
    success: false as const,
    code: error.code,
    message: error.message,
    error: error.message,
    ...(run && typeof run === 'object' ? { run } : {}),
    ...(Array.isArray(items) ? { items } : {}),
    ...(item && typeof item === 'object' ? { item } : {}),
  }
}
