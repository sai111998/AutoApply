import { afterEach, describe, expect, it } from 'vitest'
import { evaluateSyntheticJobEligibility, mapSyntheticApplicationFields, mapUnknownRequiredQuestion, candidateFromStoredProfile } from './eligibility'
import { assertWorkerAvailable, isolateRealEmployerItem, isIsolatedRealEmployerUrl, isSyntheticExecutionUrl } from './worker'
import { AgentError } from './errors'
import { detectSyntheticConfirmation, runExecutionBrowser } from '../browser-worker/browser'
import { resetAgentForTests } from './index'
import { resetConfirmedApplicationsForTests, shouldPersistConfirmedApplication } from '../apply/confirmed'
import { clearAutoApplyMemory } from '../apply/store'
import { saveCandidateProfile } from '../application/candidate-store'
import type { AutoApplyQueueItem } from '../apply/types'

const profile = {
  fullName: 'Jordan Hale',
  email: 'jordan.hale@example.com',
  location: 'Austin, TX',
  yearsOfExperience: 6,
  workAuthorization: 'us_citizen' as const,
  sponsorshipRequired: false,
  preferredWorkArrangement: 'hybrid',
  targetSalaryMin: null,
  targetSalaryMax: null,
  phone: '5125550100',
  linkedin: 'https://linkedin.com/in/jordanhale',
}

function item(partial: Partial<AutoApplyQueueItem> = {}): AutoApplyQueueItem {
  return {
    id: 'item-1',
    runId: 'run-1',
    jobId: 'synthetic-job-1',
    identityKey: 'synthetic:1',
    applicationId: 'app-1',
    resumeVersionId: 'resume-1',
    resumeVersionName: 'Master',
    title: 'Senior Java Full Stack Developer',
    company: 'Test Employer',
    applicationUrl: 'http://127.0.0.1:8787/test-employer/job/1',
    initialMatchScore: 100,
    finalMatchScore: 100,
    c2cStatus: 'unknown',
    c2cEvidence: [],
    applicationStatus: 'queued',
    failureReason: null,
    questions: [],
    tailoredResumeText: 'Java resume',
    jobDescriptionSnapshot: 'JD',
    location: 'Austin, TX',
    confirmationNumber: null,
    confirmationText: null,
    submittedAt: null,
    masterResumeUnchanged: true,
    sessionId: null,
    createdAt: '2026-09-25T00:00:00.000Z',
    updatedAt: '2026-09-25T00:00:00.000Z',
    ...partial,
  }
}

afterEach(() => {
  resetAgentForTests()
  resetConfirmedApplicationsForTests()
  clearAutoApplyMemory()
})

describe('synthetic execution failures', () => {
  it('keeps the synthetic job eligible at 70 with C2C off and all job types', () => {
    expect(
      evaluateSyntheticJobEligibility({
        job: { title: 'Senior Java Full Stack Developer', company: 'Test Employer', matchScore: 70, c2cStatus: 'unknown' },
        minimumMatchRate: 70,
        c2cOnly: false,
        jobType: 'all',
      }).ok,
    ).toBe(true)
  })

  it('maps known profile fields and does not guess unknown questions', () => {
    const built = candidateFromStoredProfile({ userId: 'user-1', profile, resumeText: 'Java resume', resumeVersionId: 'resume-1' })
    const mapped = mapSyntheticApplicationFields(built)
    expect(mapped.mapped.map((field) => field.id)).toEqual(expect.arrayContaining(['first_name', 'last_name', 'email', 'phone']))
    expect(mapped.missing).toEqual([])
    const unknown = mapUnknownRequiredQuestion('What is your favorite color?')
    expect(unknown.answer).toBeNull()
    expect(unknown.source).toBe('user')
  })

  it('returns explicit states for invalid URL, missing profile field, and missing resume', async () => {
    const invalid = await runExecutionBrowser({ item: item({ applicationUrl: 'not-a-url' }), userId: 'user-1' })
    expect(invalid.failureReason).toBe('INVALID_URL')
    expect(invalid.status).toBe('failed')

    saveCandidateProfile({ userId: 'user-1', profile: { ...profile, fullName: '' }, resumeText: 'Java', resumeVersionId: 'resume-1' })
    const missingField = await runExecutionBrowser({ item: item(), userId: 'user-1' })
    expect(missingField.executionState).toBe('needs_user_input')
    expect(missingField.failureReason).toMatch(/MISSING_PROFILE_FIELD/)

    saveCandidateProfile({ userId: 'user-1', profile, resumeText: '', resumeVersionId: 'resume-1' })
    const missingResume = await runExecutionBrowser({ item: item({ tailoredResumeText: '' }), userId: 'user-1' })
    expect(missingResume.failureReason).toBe('MISSING_RESUME')

    saveCandidateProfile({ userId: 'user-1', profile, resumeText: 'Java resume', resumeVersionId: 'resume-1' })
    const noBrowser = await runExecutionBrowser({ item: item(), userId: 'user-1', playwrightAvailable: false })
    expect(noBrowser.failureReason).toBe('BROWSER_UNAVAILABLE')
    expect(() => assertWorkerAvailable(false)).toThrow(AgentError)
    const timedOut = await runExecutionBrowser({
      item: item({ applicationUrl: 'http://127.0.0.1:9/' }),
      userId: 'user-1',
      navigationMs: 200,
    })
    expect(timedOut.failureReason).toMatch(/NAVIGATION_TIMEOUT|BROWSER_UNAVAILABLE/)
  })

  it('does not treat confirmation as success without Application Submitted and a confirmation number', () => {
    expect(detectSyntheticConfirmation('<h1>Thank you</h1>', 'Thank you').confirmed).toBe(false)
    expect(detectSyntheticConfirmation('<h1>Application Submitted</h1>', 'Application Submitted').confirmed).toBe(false)
    expect(detectSyntheticConfirmation('<h1>Application Submitted</h1><p>Confirmation Number: TEST-12345</p>', 'Application Submitted').confirmed).toBe(true)
  })

  it('isolates real employer URLs and never marks them submitted', () => {
    expect(isIsolatedRealEmployerUrl('https://usbank.wd1.myworkdayjobs.com/job/1')).toBe(true)
    expect(isSyntheticExecutionUrl('http://127.0.0.1:8787/test-employer/job/1')).toBe(true)
    const skipped = isolateRealEmployerItem(item({ applicationUrl: 'https://boards.greenhouse.io/x/jobs/1' }))
    expect(skipped.applicationStatus).toBe('skipped')
    expect(skipped.applicationStatus).not.toBe('submitted')
    expect(shouldPersistConfirmedApplication(skipped)).toBe(false)
  })
})
