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
  it('reaches a real Greenhouse application page and detects fields without submitting', async () => {
    const url = 'https://job-boards.greenhouse.io/gitlab/jobs/8556658002'
    const playwright = await import('playwright')
    const browser = await playwright.chromium.launch({ headless: true, args: ['--no-sandbox'] })
    try {
      const page = await browser.newPage()
      let response
      try {
        response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25_000 })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (/Timeout|net::|ENOTFOUND|ECONN|ERR_/i.test(message)) return
        throw error
      }
      if (!response?.ok()) return
      await page.waitForTimeout(1_500)
      const { diagnoseLivePage, printApplicationDiagnostic, responseUrlFromGoto } = await import('./diagnose')
      const diagnostic = await diagnoseLivePage({
        job: {
          jobId: '8556658002',
          company: 'GitLab',
          title: 'AI Engineer',
          applicationUrl: url,
          applicationId: 'live-greenhouse-1',
        },
        page,
        navigation: {
          initialUrl: url,
          responseUrl: responseUrlFromGoto(response),
          finalUrl: page.url(),
          redirectChain: [url, page.url()].filter((item, index, all) => all.indexOf(item) === index),
        },
      })
      printApplicationDiagnostic(diagnostic)
      expect(diagnostic.page.pageType).not.toBeUndefined()
      expect(diagnostic.result).not.toMatch(/application not found/i)
      if (diagnostic.blockers.captcha || diagnostic.blockers.login || diagnostic.blockers.mfa) {
        expect(diagnostic.application.applicationDetected || diagnostic.blockers.captcha || diagnostic.blockers.login).toBe(true)
        return
      }
      if (diagnostic.page.pageType === 'JOB_DETAIL_PAGE') {
        const { clickApplyControl } = await import('./apply-action')
        await clickApplyControl(page)
        await page.waitForTimeout(1_200)
        const afterClick = await diagnoseLivePage({
          job: {
            jobId: '8556658002',
            company: 'GitLab',
            title: 'AI Engineer',
            applicationUrl: url,
            applicationId: 'live-greenhouse-1',
          },
          page,
          navigation: {
            initialUrl: url,
            responseUrl: page.url(),
            finalUrl: page.url(),
            redirectChain: [url, page.url()],
          },
        })
        printApplicationDiagnostic(afterClick)
        expect(afterClick.application.applicationDetected || afterClick.blockers.captcha || afterClick.blockers.login).toBe(
          true,
        )
        if (afterClick.application.applicationDetected) {
          expect(afterClick.application.fields.length).toBeGreaterThan(0)
        }
        return
      }
      expect(diagnostic.application.applicationDetected).toBe(true)
      expect(diagnostic.application.fields).toEqual(expect.arrayContaining(['email']))
    } finally {
      await browser.close()
    }
  }, 45_000)
})
