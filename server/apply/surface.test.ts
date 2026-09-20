import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  clickApplyControl,
  clickSecondaryApplyControl,
  dismissBlockingNotices,
  isLegitimateApplyLabel,
  isLegitimateNextLabel,
} from './apply-action'
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

  it('detects a Workday job page when Apply is nested and uses data-automation-id', () => {
    const html = `
      <div data-automation-id="jobPostingPage">
        <div data-automation-id="jobPostingHeader">Software Engineer 2 (Java)</div>
        <div data-automation-id="jobPostingDescription">Job description</div>
        <button data-automation-id="adventureButton"><span>Apply</span></button>
      </div>
    `
    const analysis = analyzeApplicationSurface(html, {
      url: 'https://usbank.wd1.myworkdayjobs.com/us_bank_careers/job/Atlanta-GA/Software-Engineer-2--Java-_2026-0022330',
    })
    expect(analysis.kind).toBe('job_details')
    expect(analysis.hasApplyControl).toBe(true)
    expect(analysis.provider).toBe('workday')
  })

  it('treats a Workday missing-job page as JOB_NOT_FOUND instead of form not found', () => {
    const analysis = analyzeApplicationSurface(
      '<div data-automation-id="errorMessage">The page you are looking for doesn\'t exist.</div>',
      { url: 'https://usbank.wd1.myworkdayjobs.com/us_bank_careers/job/missing' },
    )
    expect(analysis.code).toBe('JOB_NOT_FOUND')
    expect(analysis.failureReason).toMatch(/no longer available/i)
  })

  it('treats a Workday create-account step as login required', () => {
    const analysis = analyzeApplicationSurface(
      `
        <h1>Create Account</h1>
        <p>Sign in If this is your first time applying</p>
        <form>
          <label>Email Address</label>
          <input type="text" data-automation-id="email">
          <input type="password" data-automation-id="password">
          <button>Sign In</button>
        </form>
      `,
      { url: 'https://usbank.wd1.myworkdayjobs.com/en-US/us_bank_careers/job/x/apply/applyManually' },
    )
    expect(analysis.code).toBe('LOGIN_REQUIRED')
    expect(analysis.kind).toBe('blocked')
  })

  it('does not treat Easy Apply or social apply labels as legitimate apply actions', () => {
    expect(isLegitimateApplyLabel('Apply Now')).toBe(true)
    expect(isLegitimateApplyLabel('Apply Manually')).toBe(true)
    expect(isLegitimateApplyLabel('Begin application')).toBe(true)
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

  it('clicks Apply Manually in a Workday start-application dialog', async () => {
    const locator = {
      first() {
        return locator
      },
      async count() {
        return 1
      },
      async innerText() {
        return 'Apply Manually'
      },
      async click() {
        return undefined
      },
    }
    const clicked = await clickSecondaryApplyControl({ getByRole: () => locator })
    expect(clicked).toEqual({ clicked: true, label: 'Apply Manually' })
  })

  it('dismisses a Workday cookie notice without treating it as Apply', async () => {
    const locator = {
      first() {
        return locator
      },
      async count() {
        return 1
      },
      async click() {
        return undefined
      },
    }
    const dismissed = await dismissBlockingNotices({
      locator: (selector: string) => (selector.includes('legalNoticeAcceptButton') ? locator : { first: () => locator, async count() { return 0 } }),
    })
    expect(dismissed.dismissed).toBe(true)
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

  it('pauses for unknown questions instead of guessing', async () => {
    const browser = new PlaywrightApplyBrowser()
    const prepared = await browser.prepare({
      url: 'https://jobs.example.com/apply',
      profile,
      resumeText: 'Java engineer',
      html: `
        <form>
          <label>Email Address</label>
          <input type="email" name="email">
          <label>When can you start?</label>
          <input name="availability">
          <button type="submit">Submit Application</button>
        </form>
      `,
    })
    expect(prepared.status).toBe('needs_user_input')
    expect(prepared.questions.some((item) => /start/i.test(item.prompt) && item.answer == null)).toBe(true)
    expect(prepared.status).not.toBe('submitted')
  })

  it('fails a missing Workday job as no longer available, not form-not-found', async () => {
    const browser = new PlaywrightApplyBrowser()
    const prepared = await browser.prepare({
      url: 'https://usbank.wd1.myworkdayjobs.com/us_bank_careers/job/missing',
      profile,
      resumeText: 'Java engineer',
      html: '<div data-automation-id="errorMessage">The page you are looking for doesn\'t exist.</div>',
    })
    expect(prepared.status).toBe('failed')
    expect(prepared.failureReason).toMatch(/no longer available/i)
    expect(prepared.failureReason).not.toMatch(/form could not be found/i)
  })

  it('pauses when Workday starts at Create Account after Apply Manually', async () => {
    const browser = new PlaywrightApplyBrowser()
    const prepared = await browser.prepare({
      url: 'https://usbank.wd1.myworkdayjobs.com/en-US/us_bank_careers/job/x/apply/applyManually',
      profile,
      resumeText: 'Java engineer',
      html: `
        <h1>Create Account</h1>
        <p>Sign in If this is your first time applying</p>
        <form>
          <label>Email Address</label>
          <input type="text" data-automation-id="email">
          <input type="password" data-automation-id="password">
          <button>Sign In</button>
        </form>
      `,
    })
    expect(prepared.status).toBe('login_required')
    expect(prepared.status).not.toBe('submitted')
  })

  it('waits for a dynamic application form instead of failing on the first empty render', async () => {
    let reads = 0
    const browser = new PlaywrightApplyBrowser({
      timeouts: { spaWaitMs: 1_200, selectorMs: 20, launchMs: 40, navigationMs: 40, fillMs: 20 },
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
                    reads += 1
                    if (reads < 3) return '<html><body><h1>Loading</h1></body></html>'
                    return redirectedAts
                  },
                  url: () => 'https://boards.greenhouse.io/acme/jobs/1',
                  async title() {
                    return 'Acme Application'
                  },
                }
              },
            }
          },
        },
      }),
    })
    const prepared = await browser.prepare({
      url: 'https://boards.greenhouse.io/acme/jobs/1',
      profile,
      resumeText: 'Java engineer',
    })
    expect(reads).toBeGreaterThan(1)
    expect(prepared.status).toBe('ready_for_submission')
    expect(prepared.status).not.toBe('submitted')
  })

  it('times out a page that never becomes an application', async () => {
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
                    return '<html><body><p>Welcome to Example</p></body></html>'
                  },
                  url: () => 'https://careers.unknown-corp.example/role',
                  async title() {
                    return 'Careers'
                  },
                }
              },
            }
          },
        },
      }),
    })
    const prepared = await browser.prepare({
      url: 'https://careers.unknown-corp.example/role',
      profile,
      resumeText: 'Java engineer',
    })
    expect(prepared.status).toBe('failed')
    expect(prepared.failureReason).toMatch(/classified after collecting evidence|supported application/i)
    expect(prepared.status).not.toBe('submitted')
  })

  it('advances a multi-step application with Next without marking submitted', async () => {
    const states = [
      {
        html: applicationPage,
        url: 'https://jobs.example.com/apply/step-1',
      },
      {
        html: redirectedAts,
        url: 'https://jobs.example.com/apply/review',
      },
    ]
    let index = 0
    const locator = {
      first() {
        return locator
      },
      async count() {
        return 1
      },
      async innerText() {
        return index === 0 ? 'Next' : 'Submit Application'
      },
      async fill() {
        return undefined
      },
      async setInputFiles() {
        return undefined
      },
      async click() {
        if (index === 0) index = 1
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
                    return 'Application'
                  },
                  getByRole() {
                    return locator
                  },
                  locator() {
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
    expect(index).toBe(1)
    expect(prepared.status).toBe('ready_for_submission')
    expect(prepared.status).not.toBe('submitted')
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
