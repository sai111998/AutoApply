import { describe, expect, it } from 'vitest'
import { detectAtsAdapter } from '../browser-worker/providers'
import { classifyApplicationCapability } from './capability'
import { inspectApplicationPage } from './detect'
import { preflightApplication } from './preflight'
import { analyzeApplicationSurface } from './surface'

const greenhouseApplication = `
  <html><body>
    <form id="application-form">
      <label>First Name</label><input name="first_name" autocomplete="given-name">
      <label>Last Name</label><input name="last_name" autocomplete="family-name">
      <label>Email</label><input type="email" name="email" autocomplete="email">
      <label>Upload Resume</label><input type="file" name="resume">
      <button type="submit">Submit Application</button>
    </form>
  </body></html>
`

describe('controlled Greenhouse ATS page', () => {
  it('detects the provider, application, fields, and upload without claiming a live submit', () => {
    const url = 'https://boards.greenhouse.io/acme/jobs/1'
    expect(classifyApplicationCapability({ url }).capability).toBe('auto_apply_supported')
    const adapter = detectAtsAdapter({ url, html: greenhouseApplication })
    expect(adapter.id).toBe('greenhouse')
    expect(adapter.detect({ url, html: greenhouseApplication })).toBe(true)
    expect(adapter.findForm(greenhouseApplication)).toBe(true)
    expect(adapter.detectFields(greenhouseApplication)).toEqual(
      expect.arrayContaining(['email', 'first_name', 'last_name', 'resume']),
    )
    const surface = analyzeApplicationSurface(greenhouseApplication, { url })
    expect(surface.hasResumeUpload).toBe(true)
    const preflight = adapter.preflight({ url, html: greenhouseApplication })
    expect(preflight.capability).toBe('auto_apply_supported')
    expect(inspectApplicationPage(greenhouseApplication).status).toBe('filling')
  })

  it('pauses on a real CAPTCHA or login wall instead of submitting', () => {
    const url = 'https://boards.greenhouse.io/acme/jobs/1'
    const captcha = preflightApplication({
      url,
      html: '<iframe src="https://www.google.com/recaptcha/api2/anchor"></iframe><div class="g-recaptcha"></div>',
    })
    expect(captcha.capability).toBe('blocked')
    expect(captcha.captcha).toBe(true)
    const login = preflightApplication({
      url,
      html: '<form>Sign in to continue<input type="password" name="password"></form>',
    })
    expect(login.capability).toBe('blocked')
    expect(login.blockers.join(' ')).toMatch(/login/i)
  })
})

describe('live Greenhouse probe', () => {
  it('opens a public Greenhouse job page headlessly and pauses on a real CAPTCHA instead of submitting', async () => {
    const url = 'https://job-boards.greenhouse.io/gitlab/jobs/8556658002'
    const playwright = await import('playwright')
    const browser = await playwright.chromium.launch({ headless: true, args: ['--no-sandbox'] })
    let html = ''
    let fetchedUrl = url
    try {
      const page = await browser.newPage()
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25_000 })
      await page.waitForTimeout(1_200)
      fetchedUrl = page.url()
      html = await page.content()
      expect(response?.ok()).toBe(true)
    } finally {
      await browser.close()
    }

    const adapter = detectAtsAdapter({ url: fetchedUrl, html })
    const preflight = preflightApplication({ url: fetchedUrl, html, accessible: true })
    const surface = analyzeApplicationSurface(html, { url: fetchedUrl })
    expect(adapter.id).toBe('greenhouse')
    expect(surface.fields).toEqual(expect.arrayContaining(['email', 'first_name', 'last_name', 'resume']))
    expect(surface.hasResumeUpload).toBe(true)
    if (preflight.captcha) {
      expect(preflight.capability).toBe('blocked')
      expect(preflight.captchaEvidence.join(' ')).toMatch(/reCAPTCHA|CAPTCHA iframe/i)
    } else {
      expect(preflight.capability).toBe('auto_apply_supported')
    }
  }, 30_000)
})
