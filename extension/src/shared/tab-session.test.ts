import { describe, expect, it } from 'vitest'
import { inspectApplicationUrl } from './url'
import { extensionLog, sanitizeExtensionLogDetails } from './extension-log'
import {
  bindEmployerTab,
  createEmployerTabSession,
  inspectionTarget,
  JOBPILOT_INTERNAL_PAGE,
  jobpilotInternalInspection,
  planEmployerTabOpen,
  recordEmployerNavigation,
  shouldRunApplicationDetector,
  statusAfterDetection,
} from './tab-session'
import { applicationDetector } from '../detection/application-detector'
import { isLegitimateApplyText } from '../agent/fill'

describe('employer application URLs', () => {
  it('accepts http(s) employer URLs and rejects invalid, localhost, and non-web schemes', () => {
    expect(inspectApplicationUrl('https://jobs.example.com/apply').ok).toBe(true)
    expect(inspectApplicationUrl('http://careers.example.com/jobs/1').ok).toBe(true)
    expect(inspectApplicationUrl('javascript:alert(1)').ok).toBe(false)
    expect(inspectApplicationUrl('chrome://extensions').ok).toBe(false)
    expect(inspectApplicationUrl('file:///tmp/apply.html').ok).toBe(false)
    expect(inspectApplicationUrl('not a url').ok).toBe(false)
    expect(inspectApplicationUrl('http://localhost:5173/jobs').ok).toBe(false)
    expect(inspectApplicationUrl('http://127.0.0.1:5173/jobs').ok).toBe(false)
    expect(inspectApplicationUrl('http://localhost/apply').ok).toBe(false)
    expect(inspectApplicationUrl(null).ok).toBe(false)
    expect(inspectApplicationUrl('http://127.0.0.1:8787/extension/test/application.html').ok).toBe(true)
  })
})

describe('employer tab sessions', () => {
  it('creates a session, stores tabId, and tracks redirects', () => {
    const session = bindEmployerTab(
      createEmployerTabSession({
        applicationId: 'app-1',
        itemId: 'item-1',
        jobId: 'job-1',
        applicationUrl: 'https://jobs.example.com/role',
        company: 'Acme',
        jobTitle: 'Engineer',
        resumeVersionId: 'resume-1',
      }),
      42,
    )
    expect(session.tabId).toBe(42)
    expect(session.applicationId).toBe('app-1')
    expect(session.jobId).toBe('job-1')
    expect(session.initialUrl).toBe('https://jobs.example.com/role')
    const redirected = recordEmployerNavigation(session, 'https://boards.greenhouse.io/acme/jobs/1')
    expect(redirected.currentUrl).toBe('https://boards.greenhouse.io/acme/jobs/1')
    expect(redirected.urlHistory).toEqual(['https://jobs.example.com/role', 'https://boards.greenhouse.io/acme/jobs/1'])
  })

  it('opens a new employer tab instead of reusing the JobPilot jobs page', () => {
    const session = createEmployerTabSession({
      itemId: 'item-1',
      jobId: 'job-1',
      applicationUrl: 'https://jobs.example.com/apply',
    })
    expect(
      planEmployerTabOpen({
        applicationUrl: 'https://jobs.example.com/apply',
        reuseTabId: 7,
        reuseTabUrl: 'http://localhost:5173/jobs',
        session: { ...session, tabId: 7 },
        itemId: 'item-1',
      }),
    ).toEqual({ action: 'create', url: 'https://jobs.example.com/apply' })
    expect(
      planEmployerTabOpen({
        applicationUrl: 'http://localhost:5173/jobs',
        itemId: 'item-1',
      }).action,
    ).toBe('reject')
    expect(
      planEmployerTabOpen({
        applicationUrl: 'https://jobs.example.com/apply',
        reuseTabId: 9,
        reuseTabUrl: 'https://jobs.example.com/apply',
        session: bindEmployerTab(session, 9),
        itemId: 'item-1',
      }),
    ).toEqual({ action: 'reuse', tabId: 9, url: 'https://jobs.example.com/apply' })
  })

  it('runs the detector only on the active employer tab and ignores JobPilot', () => {
    expect(
      shouldRunApplicationDetector({
        pageUrl: 'http://localhost:5173/jobs',
        tabId: 1,
        sessionTabId: 2,
        workflowStarted: true,
      }),
    ).toEqual({ run: false, reason: JOBPILOT_INTERNAL_PAGE })
    expect(
      shouldRunApplicationDetector({
        pageUrl: 'https://jobs.example.com/apply',
        tabId: 3,
        sessionTabId: 2,
        workflowStarted: true,
      }),
    ).toEqual({ run: false, reason: 'TAB_NOT_IN_SESSION' })
    expect(
      shouldRunApplicationDetector({
        pageUrl: 'https://jobs.example.com/apply',
        tabId: 2,
        sessionTabId: 2,
        workflowStarted: false,
      }),
    ).toEqual({ run: false, reason: 'NO_ACTIVE_SESSION' })
    expect(
      shouldRunApplicationDetector({
        pageUrl: 'https://jobs.example.com/apply',
        tabId: 2,
        sessionTabId: 2,
        workflowStarted: true,
      }),
    ).toEqual({ run: true, reason: null })
    expect(jobpilotInternalInspection('http://localhost:5173/jobs').pageKind).toBe(JOBPILOT_INTERNAL_PAGE)
    expect(jobpilotInternalInspection('http://localhost:5173/jobs').detection.buttons).toEqual([])
    expect(
      inspectionTarget({
        activeTab: { id: 1, url: 'http://localhost:5173/jobs' },
        session: bindEmployerTab(
          createEmployerTabSession({
            itemId: 'item-1',
            jobId: 'job-1',
            applicationUrl: 'https://jobs.example.com/apply',
          }),
          9,
        ),
      }),
    ).toEqual({ kind: 'employer', tabId: 9, url: 'https://jobs.example.com/apply' })
  })

  it('detects employer pages, Apply buttons, and preserves CAPTCHA, MFA, and login', () => {
    const job = applicationDetector({
      html: '<h1>Engineer</h1><p>Job Description</p><p>Job Identification 1</p><button>Apply Now</button>',
      url: 'https://jobs.example.com/role',
    })
    expect(job.isJobDetailsPage).toBe(true)
    expect(job.applyActions.join(' ')).toMatch(/apply now/i)
    expect(isLegitimateApplyText('Apply Now')).toBe(true)
    expect(statusAfterDetection(job)).toBe('employer_page_opened')
    const application = applicationDetector({
      html: '<form><label>Email</label><input type="email" name="email"><label>First Name</label><input name="first_name"><button>Next</button></form>',
      url: 'https://boards.greenhouse.io/acme/jobs/1',
    })
    expect(application.isApplicationPage).toBe(true)
    expect(statusAfterDetection(application)).toBe('provider_detected')
    expect(statusAfterDetection(applicationDetector({ html: '<div class="g-recaptcha" data-sitekey="x"></div>' }))).toBe(
      'captcha_required',
    )
    expect(statusAfterDetection(applicationDetector({ html: '<p>Enter the authenticator app code</p>' }))).toBe('mfa_required')
    expect(statusAfterDetection(applicationDetector({ html: '<form>Sign in<input type="password"></form>' }))).toBe(
      'login_required',
    )
  })
})

describe('extension logs', () => {
  it('omits passwords, tokens, and API keys', () => {
    expect(sanitizeExtensionLogDetails({ applicationId: 'app-1', password: 'secret', apiKey: 'abc', token: 'xyz' })).toEqual({
      applicationId: 'app-1',
    })
    expect(extensionLog('[Extension] Application ID:', { applicationId: 'app-1' })).toContain('app-1')
    expect(extensionLog('[Extension] Application ID:', { password: 'hunter2' })).toBe('[Extension] Application ID:')
  })
})
