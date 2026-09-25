import { afterEach, describe, expect, it } from 'vitest'
import { shouldPersistConfirmedApplication } from '../apply/confirmed'
import type { AutoApplyProfile, ListedAutoApplyJob } from '../apply/types'
import { isIsolatedRealEmployerUrl } from './worker'
import {
  buildSmokeTestQueueItem,
  inspectCandidateProfileAvailability,
  isAutoApplySmokeTestEnabled,
  isFixtureCandidateProfile,
  mapAgentStatusToSmokeStatus,
  mapSmokeTestStatus,
  markSmokeTestJobProcessed,
  markSmokeTestJobSelected,
  resetSmokeTestStateForTests,
  selectSmokeTestJob,
  shouldIsolateRealEmployerUrl,
  shouldRetrySmokeTest,
  shouldSkipCapabilityGate,
  smokeTestCampaignConfig,
  validateSmokeTestSafety,
} from './smoke-test'

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

function job(partial: Partial<ListedAutoApplyJob> & { id: string; title?: string }): ListedAutoApplyJob {
  return {
    id: partial.id,
    title: partial.title ?? 'Backend Engineer',
    company: partial.company ?? 'Acme',
    description: partial.description ?? 'Java role',
    url: partial.url ?? 'https://job-boards.greenhouse.io/gitlab/jobs/1',
    jobUrl: partial.jobUrl ?? partial.url ?? 'https://job-boards.greenhouse.io/gitlab/jobs/1',
    identityKey: partial.identityKey ?? `greenhouse:${partial.id}`,
    provider: partial.provider ?? 'greenhouse',
    providerJobId: partial.providerJobId ?? partial.id,
    employmentType: partial.employmentType ?? 'full-time',
    location: partial.location ?? 'Remote',
    c2cStatus: partial.c2cStatus ?? 'unknown',
    c2cEvidence: partial.c2cEvidence ?? [],
    match: partial.match ?? { score: 10, matchedSkills: [], missingSkills: [], resumeVersionId: null, scoreUpdatedAt: null, cached: false },
    matchScore: Object.prototype.hasOwnProperty.call(partial, 'matchScore') ? (partial.matchScore ?? null) : 10,
    postedAt: partial.postedAt ?? new Date().toISOString(),
    fetchedAt: partial.fetchedAt ?? new Date().toISOString(),
    rawMetadata: partial.rawMetadata,
    applicationCapability: partial.applicationCapability,
    applicationProvider: partial.applicationProvider,
    discoveryProvider: partial.discoveryProvider,
    applicationUrl: partial.applicationUrl ?? partial.url ?? 'https://job-boards.greenhouse.io/gitlab/jobs/1',
  }
}

afterEach(() => {
  resetSmokeTestStateForTests()
})

describe('one-job Auto Apply smoke test state machine', () => {
  it('selects exactly one live job and ignores match, C2C, tailoring, and unknown capability', () => {
    const first = job({
      id: '1',
      title: 'Full Stack Developer',
      company: 'GitLab',
      matchScore: 12,
      c2cStatus: 'not_allowed',
      applicationCapability: 'unknown',
    })
    const second = job({
      id: '2',
      title: 'Second Job',
      company: 'Other',
      url: 'https://job-boards.greenhouse.io/gitlab/jobs/2',
    })
    const selected = selectSmokeTestJob({ jobs: [first, second] })
    expect(selected.job?.id).toBe('1')
    expect(selected.url).toContain('greenhouse.io')
    expect(markSmokeTestJobSelected()).toBe(true)
    expect(selectSmokeTestJob({ jobs: [second] }).job).toBeNull()
    expect(shouldRetrySmokeTest()).toBe(false)

    const config = smokeTestCampaignConfig({
      maxJobs: 8,
      autoTailorResume: true,
      jobType: 'c2c',
      remotePreference: 'remote',
      keywords: ['java'],
      minimumMatchRate: 95,
    })
    expect(config.maxJobs).toBe(1)
    expect(config.autoTailorResume).toBe(false)
    expect(config.jobType).toBe('all')
    expect(config.keywords).toEqual([])
    expect(config.includeSynthetic).toBe(false)
    expect(isAutoApplySmokeTestEnabled({ AUTO_APPLY_SMOKE_TEST: 'true' })).toBe(true)
  })

  it('does not require a match score or C2C confirmation to select a job', () => {
    const selected = selectSmokeTestJob({
      jobs: [
        job({
          id: 'low',
          matchScore: null,
          c2cStatus: 'unknown',
          title: 'Support Engineer',
          company: 'Example Co',
        }),
      ],
    })
    expect(selected.job?.id).toBe('low')
    expect(validateSmokeTestSafety(selected.job!).ok).toBe(true)
  })

  it('maps candidate profile fields as available or missing without storing guesses', () => {
    const complete = inspectCandidateProfileAvailability({
      profile: { ...profile, phone: '5125550100', linkedin: 'https://linkedin.com/in/x' } as AutoApplyProfile,
      resumeText: 'Java engineer at Northwind',
      resumeVersionId: 'resume-1',
    })
    expect(complete.fields.firstName).toBe('available')
    expect(complete.fields.lastName).toBe('available')
    expect(complete.fields.email).toBe('available')
    expect(complete.fields.resume).toBe('available')
    expect(complete.ready).toBe(true)

    const missing = inspectCandidateProfileAvailability({
      profile: { ...profile, fullName: '', email: '' },
      resumeText: '',
    })
    expect(missing.fields.firstName).toBe('missing')
    expect(missing.fields.email).toBe('missing')
    expect(missing.fields.resume).toBe('missing')
    expect(missing.requiredMissing).toEqual(expect.arrayContaining(['firstName', 'email', 'resume']))
    expect(missing.ready).toBe(false)
    expect(isFixtureCandidateProfile(profile)).toBe(true)
  })

  it('treats resume upload, final submit, and confirmed submission as distinct outcomes', () => {
    const confirmed = mapSmokeTestStatus({ submitClicked: true, confirmed: true, attempted: true })
    expect(confirmed.status).toBe('submitted')
    expect(confirmed.firstFailure).toBeNull()
    expect(shouldPersistConfirmedApplication({ applicationStatus: 'submitted' })).toBe(true)

    const queued = buildSmokeTestQueueItem({
      run: {
        id: 'run-1',
        userId: 'user-1',
        status: 'running',
        config: smokeTestCampaignConfig(undefined),
        counts: {
          found: 0,
          eligible: 0,
          autoApplyCapable: 0,
          tailored: 0,
          ready: 0,
          needsInput: 0,
          submitted: 0,
          skipped: 0,
          failed: 0,
          queued: 0,
          processing: 0,
          processed: 0,
          blocked: 0,
          captcha: 0,
        },
        createdAt: '2026-09-25T00:00:00.000Z',
        updatedAt: '2026-09-25T00:00:00.000Z',
      },
      start: {
        userId: 'user-1',
        resumeId: 'resume-1',
        resumeVersionId: 'resume-1',
        resumeText: 'Java resume',
        masterResumeText: 'Java resume',
        profile,
        config: smokeTestCampaignConfig(undefined),
      },
      job: job({ id: '1', title: 'Full Stack Developer', company: 'GitLab' }),
      url: 'https://job-boards.greenhouse.io/gitlab/jobs/1',
    })
    expect(queued.masterResumeUnchanged).toBe(true)
    expect(queued.applicationCapability).toBe('unknown')
    expect(queued.discoverySource).toBe('smoke-test')
    expect(queued.tailoredResumeText).toBe('Java resume')
  })

  it('marks submission uncertain when submit was clicked without confirmation', () => {
    const uncertain = mapSmokeTestStatus({ submitClicked: true, confirmed: false, attempted: true })
    expect(uncertain.status).toBe('submission_uncertain')
    expect(uncertain.firstFailure).toBe('confirmation')
    expect(mapAgentStatusToSmokeStatus('needs_confirmation', true)).toBe('submission_uncertain')
    expect(shouldPersistConfirmedApplication({ applicationStatus: 'submission_uncertain' })).toBe(false)
    expect(shouldRetrySmokeTest()).toBe(false)
  })

  it('stops on CAPTCHA, login, MFA, and unknown required questions', () => {
    expect(mapSmokeTestStatus({ captcha: true }).status).toBe('captcha_required')
    expect(mapSmokeTestStatus({ captcha: true }).rootCause).toMatch(/CAPTCHA prevented autonomous completion/)
    expect(mapSmokeTestStatus({ login: true }).status).toBe('login_required')
    expect(mapSmokeTestStatus({ mfa: true }).status).toBe('mfa_required')
    expect(mapSmokeTestStatus({ unknownRequired: true }).status).toBe('needs_user_input')
    expect(shouldPersistConfirmedApplication({ applicationStatus: 'captcha_required' })).toBe(false)
    expect(shouldPersistConfirmedApplication({ applicationStatus: 'login_required' })).toBe(false)
    expect(shouldPersistConfirmedApplication({ applicationStatus: 'mfa_required' })).toBe(false)
    expect(shouldPersistConfirmedApplication({ applicationStatus: 'needs_user_input' })).toBe(false)
  })

  it('does not retry or process a second smoke-test job', () => {
    expect(markSmokeTestJobSelected()).toBe(true)
    expect(markSmokeTestJobSelected()).toBe(false)
    expect(markSmokeTestJobProcessed()).toBe(true)
    expect(markSmokeTestJobProcessed()).toBe(false)
    expect(shouldRetrySmokeTest()).toBe(false)
    expect(mapAgentStatusToSmokeStatus('failed', false)).toBe('submission_failed')
  })

  it('bypasses real-employer isolation only for the smoke-test item', () => {
    const url = 'https://usbank.wd1.myworkdayjobs.com/job/1'
    expect(isIsolatedRealEmployerUrl(url)).toBe(true)
    expect(shouldIsolateRealEmployerUrl(true, { discoverySource: 'smoke-test' }, { AUTO_APPLY_SMOKE_TEST: 'true' })).toBe(false)
    expect(shouldIsolateRealEmployerUrl(true, { discoverySource: 'greenhouse' }, { AUTO_APPLY_SMOKE_TEST: 'true' })).toBe(true)
    expect(shouldIsolateRealEmployerUrl(true, { discoverySource: 'smoke-test' }, {})).toBe(true)
    expect(shouldSkipCapabilityGate({ discoverySource: 'smoke-test' }, { AUTO_APPLY_SMOKE_TEST: 'true' })).toBe(true)
    expect(shouldSkipCapabilityGate({ discoverySource: 'smoke-test' }, {})).toBe(false)
  })

  it('skips expired, already applied, and invalid URLs during selection', () => {
    const expired = job({
      id: 'expired',
      rawMetadata: { expired: true },
    })
    const applied = job({
      id: 'applied',
      url: 'https://job-boards.greenhouse.io/gitlab/jobs/9',
    })
    const invalid = job({
      id: 'bad',
      url: 'javascript:alert(1)',
      jobUrl: 'javascript:alert(1)',
      applicationUrl: 'javascript:alert(1)',
    })
    const live = job({
      id: 'live',
      title: 'Site Reliability Engineer',
      company: 'GitLab',
      url: 'https://job-boards.greenhouse.io/gitlab/jobs/3',
    })
    expect(validateSmokeTestSafety(expired).ok).toBe(false)
    expect(validateSmokeTestSafety(invalid).ok).toBe(false)
    const selected = selectSmokeTestJob({
      jobs: [expired, invalid, applied, live],
      existingApplications: [{ jobId: 'applied', status: 'applied' }],
    })
    expect(selected.job?.id).toBe('live')
  })
})
