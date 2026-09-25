import { analyzeCaptcha, type CaptchaAnalysis } from './captcha'
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
  captcha: boolean
  captchaDetectionConfidence: CaptchaAnalysis['captchaDetectionConfidence']
  captchaEvidence: string[]
}

const MFA_RE = /authenticator app|one[- ]time password|enter (the )?code we sent|verification code/i
const MFA_INPUT_RE = /name=["'][^"']*(otp|totp|mfa|2fa|verification[-_]?code)/i
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

function withCaptcha(
  inspection: Omit<PageInspection, 'captcha' | 'captchaDetectionConfidence' | 'captchaEvidence'>,
  captcha: CaptchaAnalysis,
): PageInspection {
  return {
    ...inspection,
    captcha: captcha.captcha,
    captchaDetectionConfidence: captcha.captchaDetectionConfidence,
    captchaEvidence: captcha.captchaEvidence,
  }
}

export function extractQuestionPrompts(html: string): string[] {
  const labels = [...html.matchAll(/<label[^>]*>([\s\S]*?)<\/label>/gi)].map((match) =>
    match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
  )
  return labels.filter((item) => item.length > 3 && /\?|authorized|sponsor|experience|onsite|rate|availability/i.test(item))
}

export function inspectApplicationPage(html: string): PageInspection {
  const text = visibleText(html)
  const captcha = analyzeCaptcha(html, text)
  const base = {
    questions: [] as string[],
    hasFileInput: FILE_INPUT_RE.test(html),
    hasSubmit: SUBMIT_RE.test(html),
    mappedFields: [] as string[],
  }
  if (captcha.captcha) {
    if (captcha.captchaEvidence.length) {
      console.info('[auto-apply]', {
        event: 'captcha-detected',
        captcha: true,
        captchaDetectionConfidence: captcha.captchaDetectionConfidence,
        captchaEvidence: captcha.captchaEvidence,
      })
    }
    return withCaptcha(
      {
        ...base,
        status: 'captcha_required',
        failureReason: 'CAPTCHA was detected. JobPilot will not bypass it.',
      },
      captcha,
    )
  }
  if ((MFA_RE.test(html) || MFA_RE.test(text)) && (MFA_INPUT_RE.test(html) || /authenticator app|one[- ]time password|enter (the )?code we sent/i.test(text))) {
    return withCaptcha(
      {
        ...base,
        status: 'mfa_required',
        failureReason: 'Multi-factor authentication was detected. JobPilot will not bypass it.',
      },
      captcha,
    )
  }
  if ((LOGIN_RE.test(text) && PASSWORD_INPUT_RE.test(html)) || (/type=["']password["']/.test(html) && /sign in|log in/i.test(text))) {
    return withCaptcha(
      {
        ...base,
        status: 'login_required',
        failureReason: 'The employer site requires login. JobPilot does not store employer passwords or bypass authentication.',
      },
      captcha,
    )
  }
  if (/cf-challenge|attention required|enable javascript and cookies to continue|access denied|bot detection/i.test(text)) {
    return withCaptcha(
      {
        ...base,
        status: 'automation_blocked',
        failureReason: 'The employer site blocked automated interaction. JobPilot will not bypass that protection.',
      },
      captcha,
    )
  }
  const questions = extractQuestionPrompts(html)
  return withCaptcha(
    {
      status: 'filling',
      questions,
      hasFileInput: FILE_INPUT_RE.test(html),
      hasSubmit: SUBMIT_RE.test(html),
      mappedFields: ['name', 'email', 'location'].filter((field) =>
        new RegExp(`<(input|textarea|select)[^>]*(name|id|autocomplete)=['"][^'"]*${field}`, 'i').test(html),
      ),
      failureReason: null,
    },
    captcha,
  )
}
