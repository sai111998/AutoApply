import { describe, expect, it } from 'vitest'
import { detectAtsAdapter } from '../browser-worker/providers'
import { classifyApplicationCapability, canEnterAutonomousApply } from './capability'
import { inspectApplicationPage } from './detect'
import { preflightApplication } from './preflight'
import { analyzeApplicationSurface } from './surface'
import { liveCapabilityPreflight, type LiveCapabilityPage } from './live-capability'
import { logApplicationPreflightReport } from './application-preflight'

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
    expect(classifyApplicationCapability({ url }).capability).toBe('unknown')
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
  it('preflights one real Greenhouse job without counting host-only capability as supported', async () => {
    const url = 'https://job-boards.greenhouse.io/gitlab/jobs/8556658002'
    expect(classifyApplicationCapability({ url }).capability).toBe('unknown')
    const playwright = await import('playwright')
    const browser = await playwright.chromium.launch({ headless: true, args: ['--no-sandbox'] })
    try {
      const page = await browser.newPage()
      let decision
      try {
        decision = await liveCapabilityPreflight({
          jobId: '8556658002',
          company: 'GitLab',
          title: 'AI Engineer',
          applicationUrl: url,
          page: page as unknown as LiveCapabilityPage,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (/Timeout|net::|ENOTFOUND|ECONN|ERR_/i.test(message)) return
        throw error
      }
      logApplicationPreflightReport({
        jobId: '8556658002',
        title: 'AI Engineer',
        company: 'GitLab',
        discoveryProvider: 'greenhouse',
        storedApplicationUrl: url,
        decision,
      })
      expect(decision.pageType).not.toBe('UNREACHED')
      if (decision.capability !== 'auto_apply_supported') {
        expect(canEnterAutonomousApply(decision.capability)).toBe(false)
      }
    } finally {
      await browser.close()
    }
  }, 45_000)
})
