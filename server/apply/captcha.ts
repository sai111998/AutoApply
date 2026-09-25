export type CaptchaConfidence = 'none' | 'low' | 'medium' | 'high'

export interface CaptchaAnalysis {
  captcha: boolean
  captchaDetectionConfidence: CaptchaConfidence
  captchaEvidence: string[]
}

const STRONG_IFRAME_RE =
  /<iframe[^>]+src=["'][^"']*(google\.com\/recaptcha|recaptcha\.net|hcaptcha\.com|challenges\.cloudflare\.com\/turnstile)/i
const RECAPTCHA_WIDGET_RE = /class=["'][^"']*\bg-recaptcha\b|id=["'][^"']*g-recaptcha|grecaptcha\.render|recaptcha\/api\.js/i
const HCAPTCHA_WIDGET_RE = /class=["'][^"']*\bh-captcha\b|hcaptcha\.com\/1\/api|data-hcaptcha-sitekey/i
const TURNSTILE_WIDGET_RE = /class=["'][^"']*\bcf-turnstile\b|challenges\.cloudflare\.com\/turnstile|data-cf-turnstile/i
const EXPLICIT_CHALLENGE_UI_RE =
  /id=["'][^"']*(recaptcha|hcaptcha|captcha-challenge)|aria-label=["'][^"']*(recaptcha|hcaptcha|captcha challenge)/i
const WEAK_TEXT_RE = /\b(captcha|security check|verify you are human|i am not a robot)\b/i
const WEAK_GENERIC_RE = /\b(security|verify|challenge)\b/i
const GENERIC_IFRAME_RE = /<iframe\b/i
const DATA_SITEKEY_RE = /data-sitekey=/i

function unique(items: string[]): string[] {
  return [...new Set(items)]
}

export function analyzeCaptcha(html: string, visibleText = ''): CaptchaAnalysis {
  const evidence: string[] = []
  let strong = 0

  if (STRONG_IFRAME_RE.test(html)) {
    evidence.push('known CAPTCHA iframe/provider detected')
    strong += 2
  }
  if (RECAPTCHA_WIDGET_RE.test(html)) {
    evidence.push('reCAPTCHA challenge element detected')
    strong += 2
  }
  if (HCAPTCHA_WIDGET_RE.test(html)) {
    evidence.push('hCaptcha challenge element detected')
    strong += 2
  }
  if (TURNSTILE_WIDGET_RE.test(html)) {
    evidence.push('Cloudflare Turnstile widget detected')
    strong += 2
  }
  if (EXPLICIT_CHALLENGE_UI_RE.test(html)) {
    evidence.push('explicit CAPTCHA challenge UI detected')
    strong += 1
  }

  const weakText = WEAK_TEXT_RE.test(visibleText) || WEAK_TEXT_RE.test(html)
  const genericWord = WEAK_GENERIC_RE.test(visibleText)
  const genericIframe = GENERIC_IFRAME_RE.test(html) && !STRONG_IFRAME_RE.test(html)
  const sitekeyOnly = DATA_SITEKEY_RE.test(html) && strong === 0

  if (strong >= 2) {
    const captchaEvidence = unique(evidence)
    return {
      captcha: true,
      captchaDetectionConfidence: strong >= 4 || captchaEvidence.length >= 2 ? 'high' : 'medium',
      captchaEvidence,
    }
  }

  if (strong === 1 && weakText) {
    return {
      captcha: true,
      captchaDetectionConfidence: 'medium',
      captchaEvidence: unique([...evidence, 'supporting CAPTCHA challenge copy detected']),
    }
  }

  if (strong === 1) {
    return {
      captcha: false,
      captchaDetectionConfidence: 'low',
      captchaEvidence: unique([...evidence, 'single CAPTCHA-like marker was insufficient']),
    }
  }

  if (weakText || genericWord || genericIframe || sitekeyOnly) {
    return {
      captcha: false,
      captchaDetectionConfidence: 'none',
      captchaEvidence: [],
    }
  }

  return { captcha: false, captchaDetectionConfidence: 'none', captchaEvidence: [] }
}
