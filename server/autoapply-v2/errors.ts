export const V2_ERROR_CODES = [
  'INVALID_APPLICATION_URL',
  'APPLICATION_NOT_REACHABLE',
  'APPLICATION_UNSUPPORTED',
  'APPLICATION_PAGE_NOT_FOUND',
  'FORM_NOT_FOUND',
  'LOGIN_REQUIRED',
  'MFA_REQUIRED',
  'CAPTCHA_REQUIRED',
  'UNKNOWN_REQUIRED_FIELD',
  'RESUME_UPLOAD_FAILED',
  'NAVIGATION_TIMEOUT',
  'SUBMISSION_FAILED',
  'SUBMISSION_UNCERTAIN',
  'PROFILE_INCOMPLETE',
  'PROFILE_NOT_FOUND',
  'PROFILE_AUTH_REQUIRED',
  'PROFILE_DATABASE_ERROR',
  'RESUME_NOT_FOUND',
  'JOB_NOT_FOUND',
  'ALREADY_APPLIED',
  'WORKER_BUSY',
  'BROWSER_UNAVAILABLE',
  'RUN_IN_PROGRESS',
  'ACTION_UNSUPPORTED',
] as const

export type V2ErrorCode = (typeof V2_ERROR_CODES)[number]

export class V2Error extends Error {
  code: V2ErrorCode
  status: number
  missingFields: string[] | null

  constructor(code: V2ErrorCode, message: string, status = 422, missingFields: string[] | null = null) {
    super(message)
    this.name = 'V2Error'
    this.code = code
    this.status = status
    this.missingFields = missingFields
  }
}

export function isV2Error(error: unknown): error is V2Error {
  return error instanceof V2Error
}

export function v2ErrorBody(error: V2Error) {
  return {
    success: false,
    code: error.code,
    error: error.message,
    message: error.message,
    ...(error.missingFields ? { missingFields: error.missingFields } : {}),
  }
}
