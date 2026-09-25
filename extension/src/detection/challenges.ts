import { pageVisibleText } from './fields'
import type { ChallengeDetection } from '../shared/types'

const STRONG_IFRAME_RE =
  /<iframe[^>]+src=["'][^"']*(google\.com\/recaptcha|recaptcha\.net|hcaptcha\.com|challenges\.cloudflare\.com\/turnstile)/i
const RECAPTCHA_WIDGET_RE = /class=["'][^"']*\bg-recaptcha\b|id=["'][^"']*g-recaptcha|grecaptcha\.render|recaptcha\/api\.js/i
const HCAPTCHA_WIDGET_RE = /class=["'][^"']*\bh-captcha\b|hcaptcha\.com\/1\/api|data-hcaptcha-sitekey/i
const TURNSTILE_WIDGET_RE = /class=["'][^"']*\bcf-turnstile\b|challenges\.cloudflare\.com\/turnstile|data-cf-turnstile/i
const MFA_RE = /authenticator app|one[- ]time password|enter (the )?code we sent|verification code/i
const MFA_INPUT_RE = /name=["'][^"']*(otp|totp|mfa|2fa|verification[-_]?code)/i
const LOGIN_RE = /sign in|log in|sso login|forgot password/i
const PASSWORD_INPUT_RE = /type=["']password["']/i

function hasStrongCaptcha(html: string): boolean {
  return (
    STRONG_IFRAME_RE.test(html) ||
    RECAPTCHA_WIDGET_RE.test(html) ||
    HCAPTCHA_WIDGET_RE.test(html) ||
    TURNSTILE_WIDGET_RE.test(html)
  )
}

export function detectChallenges(html: string): ChallengeDetection {
  const text = pageVisibleText(html)
  return {
    captcha: hasStrongCaptcha(html),
    mfa: Boolean((MFA_RE.test(html) || MFA_RE.test(text)) && (MFA_INPUT_RE.test(html) || /authenticator app|one[- ]time password|enter (the )?code we sent/i.test(text))),
    login: Boolean((LOGIN_RE.test(text) && PASSWORD_INPUT_RE.test(html)) || (PASSWORD_INPUT_RE.test(html) && /sign in|log in/i.test(text))),
  }
}
