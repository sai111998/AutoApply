import { describe, expect, it } from 'vitest'
import { analyzeApplicationSurface, inspectApplicationPage } from './detector'
import { profileFieldValues } from './fields'
import { answerKnownQuestion, resolveApplicationQuestions } from './questions'
import { detectAtsAdapter, supportedAtsProviders } from './provider'
import { detectSubmissionConfirmation } from './submission'
import { isLegitimateApplyLabel } from '../apply/apply-action'
import { queueStatusFromSession } from './session'
import type { AutoApplyProfile } from '../apply/types'

const profile: AutoApplyProfile = {
  fullName: 'Jordan Hale',
  email: 'jordan.hale@example.com',
  location: 'Austin, TX',
  yearsOfExperience: 6,
  workAuthorization: 'us_citizen',
  sponsorshipRequired: false,
  preferredWorkArrangement: 'hybrid',
  targetSalaryMin: 120000,
  targetSalaryMax: 150000,
}

describe('application agent', () => {
  it('detects ATS providers with dedicated adapters', () => {
    expect(supportedAtsProviders()).toEqual(expect.arrayContaining(['workday', 'greenhouse', 'lever', 'ashby', 'icims', 'generic']))
    expect(detectAtsAdapter({ url: 'https://boards.greenhouse.io/acme/jobs/1' }).id).toBe('greenhouse')
    expect(detectAtsAdapter({ url: 'https://jobs.lever.co/acme/abc' }).id).toBe('lever')
    expect(detectAtsAdapter({ url: 'https://jobs.ashbyhq.com/acme/abc' }).id).toBe('ashby')
    expect(detectAtsAdapter({ url: 'https://acme.wd1.myworkdayjobs.com/en-US/careers' }).id).toBe('workday')
    expect(detectAtsAdapter({ url: 'https://acme.icims.com/jobs/1' }).id).toBe('icims')
    expect(detectAtsAdapter({ url: 'https://jobs.example.com/apply' }).id).toBe('generic')
  })

  it('maps known profile fields and pauses unknown required questions', () => {
    const values = profileFieldValues(profile)
    expect(values.email).toBe('jordan.hale@example.com')
    expect(values.firstName).toBe('Jordan')
    expect(values.workAuthorization).toBe('Yes')
    expect(answerKnownQuestion('Are you authorized to work in the United States?', profile)?.answer).toBe('Yes')
    expect(answerKnownQuestion('When can you start?', profile)).toBeNull()
    const resolved = resolveApplicationQuestions(['Full name', 'Availability?'], profile)
    expect(resolved.unknown.some((question) => /availability/i.test(question.prompt))).toBe(true)
  })

  it('detects Apply actions, forms, CAPTCHA, MFA, and login without fabricating success', () => {
    expect(isLegitimateApplyLabel('Apply Now')).toBe(true)
    expect(isLegitimateApplyLabel('Easy Apply')).toBe(false)
    const surface = analyzeApplicationSurface(
      '<form><label>Email</label><input type="email" name="email"><button>Submit Application</button></form>',
    )
    expect(surface.kind === 'application' || surface.inspection.status === 'filling' || surface.hasApplyControl).toBeTruthy()
    expect(inspectApplicationPage('<div class="g-recaptcha" data-sitekey="x"></div>').status).toBe('captcha_required')
    expect(inspectApplicationPage('<p>Enter the authenticator app code</p>').status).toBe('mfa_required')
    expect(inspectApplicationPage('<form>Sign in<input type="password"></form>').status).toBe('login_required')
    expect(detectSubmissionConfirmation({ html: '<p>Form saved</p>' }).detected).toBe(false)
    expect(
      detectSubmissionConfirmation({ html: '<h1>Thank you for applying</h1><p>Confirmation number ABC12345</p>' }).detected,
    ).toBe(true)
    expect(queueStatusFromSession('ready_for_review')).toBe('ready_for_submission')
    expect(queueStatusFromSession('captcha_required')).toBe('captcha_required')
  })
})
