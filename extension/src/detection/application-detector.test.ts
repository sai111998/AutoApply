import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { applicationDetector } from './application-detector'
import { detectApplicationProvider } from '../providers'

const syntheticPath = path.resolve(process.cwd(), 'extension/test-pages/synthetic-application.html')
const jobPath = path.resolve(process.cwd(), 'extension/test-pages/job-details.html')

describe('applicationDetector', () => {
  it('detects a generic application page and semantic fields', async () => {
    const html = await readFile(syntheticPath, 'utf8')
    const detection = applicationDetector({ html, url: 'http://127.0.0.1:8787/extension/test/application.html', title: 'JobPilot Synthetic Application' })
    expect(detection.isApplicationPage).toBe(true)
    expect(detection.isJobDetailsPage).toBe(false)
    expect(detection.provider).toBe('generic')
    expect(detection.fields.map((field) => field.id)).toEqual(
      expect.arrayContaining(['firstName', 'lastName', 'email', 'phone', 'resume', 'linkedin', 'workAuthorization']),
    )
    expect(detection.buttons.map((button) => button.kind)).toEqual(expect.arrayContaining(['next', 'submit']))
    expect(detection.challenges).toEqual({ captcha: false, mfa: false, login: false })
    expect(detection.confidence).toBeGreaterThan(0.3)
  })

  it('detects a job details page and legitimate Apply actions without treating it as an application', async () => {
    const html = await readFile(jobPath, 'utf8')
    const detection = applicationDetector({ html, url: 'https://jobs.example.com/role', title: 'Software Engineer Job Details' })
    expect(detection.isJobDetailsPage).toBe(true)
    expect(detection.isApplicationPage).toBe(false)
    expect(detection.applyActions.join(' ')).toMatch(/apply now/i)
    expect(detection.provider).toBe('unknown')
  })

  it('does not classify an invalid page as an application', () => {
    const detection = applicationDetector({ html: '<p>Welcome to Example Domain</p>', url: 'https://example.com', title: 'Example Domain' })
    expect(detection.isApplicationPage).toBe(false)
    expect(detection.isJobDetailsPage).toBe(false)
    expect(detection.provider).toBe('unknown')
  })

  it('detects CAPTCHA, MFA, and login without submitting', () => {
    expect(applicationDetector({ html: '<div class="g-recaptcha" data-sitekey="x"></div>' }).challenges.captcha).toBe(true)
    expect(applicationDetector({ html: '<p>Enter the authenticator app code</p>' }).challenges.mfa).toBe(true)
    expect(applicationDetector({ html: '<form>Sign in<input type="password"></form>' }).challenges.login).toBe(true)
  })

  it('uses Playwright to load the synthetic application page', async () => {
    const playwright = await import('playwright')
    const browser = await playwright.chromium.launch({ headless: true, args: ['--no-sandbox'] })
    try {
      const page = await browser.newPage()
      await page.goto(`file://${syntheticPath}`)
      expect(await page.title()).toBe('JobPilot Synthetic Application')
      const detection = applicationDetector({
        html: await page.content(),
        url: page.url(),
        title: await page.title(),
      })
      expect(detection.isApplicationPage).toBe(true)
      expect(detection.provider).toBe('generic')
      expect(detection.fields.some((field) => field.id === 'email')).toBe(true)
      expect(detection.fields.some((field) => field.id === 'resume')).toBe(true)
    } finally {
      await browser.close()
    }
  })
})

describe('provider detection', () => {
  it('detects Workday, Greenhouse, Lever, Ashby, and iCIMS hosts', () => {
    expect(detectApplicationProvider({ url: 'https://usbank.wd1.myworkdayjobs.com/job/1' }).id).toBe('workday')
    expect(detectApplicationProvider({ url: 'https://boards.greenhouse.io/acme/jobs/1' }).id).toBe('greenhouse')
    expect(detectApplicationProvider({ url: 'https://jobs.lever.co/acme/abc' }).id).toBe('lever')
    expect(detectApplicationProvider({ url: 'https://jobs.ashbyhq.com/acme/abc' }).id).toBe('ashby')
    expect(detectApplicationProvider({ url: 'https://careers-acme.icims.com/jobs/1/apply' }).id).toBe('icims')
    expect(detectApplicationProvider({ url: 'https://careers.unknown-corp.example/apply' }).id).toBe('unknown')
  })

  it('uses generic only after an application page is detected', async () => {
    const html = await readFile(syntheticPath, 'utf8')
    expect(applicationDetector({ html, url: 'https://careers.unknown-corp.example/apply' }).provider).toBe('generic')
  })
})
