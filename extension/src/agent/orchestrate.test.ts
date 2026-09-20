import { describe, expect, it } from 'vitest'
import { nextAgentAction, unknownQuestionPrompts, confirmationDetected } from './orchestrate'
import { fillSelectorsFor, isLegitimateApplyText } from './fill'
import { profileFillValues } from './answers'
import { inspectApplicationUrl } from '../shared/url'
import { applicationDetector } from '../detection/application-detector'

describe('browser agent orchestration', () => {
  it('clicks Apply on a job page and pauses for CAPTCHA, MFA, login, and unknown questions', () => {
    const job = applicationDetector({
      html: '<h1>Engineer</h1><p>Job Description</p><p>Job Identification 1</p><button>Apply Now</button>',
      url: 'https://jobs.example.com/role',
    })
    expect(nextAgentAction(job).type).toBe('click_apply')
    expect(isLegitimateApplyText('Apply Now')).toBe(true)
    expect(isLegitimateApplyText('Easy Apply')).toBe(false)
    expect(nextAgentAction(applicationDetector({ html: '<div class="g-recaptcha" data-sitekey="x"></div>' })).type).toBe('pause')
    const mfa = nextAgentAction(applicationDetector({ html: '<p>Enter the authenticator app code</p>' }))
    expect(mfa.type).toBe('pause')
    if (mfa.type === 'pause') expect(mfa.status).toBe('mfa_required')
    const login = nextAgentAction(applicationDetector({ html: '<form>Sign in<input type="password"></form>' }))
    expect(login.type).toBe('pause')
    if (login.type === 'pause') expect(login.status).toBe('login_required')
    const unknown = unknownQuestionPrompts('<form><label>When can you start?</label><input name="start"></form>', [])
    expect(unknown[0]).toMatch(/start/i)
  })

  it('maps verified profile fields and does not invent missing data', () => {
    const values = profileFillValues({
      fullName: 'Jordan Hale',
      email: 'jordan.hale@example.com',
      location: 'Austin, TX',
      yearsOfExperience: 6,
      workAuthorization: 'us_citizen',
      sponsorshipRequired: false,
    })
    expect(values.firstName).toBe('Jordan')
    expect(values.lastName).toBe('Hale')
    expect(values.city).toBe('Austin')
    expect(values.phone).toBe('')
    expect(values.linkedin).toBe('')
    expect(fillSelectorsFor({ email: values.email })[0].selector).toContain('email')
  })

  it('rejects invalid application URLs', () => {
    expect(inspectApplicationUrl('javascript:alert(1)').ok).toBe(false)
    expect(inspectApplicationUrl('https://jobs.example.com/apply').ok).toBe(true)
  })

  it('does not treat weak thank-you copy as submission confirmation', () => {
    expect(confirmationDetected('<p>Thank you</p>').detected).toBe(false)
    expect(confirmationDetected('<p>Continue</p>').detected).toBe(false)
    expect(confirmationDetected('<p>Review</p>').detected).toBe(false)
    expect(confirmationDetected('<h1>Thank you for applying</h1>', 'Application submitted').detected).toBe(true)
  })

  it('fills known fields and advances multi-step applications without auto-submitting', async () => {
    const { readFile } = await import('node:fs/promises')
    const html = await readFile(new URL('../../test-pages/synthetic-application.html', import.meta.url), 'utf8')
    const detection = applicationDetector({ html, url: 'http://127.0.0.1:8787/extension/test/application.html' })
    expect(detection.isApplicationPage).toBe(true)
    expect(nextAgentAction(detection, html).type).toBe('fill_and_advance')
    expect(isLegitimateApplyText('Start Application')).toBe(true)
    expect(inspectApplicationUrl('http://127.0.0.1:8787/extension/test/application.html').ok).toBe(true)
    expect(inspectApplicationUrl('ftp://jobs.example.com/apply').ok).toBe(false)
  })
})
