import { pageVisibleText } from './fields'
import type { ChallengeDetection } from '../shared/types'

const CAPTCHA_RE = /g-recaptcha|h-captcha|data-sitekey|cf-turnstile|hcaptcha|recaptcha|\bcaptcha\b/i
const MFA_RE = /two[- ]factor|authenticator app|one[- ]time password|\bmfa\b|\b2fa\b|enter (the )?code we sent/i
const LOGIN_RE = /sign in|log in|sso login|forgot password/i
const PASSWORD_INPUT_RE = /type=["']password["']/i

export function detectChallenges(html: string): ChallengeDetection {
  const text = pageVisibleText(html)
  return {
    captcha: CAPTCHA_RE.test(html) || CAPTCHA_RE.test(text),
    mfa: MFA_RE.test(html) || MFA_RE.test(text),
    login: Boolean((LOGIN_RE.test(text) && PASSWORD_INPUT_RE.test(html)) || (PASSWORD_INPUT_RE.test(html) && /sign in|log in/i.test(text))),
  }
}
