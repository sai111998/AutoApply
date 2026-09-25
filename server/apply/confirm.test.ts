import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PlaywrightApplyBrowser,
  clearBrowserSessionsForTests,
  clickFinalSubmit,
  evaluateExternalSubmission,
  setBrowserSessionForTests,
  type PlaywrightPage,
} from './browser'
import {
  capturePostSubmitEvidence,
  detectSubmissionConfirmation,
  isFinalSubmitLabel,
  isWeakConfirmationText,
  submissionStatusFromResult,
} from './confirm'
import { inspectApplicationPage } from './detect'

function mockPage(state: {
  html: string
  url: string
  title: string
  submitLabel?: string
  clickError?: boolean
  after?: { html: string; url: string; title: string }
}): PlaywrightPage {
  const click = async () => {
    if (state.clickError) throw new Error('submit control missing')
    if (state.after) {
      state.html = state.after.html
      state.url = state.after.url
      state.title = state.after.title
    }
  }
  return {
    goto: async () => undefined,
    content: async () => state.html,
    url: () => state.url,
    title: async () => state.title,
    waitForLoadState: async () => undefined,
    click,
    locator: () => ({
      first: () => ({
        count: async () => 1,
        click,
        innerText: async () => state.submitLabel ?? 'Submit Application',
        getAttribute: async () => state.submitLabel ?? 'Submit Application',
      }),
    }),
  }
}

afterEach(() => {
  clearBrowserSessionsForTests()
})

describe('submission confirmation detection', () => {
  it('does not treat preparation, navigation, or weak copy as success', () => {
    expect(detectSubmissionConfirmation({ html: '<form><button type="submit">Submit</button></form>' }).detected).toBe(false)
    expect(
      detectSubmissionConfirmation({
        html: '<h1>Thank you</h1>',
        url: 'https://company.com/thank-you',
        title: 'Thank you',
      }).detected,
    ).toBe(false)
    expect(detectSubmissionConfirmation({ html: '<p>Your information has been saved</p>' }).detected).toBe(false)
    expect(detectSubmissionConfirmation({ html: '<button>Next</button><button>Continue</button><p>Review</p>' }).detected).toBe(
      false,
    )
    expect(isWeakConfirmationText('Thank you')).toBe(true)
    expect(isFinalSubmitLabel('Next')).toBe(false)
    expect(isFinalSubmitLabel('Continue')).toBe(false)
    expect(isFinalSubmitLabel('Submit Application')).toBe(true)
  })

  it('marks confirmation from reliable employer text or a confirmation number', () => {
    expect(detectSubmissionConfirmation({ html: '<p>Thank you for applying to this role.</p>' }).confirmed).toBe(true)
    expect(detectSubmissionConfirmation({ html: '<h1>Application submitted successfully</h1><p>Confirmation number ABC12345</p>' }).confirmed).toBe(true)
    expect(detectSubmissionConfirmation({ html: '<p>Your application has been submitted.</p>' }).confirmed).toBe(true)
    expect(detectSubmissionConfirmation({ html: '<p>We have received your application.</p>' }).confirmed).toBe(true)
    const numbered = detectSubmissionConfirmation({
      html: '<p>Application submitted. Confirmation number: APP-9X22Q</p>',
    })
    expect(numbered.detected).toBe(true)
    expect(numbered.confirmationNumber).toBe('APP-9X22Q')
    const evidence = capturePostSubmitEvidence({
      html: '<form></form><h1>Application submitted successfully</h1><p>Confirmation number ABC12345</p>',
      url: 'http://127.0.0.1:8787/test-employer/submit',
      title: 'Application submitted',
    })
    expect(evidence.formCount).toBe(1)
    expect(evidence.confirmationNumber).toBe('ABC12345')
    expect(evidence.matchedPhrase).toMatch(/application submitted/i)
  })

  it('requires a confirmed final action before submitted', () => {
    expect(
      submissionStatusFromResult({
        success: false,
        confirmationDetected: false,
        finalActionCompleted: false,
        reason: 'prepared only',
      }),
    ).toBe('needs_user_confirmation')
    expect(
      submissionStatusFromResult({
        success: false,
        confirmationDetected: false,
        finalActionCompleted: true,
        resultingUrl: 'https://company.com/thank-you',
      }),
    ).toBe('needs_confirmation')
    expect(
      submissionStatusFromResult({
        success: true,
        confirmationDetected: true,
        finalActionCompleted: true,
        confirmationNumber: 'APP-1',
      }),
    ).toBe('submitted')
  })
})

describe('external submit automation', () => {
  it('requires the final submit action and does not mark submitted from navigation alone', async () => {
    const page = mockPage({
      html: '<form><button type="submit">Submit Application</button></form>',
      url: 'https://jobs.example.com/apply',
      title: 'Apply',
      after: {
        html: '<h1>Thank you</h1><p>Your information has been saved.</p>',
        url: 'https://jobs.example.com/thank-you',
        title: 'Thank you',
      },
    })
    const result = await evaluateExternalSubmission(page, {
      jobId: 'job-1',
      applicationId: 'app-1',
      identityKey: 'example:job-1',
      applicationUrl: 'https://jobs.example.com/apply',
    })
    expect(result.finalActionCompleted).toBe(true)
    expect(result.resultingUrl).toContain('thank-you')
    expect(result.confirmationDetected).toBeFalsy()
    expect(result.status).toBe('needs_confirmation')
    expect(result.status).not.toBe('submitted')
  })

  it('marks submitted only after the final action and confirmation text', async () => {
    const page = mockPage({
      html: '<form><button type="submit">Submit Application</button></form>',
      url: 'https://jobs.example.com/apply',
      title: 'Apply',
      after: {
        html: '<p>Thank you for applying. Confirmation number: JPMC-44119</p>',
        url: 'https://jobs.example.com/confirmation',
        title: 'Application received',
      },
    })
    const result = await evaluateExternalSubmission(page, { applicationId: 'app-1' })
    expect(result.status).toBe('submitted')
    expect(result.success).toBe(true)
    expect(result.confirmationDetected).toBe(true)
    expect(result.confirmationNumber).toBe('JPMC-44119')
  })

  it('does not treat a missing live browser page as a successful submit', async () => {
    const browser = new PlaywrightApplyBrowser()
    setBrowserSessionForTests('filled:https://jobs.example.com/apply', {
      url: 'https://jobs.example.com/apply',
      filled: true,
    })
    const result = await browser.submit('filled:https://jobs.example.com/apply', {
      applicationId: 'app-1',
      applicationUrl: 'https://jobs.example.com/apply',
    })
    expect(result.status).toBe('needs_user_confirmation')
    expect(result.status).not.toBe('submitted')
    expect(result.finalActionCompleted).toBe(false)
  })

  it('stops for CAPTCHA, MFA, and login instead of submitting', async () => {
    expect(inspectApplicationPage('<div class="g-recaptcha" data-sitekey="x"></div>').status).toBe('captcha_required')
    expect(inspectApplicationPage('<p>Enter the authenticator app code</p>').status).toBe('mfa_required')
    expect(inspectApplicationPage('<form>Sign in<input type="password"></form>').status).toBe('login_required')

    const captcha = await evaluateExternalSubmission(
      mockPage({
        html: '<div class="g-recaptcha" data-sitekey="x"></div>',
        url: 'https://jobs.example.com/apply',
        title: 'Verify',
      }),
    )
    expect(captcha.status).toBe('captcha_required')
    expect(captcha.status).not.toBe('submitted')

    const mfa = await evaluateExternalSubmission(
      mockPage({
        html: '<p>Enter the authenticator app code we sent</p>',
        url: 'https://jobs.example.com/apply',
        title: 'MFA',
      }),
    )
    expect(mfa.status).toBe('mfa_required')

    const login = await evaluateExternalSubmission(
      mockPage({
        html: '<form>Sign in<input type="password" name="password"></form>',
        url: 'https://jobs.example.com/login',
        title: 'Sign in',
      }),
    )
    expect(login.status).toBe('login_required')
  })

  it('returns failed when the session is gone and needs_user_input when the final control cannot be used', async () => {
    const browser = new PlaywrightApplyBrowser()
    const missing = await browser.submit('missing-session')
    expect(missing.status).toBe('failed')
    expect(missing.status).not.toBe('submitted')

    const page = mockPage({
      html: '<form><button type="submit">Submit Application</button></form>',
      url: 'https://jobs.example.com/apply',
      title: 'Apply',
      clickError: true,
    })
    page.click = async () => {
      throw new Error('no control')
    }
    page.locator = () => ({
      first: () => ({
        count: async () => 1,
        click: async () => {
          throw new Error('no control')
        },
        innerText: async () => 'Submit Application',
      }),
    })
    const blocked = await evaluateExternalSubmission(page)
    expect(blocked.status).toBe('needs_user_input')
    expect(blocked.finalActionCompleted).toBe(false)
  })

  it('identifies a final submit control without treating Next as the final action', async () => {
    expect(isFinalSubmitLabel('Submit')).toBe(true)
    expect(isFinalSubmitLabel('Send Application')).toBe(true)
    expect(isFinalSubmitLabel('Next')).toBe(false)
    const clicked = await clickFinalSubmit(
      mockPage({
        html: '<form><button type="submit">Submit Application</button></form>',
        url: 'https://jobs.example.com/apply',
        title: 'Apply',
      }),
    )
    expect(clicked.clicked).toBe(true)
  })
})

describe('playwright availability', () => {
  it('does not mark a job submitted when browser automation cannot open the employer site', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const browser = new PlaywrightApplyBrowser({
      loadPlaywright: async () => null,
      health: async () => ({ available: false, reason: 'Playwright is not installed' }),
    })
    const prepared = await browser.prepare({
      url: 'https://jobs.example.com/apply',
      resumeText: 'Java resume',
      profile: {
        fullName: 'Jordan Hale',
        email: 'jordan@example.com',
        location: 'Austin, TX',
        yearsOfExperience: 8,
        workAuthorization: 'us_citizen',
        sponsorshipRequired: false,
        preferredWorkArrangement: 'remote',
        targetSalaryMin: null,
        targetSalaryMax: null,
      },
    })
    expect(prepared.status).not.toBe('submitted')
    expect(prepared.status).toBe('automation_blocked')
    expect(prepared.failureReason).toMatch(/Playwright is not installed/)
    spy.mockRestore()
  })
})
