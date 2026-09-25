export const V2_ERROR_CODES = [
  'INVALID_APPLICATION_URL',
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
  'RESUME_NOT_FOUND',
  'JOB_NOT_FOUND',
  'ALREADY_APPLIED',
  'WORKER_BUSY',
  'BROWSER_UNAVAILABLE',
] as const

export type V2ErrorCode = (typeof V2_ERROR_CODES)[number]

export class V2Error extends Error {
  code: V2ErrorCode
  status: number

  constructor(code: V2ErrorCode, message: string, status = 422) {
    super(message)
    this.name = 'V2Error'
    this.code = code
    this.status = status
  }
}

export function isV2Error(error: unknown): error is V2Error {
  return error instanceof V2Error
}
