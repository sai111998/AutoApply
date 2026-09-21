import { afterEach, describe, expect, it } from 'vitest'
import { JobAggregator, annotateCanonicalJob } from './aggregator'
import { deduplicateJobs } from './deduplicate'
import { isEligibleForAutoApply } from '../apply/eligibility'
import { resolveGreenhouseQuestions } from '../apply/greenhouse-questions'
import { detectSubmissionConfirmation } from '../apply/confirm'
import { emptyLiveMatch, scoreJobAgainstResume } from './score'
import { createAshbyProvider, normalizeAshbyJob } from './providers/ashby'
import { parseAshbyBoardUrl, parseGreenhouseBoardUrl, parseLeverSiteUrl } from './providers/boards'
import {
  canSubmitGreenhouseViaApi,
  createGreenhouseProvider,
  normalizeGreenhouseJob,
  normalizeGreenhouseQuestions,
} from './providers/greenhouse'
import { createLeverProvider, normalizeLeverJob } from './providers/lever'
import type { ApplyBrowser, ListedAutoApplyJob } from '../apply/types'
import {
  defaultAutoApplyConfig,
  prepareQueueItem,
  resetAutoApplyEngineForTests,
  startAutoApply,
  submitQueueItem,
  tailorForJob,
} from '../apply/engine'
import { buildConfirmedApplicationRecord, listConfirmedApplications, persistConfirmedSubmission, resetConfirmedApplicationsForTests } from '../apply/confirmed'
import { clearAutoApplyMemory } from '../apply/store'
import { JAVA_RESUME_TEXT } from '../tailor/fixtures'
import type { ServerConfig } from '../config'

const greenhouseJob = {
  id: 8556658002,
  title: 'AI Engineer',
  absolute_url: 'https://job-boards.greenhouse.io/gitlab/jobs/8556658002',
  updated_at: '2026-09-01T12:00:00.000Z',
  location: { name: 'Remote' },
  content: '<p>Build Java and AI systems at GitLab.</p>',
  departments: [{ name: 'Engineering' }],
  offices: [{ name: 'Remote' }],
  questions: [
    {
      label: 'First Name',
      required: true,
      fields: [{ name: 'first_name', type: 'input_text', required: true }],
    },
    {
      label: 'Email',
      required: true,
      fields: [{ name: 'email', type: 'input_text', required: true }],
    },
    {
      label: 'What is your favorite color?',
      required: true,
      fields: [{ name: 'favorite_color', type: 'input_text', required: true }],
    },
  ],
}

const leverJob = {
  id: 'abc123',
  text: 'Backend Engineer',
  categories: { location: 'Remote', team: 'Engineering', commitment: 'Full-time' },
  descriptionPlain: 'Java Spring Boot services.',
  hostedUrl: 'https://jobs.lever.co/acme/abc123',
  applyUrl: 'https://jobs.lever.co/acme/abc123/apply',
  createdAt: Date.parse('2026-09-01T00:00:00.000Z'),
}

const ashbyJob = {
  id: 'ash-1',
  title: 'Platform Engineer',
  locationName: 'New York, NY',
  employmentType: 'FullTime',
  workplaceType: 'Hybrid',
  isRemote: false,
  jobUrl: 'https://jobs.ashbyhq.com/acme/ash-1',
  applyUrl: 'https://jobs.ashbyhq.com/acme/ash-1',
  publishedDate: '2026-09-02T00:00:00.000Z',
  descriptionPlain: 'Own Kubernetes and Java services.',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('Greenhouse Job Board API', () => {
  it('lists, details, describes, and normalizes jobs from a known board', async () => {
    const fetchImpl = async (url: string) => {
      if (url.endsWith('/gitlab') && !url.includes('/jobs')) return jsonResponse({ name: 'GitLab' })
      if (url.includes('/jobs/8556658002')) return jsonResponse(greenhouseJob)
      if (url.includes('/jobs?content=true')) return jsonResponse({ jobs: [greenhouseJob] })
      return jsonResponse({}, 404)
    }
    const provider = createGreenhouseProvider({ enabled: true, boardTokens: ['gitlab'], fetchImpl })
    const listed = await provider.search({
      keywords: 'AI',
      location: 'Remote',
      remote: 'any',
      employmentType: 'any',
      datePostedDays: 0,
      page: 1,
      pageSize: 25,
    })
    expect(listed.jobs).toHaveLength(1)
    expect(listed.jobs[0]?.provider).toBe('greenhouse')
    expect(listed.jobs[0]?.title).toBe('AI Engineer')
    expect(listed.jobs[0]?.description).toMatch(/Java/)
    expect(listed.jobs[0]?.applicationUrl).toMatch(/greenhouse/)
    expect(listed.jobs[0]?.rawMetadata.boardToken).toBe('gitlab')
    const detail = await provider.getJob?.('gitlab:8556658002')
    expect(detail?.description).toMatch(/AI systems/)
    expect(detail?.rawMetadata.applicationQuestions).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'email', required: true })]),
    )
    expect(provider.supportsApplicationAutomation()).toBe(true)
    const viaAlias = await provider.searchJobs!({
      keywords: 'AI',
      location: 'Remote',
      remote: 'any',
      employmentType: 'any',
      datePostedDays: 0,
      page: 1,
      pageSize: 25,
    })
    expect(viaAlias.jobs[0]?.title).toBe('AI Engineer')
    expect(provider.normalizeJob?.(greenhouseJob)?.company).toBe('Gitlab')
  })

  it('extracts board token and job id from hosted URLs and rejects invalid boards', async () => {
    expect(parseGreenhouseBoardUrl('https://boards.greenhouse.io/gitlab/jobs/8556658002')).toEqual({
      boardToken: 'gitlab',
      jobId: '8556658002',
    })
    const fetchImpl = async () => jsonResponse({}, 404)
    const provider = createGreenhouseProvider({ enabled: true, boardTokens: ['not-a-real-board'], fetchImpl })
    const listed = await provider.search({
      keywords: '',
      location: '',
      remote: 'any',
      employmentType: 'any',
      datePostedDays: 0,
      page: 1,
      pageSize: 10,
    })
    expect(listed.jobs).toEqual([])
    expect(listed.warning?.code).toBe('unavailable')
  })

  it('does not invent a Greenhouse API key for POST submission', () => {
    expect(canSubmitGreenhouseViaApi('')).toBe(false)
    expect(canSubmitGreenhouseViaApi(null)).toBe(false)
    expect(canSubmitGreenhouseViaApi('employer-provided-key')).toBe(true)
  })

  it('maps structured questions and refuses to guess unknown required ones', () => {
    const questions = normalizeGreenhouseQuestions(greenhouseJob.questions)
    expect(questions.map((item) => item.id)).toEqual(expect.arrayContaining(['first_name', 'email', 'favorite_color']))
    const resolved = resolveGreenhouseQuestions(questions, {
      fullName: 'Jordan Hale',
      email: 'jordan.hale@example.com',
      location: 'Austin, TX',
      yearsOfExperience: 6,
      workAuthorization: 'us_citizen',
      sponsorshipRequired: false,
      preferredWorkArrangement: 'remote',
      targetSalaryMin: null,
      targetSalaryMax: null,
    })
    expect(resolved.answered.some((item) => item.id === 'email')).toBe(true)
    expect(resolved.unknown.some((item) => item.id === 'favorite_color')).toBe(true)
    expect(resolved.unknown[0]?.answer).toBeNull()
  })
})

describe('Lever public postings', () => {
  it('lists and normalizes published jobs', async () => {
    const fetchImpl = async (url: string) => {
      if (url.includes('/acme?mode=json')) return jsonResponse([leverJob])
      return jsonResponse({}, 404)
    }
    const provider = createLeverProvider({ enabled: true, sites: ['acme'], fetchImpl })
    const listed = await provider.search({
      keywords: 'Backend',
      location: '',
      remote: 'any',
      employmentType: 'any',
      datePostedDays: 0,
      page: 1,
      pageSize: 10,
    })
    expect(listed.jobs).toHaveLength(1)
    expect(listed.jobs[0]?.provider).toBe('lever')
    expect(listed.jobs[0]?.applicationUrl).toMatch(/lever\.co/)
    expect(listed.jobs[0]?.rawMetadata.team).toBe('Engineering')
    expect(parseLeverSiteUrl('https://jobs.lever.co/acme/abc123')).toEqual({ site: 'acme', jobId: 'abc123' })
    const duplicate = normalizeLeverJob({ ...leverJob, descriptionPlain: 'Shorter Lever copy.' }, 'acme')!
    expect(deduplicateJobs([listed.jobs[0]!, duplicate])).toHaveLength(1)
    const fetchDetail = async (url: string) => {
      if (url.includes('/acme/abc123')) return jsonResponse(leverJob)
      return jsonResponse({}, 404)
    }
    const detailed = await createLeverProvider({ enabled: true, sites: ['acme'], fetchImpl: fetchDetail }).getJob?.('acme:abc123')
    expect(detailed?.title).toBe('Backend Engineer')
    expect(detailed?.provider).toBe('lever')
  })
})

describe('Ashby public postings', () => {
  it('lists and normalizes published jobs', async () => {
    const fetchImpl = async (url: string) => {
      if (url.includes('/job-board/acme')) return jsonResponse({ jobs: [ashbyJob] })
      return jsonResponse({}, 404)
    }
    const provider = createAshbyProvider({ enabled: true, boards: ['acme'], fetchImpl })
    const listed = await provider.search({
      keywords: 'Platform',
      location: 'New York',
      remote: 'any',
      employmentType: 'any',
      datePostedDays: 0,
      page: 1,
      pageSize: 10,
    })
    expect(listed.jobs).toHaveLength(1)
    expect(listed.jobs[0]?.provider).toBe('ashby')
    expect(listed.jobs[0]?.employmentType).toBe('Full-time')
    expect(parseAshbyBoardUrl('https://jobs.ashbyhq.com/acme/ash-1')).toEqual({ board: 'acme', jobId: 'ash-1' })
    const duplicate = normalizeAshbyJob({ ...ashbyJob, descriptionPlain: 'Thin Ashby copy.' }, 'acme')!
    expect(deduplicateJobs([listed.jobs[0]!, duplicate])).toHaveLength(1)
    const detailed = await provider.getJob?.('acme:ash-1')
    expect(detailed?.title).toBe('Platform Engineer')
  })
})

describe('JobAggregator', () => {
  it('merges providers into one canonical job and maps application providers', async () => {
    const greenhouse = normalizeGreenhouseJob(greenhouseJob, 'gitlab')!
    const duplicate = normalizeGreenhouseJob({ ...greenhouseJob, content: '<p>Shorter</p>' }, 'gitlab')!
    const lever = normalizeLeverJob(leverJob, 'acme')!
    const ashby = normalizeAshbyJob(ashbyJob, 'acme')!
    const joaTwin = {
      ...greenhouse,
      provider: 'job-opportunities',
      source: 'Job Opportunities API',
      description: 'Thin',
      rawMetadata: { ...greenhouse.rawMetadata, provider: 'job-opportunities' },
    }
    const aggregated = await JobAggregator.aggregate(
      [
        { providerName: () => 'greenhouse', search: async () => ({ provider: 'greenhouse', jobs: [greenhouse, duplicate], total: 2, page: 1, pageSize: 10, hasMore: false }), label: () => 'Greenhouse', isEnabled: () => true, isAvailable: () => true, connectionLabel: () => 'Connected', supportsApplicationAutomation: () => true },
        { providerName: () => 'lever', search: async () => ({ provider: 'lever', jobs: [lever], total: 1, page: 1, pageSize: 10, hasMore: false }), label: () => 'Lever', isEnabled: () => true, isAvailable: () => true, connectionLabel: () => 'Connected', supportsApplicationAutomation: () => true },
        { providerName: () => 'ashby', search: async () => ({ provider: 'ashby', jobs: [ashby], total: 1, page: 1, pageSize: 10, hasMore: false }), label: () => 'Ashby', isEnabled: () => true, isAvailable: () => true, connectionLabel: () => 'Connected', supportsApplicationAutomation: () => true },
        { providerName: () => 'job-opportunities', search: async () => ({ provider: 'job-opportunities', jobs: [joaTwin], total: 1, page: 1, pageSize: 10, hasMore: false }), label: () => 'Job Opportunities API', isEnabled: () => true, isAvailable: () => true, connectionLabel: () => 'Connected', supportsApplicationAutomation: () => false },
      ],
      { keywords: '', location: '', remote: 'any', employmentType: 'any', datePostedDays: 0, page: 1, pageSize: 25 },
    )
    const gitlab = aggregated.jobs.filter((job) => job.applicationUrl?.includes('8556658002'))
    expect(gitlab).toHaveLength(1)
    expect(gitlab[0]?.provider).toBe('greenhouse')
    expect(gitlab[0]?.discoveryProvider).toBe('greenhouse')
    expect(gitlab[0]?.applicationProvider).toBe('greenhouse')
    expect(aggregated.jobs.some((job) => job.provider === 'lever')).toBe(true)
    expect(aggregated.jobs.some((job) => job.provider === 'ashby')).toBe(true)
    expect(deduplicateJobs([greenhouse, duplicate])).toHaveLength(1)
    expect(annotateCanonicalJob(lever).applicationCapability).toBe('unknown')
  })
})

describe('eligibility across providers', () => {
  function job(partial: Partial<ListedAutoApplyJob> & { id: string; url: string }): ListedAutoApplyJob {
    return {
      title: 'Engineer',
      company: 'Acme',
      description: 'Java Spring Boot C2C corp to corp',
      jobUrl: partial.url,
      identityKey: `greenhouse:${partial.id}`,
      provider: 'greenhouse',
      providerJobId: partial.id,
      location: 'Remote',
      employmentType: 'Contract',
      postedAt: '2026-09-17T00:00:00.000Z',
      fetchedAt: '2026-09-17T00:00:00.000Z',
      c2cStatus: 'confirmed',
      c2cEvidence: [],
      match: { ...emptyLiveMatch('resume-1'), score: 90 },
      matchScore: 90,
      rawMetadata: {},
      ...partial,
    }
  }

  it('requires minimum score, C2C, no duplicates, supported provider, and a valid URL', () => {
    const ready = job({ id: '1', url: 'https://job-boards.greenhouse.io/gitlab/jobs/1' })
    expect(isEligibleForAutoApply(ready, { minimumMatchRate: 85, finalMatchScore: 90 }).ok).toBe(true)
    expect(isEligibleForAutoApply(ready, { minimumMatchRate: 95, finalMatchScore: 90 }).ok).toBe(false)
    expect(isEligibleForAutoApply({ ...ready, c2cStatus: 'unknown' }, { minimumMatchRate: 80, finalMatchScore: 90, jobType: 'c2c' }).ok).toBe(false)
    expect(isEligibleForAutoApply(ready, { minimumMatchRate: 80, finalMatchScore: 90, existingApplications: [{ jobId: '1', status: 'applied' }] }).ok).toBe(false)
    expect(isEligibleForAutoApply(ready, { minimumMatchRate: 80, finalMatchScore: 90, existingQueueIdentities: ['greenhouse:1'] }).ok).toBe(false)
    expect(isEligibleForAutoApply(job({ id: '2', url: 'https://www.indeed.com/viewjob?jk=1' }), { minimumMatchRate: 80, finalMatchScore: 90 }).ok).toBe(false)
    expect(isEligibleForAutoApply(job({ id: '3', url: 'javascript:alert(1)' }), { minimumMatchRate: 80, finalMatchScore: 90 }).ok).toBe(false)
    expect(
      isEligibleForAutoApply(job({ id: '4', url: 'https://job-boards.greenhouse.io/gitlab/jobs/4', postedAt: '2020-01-01T00:00:00.000Z' }), {
        minimumMatchRate: 80,
        finalMatchScore: 90,
      }).ok,
    ).toBe(false)
    expect(
      isEligibleForAutoApply(job({ id: '5', url: 'https://job-boards.greenhouse.io/gitlab/jobs/5', rawMetadata: { expired: true } }), {
        minimumMatchRate: 80,
        finalMatchScore: 90,
      }).ok,
    ).toBe(false)
    expect(
      isEligibleForAutoApply(ready, {
        minimumMatchRate: 80,
        finalMatchScore: 90,
        profile: { fullName: '', email: '' },
      }).ok,
    ).toBe(false)
  })
})

describe('application confirmation', () => {
  it('does not treat form fill as a submission', () => {
    const filled = detectSubmissionConfirmation({
      html: '<form><input name="email"><button>Submit application</button></form>',
      title: 'Apply',
      url: 'https://job-boards.greenhouse.io/gitlab/jobs/1',
    })
    expect(filled.confirmed).toBe(false)
    const confirmed = detectSubmissionConfirmation({
      html: '<h1>Thank you for applying</h1><p>Your application was submitted. Confirmation number ABC123</p>',
      title: 'Application submitted',
      url: 'https://job-boards.greenhouse.io/gitlab/jobs/1/confirmation',
    })
    expect(confirmed.confirmed).toBe(true)
    expect(confirmed.confirmationNumber).toMatch(/ABC123/)
  })

  it('keeps failed submissions out of Applications', () => {
    const failed = detectSubmissionConfirmation({
      html: '<p>We could not submit your application. Please try again.</p>',
      title: 'Error',
      url: 'https://job-boards.greenhouse.io/gitlab/jobs/1',
    })
    expect(failed.confirmed).toBe(false)
    expect(
      buildConfirmedApplicationRecord({
        userId: 'user-1',
        item: {
          id: 'item-1',
          runId: 'run-1',
          jobId: 'job-1',
          identityKey: 'greenhouse:1',
          applicationId: '11111111-1111-4111-8111-111111111111',
          resumeVersionId: 'resume-1',
          resumeVersionName: 'Master',
          title: 'AI Engineer',
          company: 'GitLab',
          applicationUrl: 'https://job-boards.greenhouse.io/gitlab/jobs/1',
          initialMatchScore: 88,
          finalMatchScore: 90,
          c2cStatus: 'unknown',
          c2cEvidence: [],
          applicationStatus: 'failed',
          failureReason: 'Employer rejected the submission.',
          questions: [],
          tailoredResumeText: JAVA_RESUME_TEXT,
          jobDescriptionSnapshot: 'Build Java systems.',
          location: 'Remote',
          confirmationNumber: null,
          confirmationText: null,
          submittedAt: null,
          masterResumeUnchanged: true,
          sessionId: null,
          createdAt: '2026-09-20T00:00:00.000Z',
          updatedAt: '2026-09-20T00:00:00.000Z',
        },
      }),
    ).toBeNull()
  })
})

const config: ServerConfig = {
  port: 0,
  llmApiKey: '',
  llmApiBaseUrl: 'https://example.invalid/v1',
  llmModel: 'test-model',
  supabaseUrl: '',
  supabaseServiceRoleKey: '',
  joobleApiKey: '',
  joobleEnabled: false,
  joobleApiBaseUrl: 'https://jooble.org/api',
  usajobsApiKey: '',
  usajobsUserAgentEmail: '',
  usajobsEnabled: false,
  jobOpportunitiesEnabled: true,
  jobOpportunitiesApiBaseUrl: 'https://api.jobopportunitiesapi.org',
}

describe('synthetic Greenhouse-like auto apply pipeline', () => {
  afterEach(() => {
    clearAutoApplyMemory()
    resetAutoApplyEngineForTests()
    resetConfirmedApplicationsForTests()
  })

  it('discovers, matches, tailors, queues, fills, submits, confirms, and records the application', async () => {
    const normalized = normalizeGreenhouseJob(
      {
        ...greenhouseJob,
        questions: [
          { label: 'First Name', required: true, fields: [{ name: 'first_name', type: 'input_text', required: true }] },
          { label: 'Email', required: true, fields: [{ name: 'email', type: 'input_text', required: true }] },
        ],
        absolute_url: 'https://jobs.example.com/greenhouse-apply',
      },
      'gitlab',
    )!
    const discovered = (await JobAggregator.aggregate(
      [
        {
          providerName: () => 'greenhouse',
          search: async () => ({ provider: 'greenhouse', jobs: [normalized], total: 1, page: 1, pageSize: 10, hasMore: false }),
          label: () => 'Greenhouse',
          isEnabled: () => true,
          isAvailable: () => true,
          connectionLabel: () => 'Connected',
          supportsApplicationAutomation: () => true,
        },
      ],
      { keywords: 'AI', location: '', remote: 'any', employmentType: 'any', datePostedDays: 0, page: 1, pageSize: 10 },
    )).jobs[0]
    expect(discovered?.discoveryProvider).toBe('greenhouse')
    expect(discovered?.applicationCapability).toBe('auto_apply_supported')

    const match = scoreJobAgainstResume(discovered!, JAVA_RESUME_TEXT, 'resume-1')
    expect(match.score).toBeGreaterThan(0)
    const tailored = tailorForJob({
      resumeText: JAVA_RESUME_TEXT,
      job: {
        id: discovered!.id,
        title: discovered!.title,
        company: discovered!.company,
        description: discovered!.description,
        url: discovered!.applicationUrl ?? null,
        jobUrl: discovered!.jobUrl,
        identityKey: discovered!.identityKey,
        provider: discovered!.provider,
        providerJobId: discovered!.providerJobId,
        employmentType: discovered!.employmentType,
        location: discovered!.location,
        c2cStatus: 'unknown',
        c2cEvidence: [],
        match,
        matchScore: match.score,
        postedAt: discovered!.postedAt,
        fetchedAt: discovered!.discoveredAt,
      },
    })
    expect(JAVA_RESUME_TEXT).toContain('Java')
    expect(tailored.score).toBeGreaterThanOrEqual(match.score ?? 0)

    const listed: ListedAutoApplyJob = {
      id: discovered!.id,
      title: discovered!.title,
      company: discovered!.company,
      description: `${discovered!.description}\nC2C corp to corp`,
      url: 'https://jobs.example.com/greenhouse-apply',
      jobUrl: 'https://jobs.example.com/greenhouse-apply',
      identityKey: discovered!.identityKey,
      provider: 'greenhouse',
      providerJobId: discovered!.providerJobId,
      employmentType: 'Contract',
      location: discovered!.location,
      c2cStatus: 'confirmed',
      c2cEvidence: [],
      match: { ...match, score: 90 },
      matchScore: 90,
      postedAt: discovered!.postedAt,
      fetchedAt: discovered!.discoveredAt,
      rawMetadata: discovered!.rawMetadata,
      discoveryProvider: 'greenhouse',
      applicationProvider: 'greenhouse',
      applicationCapability: 'auto_apply_supported',
    }

    const browser: ApplyBrowser = {
      async prepare() {
        return { status: 'ready_for_submission', questions: [], failureReason: null, sessionId: 'filled:upload:next' }
      },
      async submit() {
        return {
          status: 'submitted',
          failureReason: null,
          success: true,
          confirmationDetected: true,
          confirmationNumber: 'GH-1001',
          confirmationText: 'Application received',
          resultingUrl: 'https://jobs.example.com/greenhouse-apply/confirmation',
          finalActionCompleted: true,
        }
      },
    }

    const started = await startAutoApply(
      config,
      {
        userId: 'user-1',
        resumeId: 'resume-1',
        resumeVersionId: 'resume-1',
        resumeText: JAVA_RESUME_TEXT,
        masterResumeText: JAVA_RESUME_TEXT,
        profile: {
          fullName: 'Jordan Hale',
          email: 'jordan.hale@example.com',
          location: 'Austin, TX',
          yearsOfExperience: 6,
          workAuthorization: 'us_citizen',
          sponsorshipRequired: false,
          preferredWorkArrangement: 'remote',
          targetSalaryMin: null,
          targetSalaryMax: null,
        },
        config: defaultAutoApplyConfig({ autoTailorResume: true, minimumMatchRate: 70, maxJobs: 1, jobType: 'all' }),
      },
      undefined,
      { listJobs: async () => ({ jobs: [listed] }), browser, delayMs: 0 },
    )
    expect(started.items).toHaveLength(1)
    expect(started.items[0]?.applicationStatus).toBe('queued')
    expect(started.items[0]?.resumeVersionName).toMatch(/Tailored/)
    expect(started.items[0]?.masterResumeUnchanged).toBe(true)

    const prepared = await prepareQueueItem(started.run.id, started.items[0]!.id, {
      profile: {
        fullName: 'Jordan Hale',
        email: 'jordan.hale@example.com',
        location: 'Austin, TX',
        yearsOfExperience: 6,
        workAuthorization: 'us_citizen',
        sponsorshipRequired: false,
        preferredWorkArrangement: 'remote',
        targetSalaryMin: null,
        targetSalaryMax: null,
      },
    }, { browser, delayMs: 0 })
    expect(prepared?.item.applicationStatus).toBe('ready_for_submission')

    const submitted = await submitQueueItem(started.run.id, started.items[0]!.id, { browser, delayMs: 0 })
    expect(submitted?.item.applicationStatus).toBe('submitted')
    expect(submitted?.item.confirmationNumber).toMatch(/GH-1001/)

    await persistConfirmedSubmission({
      userId: 'user-1',
      item: submitted!.item,
      provider: 'greenhouse',
    })
    const applications = listConfirmedApplications('user-1')
    expect(applications).toHaveLength(1)
    expect(applications[0]?.jobTitle).toBe('AI Engineer')
    expect(applications[0]?.isConfirmedSubmission).toBe(true)
    expect(applications[0]?.confirmationNumber).toMatch(/GH-1001/)
    expect(applications[0]?.discoveryProvider).toBe('greenhouse')
    expect(applications[0]?.applicationProvider).toBeTruthy()
  })
})
