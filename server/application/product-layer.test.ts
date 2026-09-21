import { afterEach, describe, expect, it } from 'vitest'
import { inspectApplicationPage } from './detector'
import { detectAtsAdapter, supportedAtsProviders } from './provider'
import { evaluateApplicationCapability, canEnterAutonomousApply } from './capability'
import { selectedResumeForUpload, assertMasterResumeUnchanged } from './resume'
import { classifyNavigationControl, persistStepState, isBoundedStepTimeout } from './navigation'
import { canInsertApplicationHistory, detectSubmissionConfirmation } from './confirmation'
import { profileFieldValues } from './fields'
import { persistTheme, readStoredTheme, THEME_STORAGE_KEY } from '../../src/lib/theme'
import type { AutoApplyProfile, AutoApplyQueueItem } from '../apply/types'
import { resetAnswerLibraryForTests } from './answers'

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

function queueItem(overrides: Partial<AutoApplyQueueItem> = {}): AutoApplyQueueItem {
  return {
    id: 'item-1',
    runId: 'run-1',
    jobId: 'job-1',
    identityKey: 'job-1',
    applicationId: 'app-1',
    resumeVersionId: 'resume-tailored-1',
    resumeVersionName: 'Tailored v1 — Java Engineer',
    title: 'Java Engineer',
    company: 'Acme',
    applicationUrl: 'https://jobs.example.com/apply',
    initialMatchScore: 80,
    finalMatchScore: 88,
    c2cStatus: 'confirmed',
    c2cEvidence: [],
    applicationStatus: 'queued',
    failureReason: null,
    questions: [],
    tailoredResumeText: 'Exact submitted Java resume',
    jobDescriptionSnapshot: 'Java Spring Boot C2C',
    location: 'Austin, TX',
    confirmationNumber: null,
    confirmationText: null,
    submittedAt: null,
    masterResumeUnchanged: true,
    sessionId: null,
    createdAt: '2026-09-20T11:00:00.000Z',
    updatedAt: '2026-09-20T11:00:00.000Z',
    ...overrides,
  }
}

afterEach(() => {
  resetAnswerLibraryForTests()
})

describe('application product layer', () => {
  it('detects incremental ATS providers without claiming untested support', () => {
    expect(supportedAtsProviders()).toEqual(
      expect.arrayContaining(['workday', 'greenhouse', 'lever', 'ashby', 'icims', 'smartrecruiters', 'generic']),
    )
    expect(detectAtsAdapter({ url: 'https://jobs.smartrecruiters.com/acme/1' }).id).toBe('smartrecruiters')
    const smart = evaluateApplicationCapability({ url: 'https://jobs.smartrecruiters.com/acme/1' })
    expect(smart.capability).not.toBe('auto_apply_supported')
    expect(canEnterAutonomousApply(smart.capability)).toBe(false)
    expect(evaluateApplicationCapability({ url: 'https://boards.greenhouse.io/acme/jobs/1' }).capability).toBe(
      'auto_apply_supported',
    )
  })

  it('maps profile values onto application fields', () => {
    const values = profileFieldValues(profile)
    expect(values.email).toBe('jordan.hale@example.com')
    expect(values.firstName).toBe('Jordan')
    expect(values.lastName).toBe('Hale')
    expect(values.workAuthorization).toBe('Yes')
  })

  it('uploads the selected resume version and never overwrites the master', () => {
    const master = 'MASTER RESUME TEXT'
    const upload = selectedResumeForUpload(queueItem(), master)
    expect(upload?.versionId).toBe('resume-tailored-1')
    expect(upload?.text).toBe('Exact submitted Java resume')
    expect(upload?.fileName).toMatch(/Tailored/)
    expect(assertMasterResumeUnchanged(master, master)).toBe(true)
    expect(assertMasterResumeUnchanged(master, upload?.text ?? '')).toBe(false)
  })

  it('classifies multi-step navigation and persists step state with a bounded timeout', () => {
    expect(classifyNavigationControl('Next')).toBe('next')
    expect(classifyNavigationControl('Continue')).toBe('next')
    expect(classifyNavigationControl('Submit Application')).toBe('submit')
    expect(classifyNavigationControl('Apply Now')).toBe('apply')
    const step = persistStepState({ step: 2, pageType: 'application', url: 'https://jobs.example.com/apply', now: '2026-09-20T12:00:00.000Z' })
    expect(step.step).toBe(2)
    expect(step.persistedAt).toBe('2026-09-20T12:00:00.000Z')
    expect(isBoundedStepTimeout(8_000)).toBe(true)
    expect(isBoundedStepTimeout(20_000)).toBe(false)
  })

  it('pauses on CAPTCHA, login, and MFA without marking submitted', () => {
    expect(inspectApplicationPage('<div class="g-recaptcha" data-sitekey="x"></div>').status).toBe('captcha_required')
    expect(inspectApplicationPage('<form>Sign in<input type="password"></form>').status).toBe('login_required')
    expect(inspectApplicationPage('<p>Enter the authenticator app code</p>').status).toBe('mfa_required')
    expect(canInsertApplicationHistory(queueItem({ applicationStatus: 'captcha_required' }))).toBe(false)
    expect(canInsertApplicationHistory(queueItem({ applicationStatus: 'login_required' }))).toBe(false)
    expect(canInsertApplicationHistory(queueItem({ applicationStatus: 'mfa_required' }))).toBe(false)
  })

  it('inserts Applications only after confirmed submission', () => {
    expect(detectSubmissionConfirmation({ html: '<p>Form saved</p>' }).confirmed).toBe(false)
    const confirmed = detectSubmissionConfirmation({
      html: '<h1>Thank you for applying</h1><p>Confirmation number ABC12345</p>',
    })
    expect(confirmed.detected).toBe(true)
    expect(canInsertApplicationHistory(queueItem({ applicationStatus: 'filling' }), confirmed)).toBe(false)
    expect(canInsertApplicationHistory(queueItem({ applicationStatus: 'submitted' }), confirmed)).toBe(true)
    expect(
      canInsertApplicationHistory(queueItem({ applicationStatus: 'submitted' }), {
        success: false,
        confirmed: false,
        detected: false,
      }),
    ).toBe(false)
  })

  it('keeps Dark Mode persisted independently of Auto Apply', () => {
    const storage = {
      data: {} as Record<string, string>,
      getItem(key: string) {
        return this.data[key] ?? null
      },
      setItem(key: string, value: string) {
        this.data[key] = value
      },
      removeItem(key: string) {
        delete this.data[key]
      },
      clear() {
        this.data = {}
      },
      key() {
        return null
      },
      get length() {
        return Object.keys(this.data).length
      },
    } as Storage
    persistTheme('dark', storage)
    expect(storage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    expect(readStoredTheme(storage)).toBe('dark')
  })
})
