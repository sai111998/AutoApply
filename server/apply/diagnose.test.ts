import { describe, expect, it } from 'vitest'
import { startSyntheticEmployer } from '../browser-worker/synthetic'
import { analyzeCaptcha } from './captcha'
import { buildLivePreflight, livePreflightStatus } from './live-preflight'
import { classifyPageType } from './page-classify'
import { evidenceFromHtml } from './page-evidence'
import { detectApplicationProvider } from './providers'
import { inspectStoredApplicationUrl, isJobPilotInternalUrl } from './stored-url'
import { analyzeApplicationSurface, mergeSurfaceDocuments } from './surface'
import { uniqueUrls } from './diagnose'

const applicationHtml = `
  <html><head><title>Apply</title></head><body>
    <h1>Job application form</h1>
    <label>First Name</label><input name="first_name" autocomplete="given-name">
    <label>Last Name</label><input name="last_name" autocomplete="family-name">
    <label>Email</label><input type="email" name="email">
    <label>Upload Resume</label><input type="file" name="resume">
    <button>Submit Application</button>
  </body></html>
`

const jobHtml = `
  <html><head><title>Software Engineer</title></head><body>
    <h1>Software Engineer</h1>
    <p>Job Description</p>
    <p>Job Identification 210786459</p>
    <a href="/apply">Apply Now</a>
  </body></html>
`

describe('stored application URL validation', () => {
  it('accepts an external employer URL', () => {
    const inspected = inspectStoredApplicationUrl('https://job-boards.greenhouse.io/gitlab/jobs/1')
    expect(inspected.ok).toBe(true)
    expect(inspected.kind).toBe('valid')
  })

  it('rejects JobPilot localhost and dashboard paths', () => {
    expect(inspectStoredApplicationUrl('http://localhost:5173/jobs').ok).toBe(false)
    expect(inspectStoredApplicationUrl('http://127.0.0.1:8787/dashboard').kind).toBe('jobpilot')
    expect(isJobPilotInternalUrl('http://localhost:5173/applications')).toBe(true)
    expect(inspectStoredApplicationUrl(null).kind).toBe('missing')
    expect(inspectStoredApplicationUrl('undefined').kind).toBe('missing')
    expect(inspectStoredApplicationUrl('javascript:alert(1)').ok).toBe(false)
  })

  it('allows the local synthetic employer', () => {
    expect(inspectStoredApplicationUrl('http://127.0.0.1:8790/test-employer/apply').ok).toBe(true)
    expect(inspectStoredApplicationUrl('http://127.0.0.1:8787/test-employer').ok).toBe(true)
    expect(inspectStoredApplicationUrl('http://127.0.0.1:8787/test-employer/apply').ok).toBe(true)
    expect(isJobPilotInternalUrl('http://127.0.0.1:8787/test-employer')).toBe(false)
    expect(inspectStoredApplicationUrl('http://127.0.0.1:8787/jobs').ok).toBe(false)
  })
})

describe('page classification', () => {
  it('classifies a job detail page', () => {
    const result = classifyPageType({ html: jobHtml, url: 'https://jobs.example.com/job', hasApplyControl: true })
    expect(result.pageType).toBe('JOB_DETAIL_PAGE')
    expect(result.applicationDetected).toBe(false)
  })

  it('classifies an application page without requiring a form tag', () => {
    const analysis = analyzeApplicationSurface(applicationHtml, { url: 'https://jobs.example.com/apply' })
    expect(applicationHtml).not.toMatch(/<form/i)
    expect(analysis.kind).toBe('application')
    const result = classifyPageType({
      html: applicationHtml,
      url: 'https://jobs.example.com/apply',
      applicationScore: analysis.score,
      applicationKind: analysis.kind,
    })
    expect(result.pageType).toBe('APPLICATION_PAGE')
    expect(result.applicationDetected).toBe(true)
    expect(analysis.fields).toEqual(expect.arrayContaining(['first_name', 'email', 'resume']))
  })

  it('classifies login, MFA, and CAPTCHA separately', () => {
    expect(
      classifyPageType({
        html: '<form>Sign in<input type="password" name="password"></form>',
        url: 'https://boards.greenhouse.io/acme/jobs/1',
      }).pageType,
    ).toBe('LOGIN_PAGE')
    expect(
      classifyPageType({
        html: '<p>Enter the authenticator app code</p><input name="otp">',
        url: 'https://boards.greenhouse.io/acme/jobs/1',
      }).pageType,
    ).toBe('MFA_PAGE')
    expect(
      classifyPageType({
        html: '<iframe src="https://www.google.com/recaptcha/api2/anchor"></iframe><div class="g-recaptcha"></div>',
        url: 'https://boards.greenhouse.io/acme/jobs/1',
      }).pageType,
    ).toBe('CAPTCHA_PAGE')
  })

  it('does not treat weak security text as CAPTCHA', () => {
    const html = '<p>Complete the security verification challenge to continue.</p>'
    expect(analyzeCaptcha(html, 'Complete the security verification challenge to continue.').captcha).toBe(false)
    expect(classifyPageType({ html, url: 'https://jobs.example.com/apply' }).pageType).not.toBe('CAPTCHA_PAGE')
  })
})

describe('iframe and redirect evidence', () => {
  it('detects an application inside an iframe document', () => {
    const parent = '<html><body><iframe src="https://boards.greenhouse.io/embed/job_app?token=1"></iframe></body></html>'
    const merged = mergeSurfaceDocuments([
      { html: parent, url: 'https://careers.example.com/job/1', inIframe: false },
      { html: applicationHtml, url: 'https://boards.greenhouse.io/embed/job_app?token=1', inIframe: true },
    ])
    expect(merged.kind).toBe('application')
    expect(merged.inIframe).toBe(true)
    expect(merged.fields).toEqual(expect.arrayContaining(['email', 'resume']))
  })

  it('records a redirect chain without assuming the first URL is the application', () => {
    expect(uniqueUrls(['https://a.example/job', 'https://a.example/job', 'https://a.example/apply'])).toEqual([
      'https://a.example/job',
      'https://a.example/apply',
    ])
  })
})

describe('provider detection from page evidence', () => {
  it('uses the final page URL, not the company name', () => {
    expect(detectApplicationProvider({ url: 'https://jobs.lever.co/acme/abc', html: '<p>Acme uses Greenhouse internally</p>' }).id).toBe(
      'lever',
    )
    expect(detectApplicationProvider({ url: 'https://careers.unknown-corp.example/role', html: '<p>Workday mention</p>' }).id).toBe(
      'generic',
    )
  })

  it('marks unsupported providers instead of application-not-found', () => {
    const preflight = buildLivePreflight({
      jobId: 'job-1',
      applicationUrl: 'https://jobs.smartrecruiters.com/acme/1',
      finalUrl: 'https://jobs.smartrecruiters.com/acme/1',
      html: '<html><body><h1>Careers</h1></body></html>',
    })
    expect(preflight.pageType).toBe('UNKNOWN_PAGE')
    expect(livePreflightStatus(preflight).status).toBe('skipped')
    expect(preflight.reason).toMatch(/smartrecruiters|supported/i)
    expect(preflight.reason).not.toMatch(/application not found/i)
  })
})

describe('live preflight result', () => {
  it('returns structured evidence before filling', () => {
    const evidence = evidenceFromHtml(applicationHtml, 'https://jobs.example.com/apply', { title: 'Apply' })
    const result = buildLivePreflight({
      jobId: 'job-1',
      applicationUrl: 'https://jobs.example.com/apply',
      finalUrl: 'https://jobs.example.com/apply',
      html: applicationHtml,
      evidence,
    })
    expect(result).toEqual(
      expect.objectContaining({
        jobId: 'job-1',
        applicationUrl: 'https://jobs.example.com/apply',
        finalUrl: 'https://jobs.example.com/apply',
        pageType: 'APPLICATION_PAGE',
        applicationDetected: true,
        iframeDetected: false,
        captchaDetected: false,
        loginDetected: false,
        mfaDetected: false,
      }),
    )
    expect(result.detectedFields.length).toBeGreaterThan(1)
    expect(result.evidence.inputs).toBeGreaterThan(0)
    expect(livePreflightStatus(result).status).toBe('ready')
  })

  it('detects the synthetic employer job page and application form', async () => {
    const site = await startSyntheticEmployer()
    const playwright = await import('playwright')
    const browser = await playwright.chromium.launch({ headless: true, args: ['--no-sandbox'] })
    try {
      const page = await browser.newPage()
      await page.goto(site.jobUrl, { waitUntil: 'domcontentloaded', timeout: 10_000 })
      const jobPage = classifyPageType({
        html: await page.content(),
        url: page.url(),
        hasApplyControl: true,
      })
      expect(jobPage.pageType).toBe('JOB_DETAIL_PAGE')
      await page.getByRole('link', { name: /^Apply Now$/i }).click()
      await page.waitForLoadState('domcontentloaded')
      const html = await page.content()
      const analysis = analyzeApplicationSurface(html, { url: page.url() })
      expect(analysis.kind).toBe('application')
      expect(analysis.fields).toEqual(expect.arrayContaining(['first_name', 'email', 'resume']))
      expect(analysis.hasResumeUpload).toBe(true)
      expect(analysis.hasNext).toBe(true)
    } finally {
      await browser.close()
      await site.close()
    }
  }, 30_000)

  it('classifies job-board listings as unsupported_application_flow', () => {
    const result = buildLivePreflight({
      jobId: 'board',
      applicationUrl: 'https://www.indeed.com/viewjob?jk=1',
      finalUrl: 'https://www.indeed.com/viewjob?jk=1',
      html: '<html><body><h1>Job on Indeed</h1></body></html>',
    })
    expect(result.blockers).toEqual(expect.arrayContaining(['unsupported_application_flow']))
    expect(result.reason).toMatch(/supported application flow/i)
  })
})
