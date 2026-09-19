import type { AutoApplyQueueStatus } from './types'

export interface PageInspection {
  status: Extract<
    AutoApplyQueueStatus,
    'captcha_required' | 'mfa_required' | 'login_required' | 'blocked' | 'automation_blocked' | 'filling' | 'needs_user_input'
  >
  questions: string[]
  hasFileInput: boolean
  hasSubmit: boolean
  mappedFields: string[]
  failureReason: string | null
}

const CAPTCHA_RE = /g-recaptcha|h-captcha|data-sitekey|cf-turnstile|hcaptcha|recaptcha|\bcaptcha\b/i
const MFA_RE = /two[- ]factor|authenticator app|one[- ]time password|\bmfa\b|\b2fa\b|enter (the )?code we sent/i
const LOGIN_RE = /sign in|log in|sso login|forgot password/i
const PASSWORD_INPUT_RE = /type=["']password["']/i
const FILE_INPUT_RE = /type=["']file["']/i
const SUBMIT_RE = /type=["']submit["']|<button[^>]*>\s*(submit|apply|send application)/i

function decode(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
}

function visibleText(html: string): string {
  return decode(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function extractQuestionPrompts(html: string): string[] {
  const labels = [...html.matchAll(/<label[^>]*>([\s\S]*?)<\/label>/gi)].map((match) =>
    match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
  )
  return labels.filter((item) => item.length > 3 && /\?|authorized|sponsor|experience|onsite|rate|availability/i.test(item))
}

export function inspectApplicationPage(html: string): PageInspection {
  const text = visibleText(html)
  if (CAPTCHA_RE.test(html) || CAPTCHA_RE.test(text)) {
    return {
      status: 'captcha_required',
      questions: [],
      hasFileInput: FILE_INPUT_RE.test(html),
      hasSubmit: SUBMIT_RE.test(html),
      mappedFields: [],
      failureReason: 'CAPTCHA was detected. JobPilot will not bypass it.',
    }
  }
  if (MFA_RE.test(html) || MFA_RE.test(text)) {
    return {
      status: 'mfa_required',
      questions: [],
      hasFileInput: FILE_INPUT_RE.test(html),
      hasSubmit: SUBMIT_RE.test(html),
      mappedFields: [],
      failureReason: 'Multi-factor authentication was detected. JobPilot will not bypass it.',
    }
  }
  if ((LOGIN_RE.test(text) && PASSWORD_INPUT_RE.test(html)) || (/type=["']password["']/.test(html) && /sign in|log in/i.test(text))) {
    return {
      status: 'login_required',
      questions: [],
      hasFileInput: FILE_INPUT_RE.test(html),
      hasSubmit: SUBMIT_RE.test(html),
      mappedFields: [],
      failureReason: 'The employer site requires login. JobPilot does not store employer passwords or bypass authentication.',
    }
  }
  if (/cf-challenge|attention required|enable javascript and cookies to continue|access denied|bot detection/i.test(text)) {
    return {
      status: 'automation_blocked',
      questions: [],
      hasFileInput: FILE_INPUT_RE.test(html),
      hasSubmit: SUBMIT_RE.test(html),
      mappedFields: [],
      failureReason: 'The employer site blocked automated interaction. JobPilot will not bypass that protection.',
    }
  }
  const questions = extractQuestionPrompts(html)
  return {
    status: 'filling',
    questions,
    hasFileInput: FILE_INPUT_RE.test(html),
    hasSubmit: SUBMIT_RE.test(html),
    mappedFields: ['name', 'email', 'location'].filter((field) =>
      new RegExp(`<(input|textarea|select)[^>]*(name|id|autocomplete)=['"][^'"]*${field}`, 'i').test(html),
    ),
    failureReason: null,
  }
}
