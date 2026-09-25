import { describe, expect, it } from 'vitest'
import { analyzeCaptcha } from './captcha'
import { inspectApplicationPage } from './detect'

describe('CAPTCHA evidence detector', () => {
  it('detects a real reCAPTCHA iframe and widget', () => {
    const html =
      '<iframe src="https://www.google.com/recaptcha/api2/anchor"></iframe><div class="g-recaptcha" data-sitekey="x"></div>'
    const analysis = analyzeCaptcha(html)
    expect(analysis.captcha).toBe(true)
    expect(analysis.captchaDetectionConfidence).toBe('high')
    expect(analysis.captchaEvidence).toEqual(
      expect.arrayContaining(['known CAPTCHA iframe/provider detected', 'reCAPTCHA challenge element detected']),
    )
    expect(inspectApplicationPage(html).status).toBe('captcha_required')
  })

  it('does not classify a page with no CAPTCHA', () => {
    const html = '<form><label>Email</label><input name="email"><button>Submit application</button></form>'
    const analysis = analyzeCaptcha(html, 'Submit your application')
    expect(analysis.captcha).toBe(false)
    expect(analysis.captchaDetectionConfidence).toBe('none')
    expect(analysis.captchaEvidence).toEqual([])
    expect(inspectApplicationPage(html).status).toBe('filling')
  })

  it('does not classify weak security/verify/challenge text as CAPTCHA', () => {
    const html = '<p>Complete the security verification challenge to continue your application.</p>'
    const analysis = analyzeCaptcha(html, 'Complete the security verification challenge to continue your application.')
    expect(analysis.captcha).toBe(false)
    expect(inspectApplicationPage(html).status).not.toBe('captcha_required')
  })

  it('does not classify a generic iframe as CAPTCHA', () => {
    const html = '<iframe src="https://boards.greenhouse.io/embed/job_app?token=1"></iframe><p>Apply now</p>'
    const analysis = analyzeCaptcha(html)
    expect(analysis.captcha).toBe(false)
    expect(inspectApplicationPage(html).status).not.toBe('captcha_required')
  })

  it('does not classify data-sitekey or the word captcha alone', () => {
    expect(analyzeCaptcha('<input data-sitekey="abc">').captcha).toBe(false)
    expect(analyzeCaptcha('<p>Please complete the captcha later if prompted.</p>').captcha).toBe(false)
    expect(inspectApplicationPage('<p>Please complete the captcha later if prompted.</p>').status).not.toBe(
      'captcha_required',
    )
  })
})
