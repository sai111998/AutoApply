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
  'BROWSER_AUTOMATION_ERROR',
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
  BROWSER_AUTOMATION_ERROR: 'Could not open the employer application.',
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
  return {
    success: false as const,
    code: error.code,
    message: error.message,
    error: error.message,
  }
}
