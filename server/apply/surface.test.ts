import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { clickApplyControl, isLegitimateApplyLabel, isLegitimateNextLabel } from './apply-action'
import { PlaywrightApplyBrowser } from './browser'
import { saveApplyDebugArtifact } from './debug-capture'
import { analyzeApplicationSurface, mergeSurfaceDocuments } from './surface'
import { detectApplicationProvider } from './providers'
import { snapshotFromHtml } from './page-snapshot'
import type { AutoApplyProfile } from './types'

const profile: AutoApplyProfile = {
  fullName: 'Jordan Hale',
  email: 'jordan.hale@example.com',
  location: 'Austin, TX',
  yearsOfExperience: 6,
  workAuthorization: 'us_citizen',
  sponsorshipRequired: false,
  preferredWorkArrangement: 'hybrid',
  targetSalaryMin: null,
  targetSalaryMax: null,
}

const jobPage = `
  <html><body>
    <h1>Lead Software Engineer-Full Stack Java</h1>
    <p>Job Description</p>
    <p>Job Identification 210786459</p>
    <button>Apply Now</button>
  </body></html>
`

const applicationPage = `
  <html><body>
    <h1>Job application form</h1>
    <form>
      <label>Email Address</label>
      <input type="email" name="primary-email" id="primary-email-0">
      <button type="submit" aria-label="Next">Next</button>
    </form>
  </body></html>
`

const redirectedAts = `
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

afterEach(async () => {
  // Keep disk clean between debug-capture tests.
})

describe('application surface detection', () => {
  it('detects a direct application page and resume upload', () => {
    const analysis = analyzeApplicationSurface(redirectedAts, { url: 'https://boards.greenhouse.io/acme/jobs/1' })
    expect(analysis.kind).toBe('application')
    expect(analysis.code).toBe('APPLICATION_FORM_DETECTED')
    expect(analysis.fields).toEqual(expect.arrayContaining(['email', 'first_name', 'last_name', 'resume']))
    expect(analysis.hasResumeUpload).toBe(true)
    expect(analysis.provider).toBe('greenhouse')
  })

  it('detects a job details page that requires an Apply click', () => {
    const analysis = analyzeApplicationSurface(jobPage, {
      url: 'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/210786459',
    })
    expect(analysis.kind).toBe('job_details')
    expect(analysis.code).toBe('JOB_PAGE_REQUIRES_APPLY_CLICK')
    expect(analysis.hasApplyControl).toBe(true)
    expect(analysis.provider).toBe('oraclecloud')
    expect(snapshotFromHtml(jobPage).keywords['Apply now']).toBe(true)
  })

  it('detects a redirected ATS application page', () => {
    const analysis = analyzeApplicationSurface(applicationPage, {
      url: 'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/210786459/apply/email',
    })
    expect(analysis.kind).toBe('application')
    expect(analysis.fields).toContain('email')
    expect(analysis.hasNext).toBe(true)
    expect(analysis.hasResumeUpload).toBe(false)
  })

  it('detects an application form inside an iframe document', () => {
    const analysis = mergeSurfaceDocuments([
      { html: '<html><body><h1>Careers</h1></body></html>', url: 'https://jobs.example.com/role' },
      { html: redirectedAts, url: 'https://boards.greenhouse.io/embed/job_app', inIframe: true },
    ])
    expect(analysis.kind).toBe('application')
    expect(analysis.inIframe).toBe(true)
    expect(analysis.hasResumeUpload).toBe(true)
  })

  it('flags a cross-origin application iframe when the parent has no form', () => {
    const analysis = analyzeApplicationSurface(
      '<html><body><iframe src="https://boards.greenhouse.io/embed/job_app?token=1"></iframe></body></html>',
      { url: 'https://example.com/jobs/1' },
    )
    expect(analysis.code).toBe('APPLICATION_FORM_IN_IFRAME')
  })

  it('detects a multi-step application from the first step', () => {
    const analysis = analyzeApplicationSurface(applicationPage, { url: 'https://jobs.example.com/apply/step-1' })
    expect(analysis.kind).toBe('application')
    expect(analysis.hasNext).toBe(true)
    expect(analysis.hasFinalSubmit).toBe(false)
  })

  it('uses the generic detector for unknown hosts', () => {
    expect(detectApplicationProvider({ url: 'https://careers.unknown-corp.example/apply' }).id).toBe('generic')
    const analysis = analyzeApplicationSurface(redirectedAts, { url: 'https://careers.unknown-corp.example/apply' })
    expect(analysis.kind).toBe('application')
    expect(analysis.provider).toBe('generic')
  })

  it('detects Workday, Greenhouse, Lever, and iCIMS hosts', () => {
    expect(detectApplicationProvider({ url: 'https://salesforce.wd12.myworkdayjobs.com/job/1' }).id).toBe('workday')
    expect(detectApplicationProvider({ url: 'https://boards.greenhouse.io/acme/jobs/1' }).id).toBe('greenhouse')
    expect(detectApplicationProvider({ url: 'https://jobs.lever.co/acme/abc' }).id).toBe('lever')
    expect(detectApplicationProvider({ url: 'https://careers-acme.icims.com/jobs/1/apply' }).id).toBe('icims')
    expect(
      analyzeApplicationSurface(redirectedAts, { url: 'https://jobs.lever.co/acme/abc' }).provider,
    ).toBe('lever')
    expect(
      analyzeApplicationSurface(redirectedAts, { url: 'https://careers-acme.icims.com/jobs/1/apply' }).provider,
    ).toBe('icims')
    expect(
      analyzeApplicationSurface(
        '<form><label>Email</label><input type="email" name="email"><button>Apply</button></form>',
        { url: 'https://acme.wd1.myworkdayjobs.com/apply' },
      ).kind,
    ).toBe('application')
  })

  it('returns missing-form, login, CAPTCHA, and MFA codes', () => {
    expect(analyzeApplicationSurface('<p>Welcome to Example</p>').code).toBe('APPLICATION_FORM_NOT_RECOGNIZED')
    expect(analyzeApplicationSurface('<form>Sign in<input type="password"></form>').code).toBe('LOGIN_REQUIRED')
    expect(analyzeApplicationSurface('<div class="g-recaptcha" data-sitekey="x"></div>').code).toBe('CAPTCHA_REQUIRED')
    expect(analyzeApplicationSurface('<p>Enter the authenticator app code</p>').code).toBe('MFA_REQUIRED')
    expect(analyzeApplicationSurface('<p>Access denied bot detection</p>').code).toBe('APPLICATION_PAGE_BLOCKED')
  })

  it('does not treat Easy Apply or social apply labels as legitimate apply actions', () => {
    expect(isLegitimateApplyLabel('Apply Now')).toBe(true)
    expect(isLegitimateApplyLabel('Start application')).toBe(true)
    expect(isLegitimateApplyLabel('Easy Apply')).toBe(false)
    expect(isLegitimateApplyLabel('Apply with LinkedIn')).toBe(false)
    expect(isLegitimateNextLabel('Next')).toBe(true)
    expect(isLegitimateNextLabel('Submit application')).toBe(false)
  })
})

describe('job page apply click', () => {
  it('clicks Apply Now and then sees the application page', async () => {
    const states = [
      { html: jobPage, url: 'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/210786459' },
      {
        html: applicationPage,
        url: 'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/210786459/apply/email',
      },
    ]
    let index = 0
    const locator = {
      first() {
        return locator
      },
      async count() {
        return /apply now/i.test(states[index].html) ? 1 : 0
      },
      async innerText() {
        return 'Apply Now'
      },
      async click() {
        index = 1
      },
    }
    const page = {
      getByRole() {
        return locator
      },
    }
    const clicked = await clickApplyControl(page, { url: states[0].url, html: states[0].html })
    expect(clicked).toEqual({ clicked: true, label: 'Apply Now' })
    expect(analyzeApplicationSurface(states[index].html, { url: states[index].url }).kind).toBe('application')
  })

  it('prepares a live job page by clicking Apply before scoring the form', async () => {
    const states = [
      { html: jobPage, url: 'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/210786459' },
      { html: applicationPage, url: 'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/210786459/apply/email' },
    ]
    let index = 0
    const locator = {
      first() {
        return locator
      },
      async count() {
        return /apply now/i.test(states[index].html) ? 1 : 0
      },
      async innerText() {
        return 'Apply Now'
      },
      async click() {
        index = 1
      },
    }
    const browser = new PlaywrightApplyBrowser({
      timeouts: { spaWaitMs: 20, selectorMs: 20, launchMs: 40, navigationMs: 40, fillMs: 20 },
      health: async () => ({ available: true, runtime: 'node-server' }),
      loadPlaywright: async () => ({
        chromium: {
          async launch() {
            return {
              async close() {
                return undefined
              },
              async newPage() {
                return {
                  async goto() {
                    return undefined
                  },
                  async content() {
                    return states[index].html
                  },
                  url: () => states[index].url,
                  async title() {
                    return 'JPMC Candidate Experience page'
                  },
                  getByRole() {
                    return locator
                  },
                }
              },
            }
          },
        },
      }),
    })
    const prepared = await browser.prepare({
      url: states[0].url,
      profile,
      resumeText: 'Java engineer',
    })
    expect(prepared.status).toBe('ready_for_submission')
    expect(prepared.status).not.toBe('submitted')
    expect(prepared.failureReason).toBeNull()
  })
})

describe('debug artifacts', () => {
  it('writes a sanitized local snapshot without secrets', async () => {
    const folder = await mkdtemp(path.join(tmpdir(), 'apply-debug-'))
    const saved = await saveApplyDebugArtifact(
      {
        url: 'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/210786459?token=secret',
        async title() {
          return 'Lead Software Engineer'
        },
        async content() {
          return '<form><input type="password" name="secret"></form>'
        },
      },
      'APPLICATION_FORM_NOT_RECOGNIZED',
      folder,
    )
    expect(saved).toBeTruthy()
    const summary = JSON.parse(await readFile(path.join(saved!, 'summary.json'), 'utf8')) as { url: string; reason: string }
    expect(summary.url).not.toContain('token=')
    expect(summary.reason).toBe('APPLICATION_FORM_NOT_RECOGNIZED')
    const snippet = await readFile(path.join(saved!, 'snippet.html'), 'utf8')
    expect(snippet).not.toContain('name="secret"')
    await rm(folder, { recursive: true, force: true })
  })
})
