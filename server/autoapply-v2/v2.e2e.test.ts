import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetCandidateStoreForTests, saveCandidateProfile } from '../application/candidate-store'
import { listConfirmedApplications, resetConfirmedApplicationsForTests } from '../apply/confirmed'
import { useAutomationRuntimeForTests } from '../automation/runtime-io'
import { rememberLiveJobs, resetLiveJobStoreForTests } from '../jobs/live-store'
import type { LiveJob } from '../jobs/list'
import { emptyLiveMatch } from '../jobs/score'
import { startV2AutoApply } from './agent'
import { getV2Run, resetV2QueueForTests } from './queue'
import { resetV2SessionsForTests } from './session'
import { startV2SyntheticEmployer, type V2SyntheticEmployer } from './synthetic'
import { processV2QueueOnce, resetV2WorkerForTests } from './worker'

const USER_ID = 'v2-e2e-user'

let employer: V2SyntheticEmployer | null = null

beforeEach(() => {
  useAutomationRuntimeForTests(mkdtempSync(join(tmpdir(), 'jobpilot-v2e2e-')))
  resetCandidateStoreForTests()
  resetLiveJobStoreForTests()
  resetConfirmedApplicationsForTests()
  resetV2QueueForTests()
  resetV2SessionsForTests()
  resetV2WorkerForTests()
})

afterEach(async () => {
  if (employer) {
    await employer.close()
    employer = null
  }
})

function syntheticLiveJob(jobUrl: string): LiveJob {
  const now = new Date().toISOString()
  return {
    id: 'v2-synthetic-job-1',
    title: 'Senior Engineer',
    company: 'V2 Test Employer',
    location: 'Remote',
    remote: true,
    employmentType: 'Full-time',
    seniority: null,
    description: 'V2 synthetic job description snapshot. Build reliable automation.',
    url: jobUrl,
    source: 'synthetic',
    sourceJobId: null,
    postedAt: null,
    fetchedAt: now,
    provider: 'synthetic',
    providerJobId: null,
    jobUrl,
    workArrangement: 'Remote',
    discoveredAt: now,
    lastVerifiedAt: now,
    identityKey: 'live:v2-synthetic-job-1',
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    rawMetadata: {},
    match: emptyLiveMatch(),
    matchScore: null,
    matchedSkills: [],
    missingSkills: [],
    c2cStatus: 'unknown',
    c2cEvidence: [],
  }
}

describe('V2 synthetic end-to-end', () => {
  it(
    'runs the real browser through apply, fill, upload, submit, confirmation, and persistence',
    async () => {
      employer = await startV2SyntheticEmployer()
      saveCandidateProfile({
        userId: USER_ID,
        profile: {
          fullName: 'Ada Lovelace',
          email: 'ada@example.com',
          location: 'Austin, TX',
          yearsOfExperience: 8,
          workAuthorization: 'US Citizen',
          sponsorshipRequired: false,
          preferredWorkArrangement: 'Remote',
          targetSalaryMin: null,
          targetSalaryMax: null,
          phone: '555-0100',
          linkedin: 'https://linkedin.com/in/ada',
          github: 'https://github.com/ada',
        },
        resumeText: 'Ada Lovelace resume text for V2 synthetic test',
        resumeVersionId: 'resume-v1',
      })
      rememberLiveJobs([syntheticLiveJob(employer.jobUrl)])

      // JOB SELECTED + PROFILE LOADED + RESUME LOADED + queued
      const started = await startV2AutoApply({ userId: USER_ID, jobId: 'v2-synthetic-job-1' })
      expect(started.status).toBe('queued')

      // BROWSER STARTED through CONFIRMATION DETECTED
      const finished = await processV2QueueOnce()
      expect(finished?.status).toBe('submitted')
      const run = getV2Run(started.runId)
      expect(run?.pageState).toBe('APPLICATION_PAGE')
      expect(run?.fieldsFilled).toEqual(
        expect.arrayContaining(['firstName', 'lastName', 'email', 'phone']),
      )
      expect(run?.resumeUploaded).toBe(true)
      expect(run?.submitClicked).toBe(true)
      expect(run?.confirmationNumber).toBe('TEST-12345')
      expect(run?.confirmationText).toMatch(/Application Submitted/i)
      expect(run?.finalUrl).toContain('/test-employer/job/1/apply?step=done')

      // SUPABASE PERSISTED + APPLICATIONS UPDATED (runtime record; Supabase skipped without uuid ids)
      const applications = listConfirmedApplications(USER_ID)
      expect(applications).toHaveLength(1)
      expect(applications[0]).toMatchObject({
        status: 'applied',
        jobTitle: 'Senior Engineer',
        submittedResumeVersionId: 'resume-v1',
        confirmationNumber: 'TEST-12345',
      })
      expect(applications[0].submittedJobDescriptionSnapshot).toContain('V2 synthetic job description snapshot')
      expect(applications[0].finalUrl).toContain('/test-employer/job/1/apply?step=done')
    },
    120000,
  )
})
