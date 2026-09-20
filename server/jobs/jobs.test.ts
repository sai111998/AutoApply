import { afterEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../app'
import type { ServerConfig } from '../config'
import { clearHttpCaches } from './http'
import { discoverJobs } from './discover'
import { fetchProviderJob } from './provider'
import { deduplicateJobs } from './deduplicate'
import { fingerprint, identityKey, parseSalary, stableJobId } from './normalize'
import { parseDiscoverRequest, parseLiveJobsQuery, parseNormalizedJob } from './parse'
import { sortLiveJobs, toLiveJob } from './list'
import { clearLiveScoreCache } from './score'
import { clearLivePreviewCache } from './preview'
import { normalizeJoobleJob } from './providers/jooble'
import {
  buildPublicJobsSearchParams,
  normalizeJobOpportunitiesJob,
} from './providers/job-opportunities'
import { normalizeUsaJobsJob } from './providers/usajobs'
import { JAVA_RESUME_TEXT } from '../tailor/fixtures'

const config: ServerConfig = {
  port: 0,
  llmApiKey: 'test-key',
  llmApiBaseUrl: 'https://example.invalid/v1',
  llmModel: 'test-model',
  supabaseUrl: '',
  supabaseServiceRoleKey: '',
  joobleApiKey: 'jooble-test',
  joobleEnabled: true,
  joobleApiBaseUrl: 'https://jooble.org/api',
  usajobsApiKey: 'usajobs-test',
  usajobsUserAgentEmail: 'jobs@example.com',
  usajobsEnabled: true,
  jobOpportunitiesEnabled: true,
  jobOpportunitiesApiBaseUrl: 'https://api.jobopportunitiesapi.org',
}

const jooblePayload = {
  totalCount: 2,
  jobs: [
    {
      id: 111,
      title: 'Java Software Engineer',
      location: 'Austin, TX',
      snippet: 'Build Java and Spring Boot services on AWS with PostgreSQL.',
      salary: '120000 - 150000 USD',
      source: 'jooble',
      type: 'Full-time',
      link: 'https://jooble.org/jdp/111?utm_source=feed',
      company: 'Company A',
      updated: '2026-09-01T12:00:00.000Z',
    },
    {
      id: 222,
      title: '',
      location: 'Remote',
      snippet: 'Missing title should be dropped',
      link: 'https://jooble.org/jdp/222',
      company: 'Nope',
    },
  ],
}

const jobOpportunitiesPayload = {
  data: [
    {
      id: 'ffd759ce-b1fa-4ace-a823-bb0d0595e4ae',
      slug: 'java-software-engineer-ffd759ce',
      title: 'Java Software Engineer',
      company: 'Teledyne FLIR',
      country: 'US',
      city: 'Huntsville',
      location: 'US - Huntsville, AL',
      region: 'AL',
      remote: 'on_site',
      employment_type: 'Full-time',
      seniority: 'Senior',
      posted_at: '2026-09-17T04:07:29Z',
      first_seen_at: '2026-09-17T04:10:36Z',
      last_verified_at: '2026-09-17T05:47:03Z',
      status: 'live',
      apply_url: 'https://flir.wd1.myworkdayjobs.com/flircareers/job/java-engineer',
      source: 'workday',
      has_description: true,
      description: 'Build Java and Spring Boot services on AWS with PostgreSQL.',
    },
  ],
  has_more: true,
  next_cursor: null,
}

const jobOpportunitiesDetail = {
  data: {
    ...jobOpportunitiesPayload.data[0],
    description: null,
  },
  description: 'Build Java and Spring Boot services on AWS with PostgreSQL. Status: live.',
}

const usaPayload = {
  SearchResult: {
    SearchResultCount: 1,
    SearchResultCountAll: 8,
    SearchResultItems: [
      {
        MatchedObjectId: '800001',
        MatchedObjectDescriptor: {
          PositionID: 'DE-800001',
          PositionTitle: 'Software Engineer',
          PositionURI: 'https://www.usajobs.gov/job/800001',
          PositionLocationDisplay: 'Remote, United States',
          OrganizationName: 'Department of Commerce',
          DepartmentName: 'Department of Commerce',
          QualificationSummary: 'Java, Spring Boot, and AWS experience required.',
          PublicationStartDate: '2026-09-02T00:00:00Z',
          PositionSchedule: [{ Name: 'Full-Time', Code: '1' }],
          PositionRemuneration: [{ MinimumRange: '110000', MaximumRange: '140000', Description: 'Per Year' }],
          UserArea: { Details: { JobSummary: 'Develop Java services.', MajorDuties: 'Write Spring Boot APIs.' } },
        },
      },
    ],
  },
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

afterEach(() => {
  clearHttpCaches()
  clearLiveScoreCache()
  clearLivePreviewCache()
})

describe('normalization and identity', () => {
  it('parses Jooble jobs without inventing missing fields', () => {
    const job = normalizeJoobleJob(jooblePayload.jobs[0])
    expect(job?.title).toBe('Java Software Engineer')
    expect(job?.company).toBe('Company A')
    expect(job?.jobUrl).toBe('https://jooble.org/jdp/111')
    expect(job?.salaryMin).toBe(120000)
    expect(job?.salaryMax).toBe(150000)
    expect(job?.salaryCurrency).toBe('USD')
    expect(job?.source).toBe('Jooble')
    expect(normalizeJoobleJob(jooblePayload.jobs[1])).toBeNull()
    expect(normalizeJoobleJob(null)).toBeNull()
    expect(normalizeJoobleJob('nope')).toBeNull()
  })

  it('parses Job Opportunities API jobs without inventing missing fields', () => {
    const job = normalizeJobOpportunitiesJob(jobOpportunitiesPayload.data[0])
    expect(job?.provider).toBe('job-opportunities')
    expect(job?.title).toBe('Java Software Engineer')
    expect(job?.company).toBe('Teledyne FLIR')
    expect(job?.jobUrl).toContain('myworkdayjobs.com')
    expect(job?.source).toBe('Job Opportunities API')
    expect(job?.rawMetadata.listingSource).toBe('workday')
    expect(job?.liveDemoProvider).toBe(false)
    expect(job?.seniority).toBe('Senior')
    expect(job?.employmentType).toBe('Full-time')
    expect(normalizeJobOpportunitiesJob({ company: 'Nope' })).toBeNull()
  })

  it('maps US location and search filters onto official query parameters', () => {
    const nationwide = buildPublicJobsSearchParams({
      keywords: 'Java Software Engineer',
      location: 'United States',
      remote: 'remote',
      employmentType: 'full-time',
      experienceLevel: 'senior',
      datePostedDays: 30,
      page: 1,
      pageSize: 10,
    })
    expect(nationwide.get('country')).toBe('US')
    expect(nationwide.get('title')).toBe('Java Software Engineer')
    expect(nationwide.get('remote')).toBe('remote')
    expect(nationwide.get('employment_type')).toBe('Full-time')
    expect(nationwide.get('seniority')).toBe('Senior')
    expect(nationwide.get('limit')).toBe('10')
    expect(nationwide.get('include_description')).toBe('true')
    expect(nationwide.get('city')).toBeNull()
    const city = buildPublicJobsSearchParams({
      keywords: 'Python Engineer',
      location: 'Austin, TX',
      remote: 'any',
      employmentType: 'any',
      datePostedDays: 7,
      page: 1,
      pageSize: 80,
    })
    expect(city.get('country')).toBe('US')
    expect(city.get('city')).toBe('Austin')
    expect(city.get('state')).toBe('TX')
    expect(city.get('limit')).toBe('50')
    const remoteOnly = buildPublicJobsSearchParams({
      keywords: 'Software Engineer kubernetes',
      location: 'Remote',
      remote: 'remote',
      employmentType: 'any',
      datePostedDays: 14,
      page: 1,
      pageSize: 25,
    })
    expect(remoteOnly.get('country')).toBe('US')
    expect(remoteOnly.get('city')).toBeNull()
    expect(remoteOnly.get('title')).toBe('Software Engineer kubernetes')
    expect(remoteOnly.get('remote')).toBe('remote')
    expect(remoteOnly.has('q')).toBe(false)
    const catalog = buildPublicJobsSearchParams({
      keywords: '',
      q: 'Python Engineer',
      location: '',
      country: 'US',
      state: 'CA',
      remote: 'any',
      employmentType: 'any',
      experienceLevel: 'Senior',
      datePostedDays: 0,
      page: 1,
      pageSize: 25,
    })
    expect(catalog.get('q')).toBe('Python Engineer')
    expect(catalog.get('title')).toBeNull()
    expect(catalog.get('country')).toBe('US')
    expect(catalog.get('state')).toBe('CA')
    expect(catalog.get('seniority')).toBe('Senior')
    expect(catalog.has('posted_after')).toBe(false)
  })

  it('leaves unavailable Job Opportunities fields as null', () => {
    const job = normalizeJobOpportunitiesJob({
      id: 'abc',
      title: 'Python Engineer',
      company: 'Example Corp',
    })
    expect(job?.location).toBeNull()
    expect(job?.description).toBeNull()
    expect(job?.jobUrl).toBeNull()
    expect(job?.postedAt).toBeNull()
    expect(job?.salaryMin).toBeNull()
    expect(job?.salaryMax).toBeNull()
    expect(job?.salaryCurrency).toBeNull()
    expect(job?.employmentType).toBeNull()
    expect(job?.seniority).toBeNull()
    expect(job?.source).toBe('Job Opportunities API')
    expect(job?.rawMetadata.listingSource).toBeNull()
    expect(job?.rawMetadata.status).toBeNull()
  })

  it('preserves freshness metadata from the public listing', () => {
    const job = normalizeJobOpportunitiesJob(jobOpportunitiesPayload.data[0])
    expect(job?.postedAt).toBe('2026-09-17T04:07:29.000Z')
    expect(job?.lastVerifiedAt).toBe('2026-09-17T05:47:03.000Z')
    expect(job?.rawMetadata.firstSeenAt).toBe('2026-09-17T04:10:36.000Z')
    expect(job?.rawMetadata.status).toBe('live')
    expect(job?.rawMetadata.slug).toBe('java-software-engineer-ffd759ce')
    expect(job?.rawMetadata.country).toBe('US')
  })

  it('does not merge different Job Opportunities listings', () => {
    const first = normalizeJobOpportunitiesJob(jobOpportunitiesPayload.data[0])!
    const second = normalizeJobOpportunitiesJob({
      ...jobOpportunitiesPayload.data[0],
      id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      slug: 'python-engineer-aaaaaaaa',
      title: 'Python Engineer',
      apply_url: 'https://jobs.example.com/python',
    })!
    const merged = deduplicateJobs([first, second, first])
    expect(merged).toHaveLength(2)
    expect(merged.map((job) => job.providerJobId).sort()).toEqual([
      'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      'ffd759ce-b1fa-4ace-a823-bb0d0595e4ae',
    ])
  })

  it('parses USAJOBS jobs and keeps the official URL', () => {
    const job = normalizeUsaJobsJob(usaPayload.SearchResult.SearchResultItems[0])
    expect(job?.provider).toBe('usajobs')
    expect(job?.providerJobId).toBe('800001')
    expect(job?.company).toBe('Department of Commerce')
    expect(job?.jobUrl).toContain('usajobs.gov')
    expect(job?.description).toMatch(/Java/)
    expect(job?.salaryMin).toBe(110000)
    expect(job?.salaryCurrency).toBe('USD')
    expect(normalizeUsaJobsJob({})).toBeNull()
    expect(
      normalizeUsaJobsJob({
        MatchedObjectDescriptor: { PositionTitle: 'Analyst' },
      })?.salaryCurrency,
    ).toBeNull()
  })

  it('builds stable identity keys and salary ranges', () => {
    expect(identityKey({ provider: 'jooble', providerJobId: '111', company: 'A', title: 'B', location: 'C', jobUrl: null })).toBe(
      'jooble:111',
    )
    expect(fingerprint({ company: 'Acme', title: 'Engineer', location: 'Austin, TX', jobUrl: 'https://jobs.example.com/a?utm_source=x' })).toMatch(/^url:/)
    expect(stableJobId('jooble:111', 'user-1')).not.toBe(stableJobId('jooble:111', 'user-2'))
    expect(parseSalary('80,000 - 90,000 USD')).toEqual({ min: 80000, max: 90000, currency: 'USD' })
    expect(parseSalary('')).toEqual({ min: null, max: null, currency: null })
  })

  it('deduplicates the same listing from two providers by canonical URL', () => {
    const first = normalizeJoobleJob({
      id: 1,
      title: 'Java Software Engineer',
      company: 'Company A',
      location: 'Austin, TX',
      link: 'https://jobs.example.com/java?utm_campaign=feed',
      snippet: 'Short',
    })!
    const second = normalizeUsaJobsJob({
      MatchedObjectId: '9',
      MatchedObjectDescriptor: {
        PositionTitle: 'Java Software Engineer',
        OrganizationName: 'Company A',
        PositionLocationDisplay: 'Austin, TX',
        PositionURI: 'https://jobs.example.com/java',
        QualificationSummary: 'Much longer Java description for scoring.',
      },
    })!
    const merged = deduplicateJobs([first, second])
    expect(merged).toHaveLength(1)
    expect(merged[0].description).toMatch(/longer Java/)
    expect(merged[0].rawMetadata.sources).toEqual(expect.arrayContaining(['USAJOBS', 'jooble']))
  })
})

describe('discover aggregation', () => {
  it('aggregates both providers, labels sources, and scores with the Match Engine', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('jooble.org')) return jsonResponse(jooblePayload)
      if (url.includes('usajobs.gov')) return jsonResponse(usaPayload)
      if (url.includes('jobopportunitiesapi.org')) return jsonResponse(jobOpportunitiesPayload)
      return jsonResponse({}, 404)
    })
    const result = await discoverJobs(
      config,
      {
        roles: ['Java Software Engineer'],
        location: 'United States',
        remote: 'any',
        employmentType: 'any',
        experienceLevel: 'any',
        keywords: [],
        datePostedDays: 30,
        page: 1,
        pageSize: 25,
        minMatchScore: null,
        providers: [],
        resumeText: JAVA_RESUME_TEXT,
        persist: false,
      },
      fetchImpl,
    )
    expect(result.jobs.length).toBeGreaterThanOrEqual(2)
    expect(result.jobs.every((job) => job.demo === false)).toBe(true)
    expect(result.jobs.some((job) => job.provider === 'jooble')).toBe(true)
    expect(result.jobs.some((job) => job.provider === 'usajobs')).toBe(true)
    expect(result.jobs.find((job) => job.provider === 'jooble')?.matchScore).toBeGreaterThan(0)
    expect(result.providers.map((item) => item.name)).toEqual([
      'job-opportunities',
      'jooble',
      'usajobs',
      'greenhouse',
      'lever',
      'ashby',
    ])
    expect(result.providers.find((item) => item.name === 'jooble')?.connectionLabel).toBe('Connected')
    expect(result.providers.find((item) => item.name === 'usajobs')?.connectionLabel).toBe('Connected')
    expect(result.providers.find((item) => item.name === 'job-opportunities')?.connectionLabel).toBe('Connected')
    expect(result.jobs.some((job) => job.provider === 'job-opportunities')).toBe(true)
    expect(result.jobs.find((job) => job.provider === 'job-opportunities')?.liveDemoProvider).toBe(false)
  })

  it('keeps Jooble results when USAJOBS fails', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('jooble.org')) return jsonResponse(jooblePayload)
      return jsonResponse({ error: 'down' }, 503)
    })
    const result = await discoverJobs(
      config,
      {
        roles: ['Java Software Engineer'],
        location: 'United States',
        remote: 'any',
        employmentType: 'any',
        experienceLevel: 'any',
        keywords: [],
        datePostedDays: 30,
        page: 1,
        pageSize: 25,
        minMatchScore: null,
        providers: [],
        persist: false,
      },
      fetchImpl,
    )
    expect(result.jobs.some((job) => job.provider === 'jooble')).toBe(true)
    expect(result.warnings.some((item) => item.provider === 'usajobs')).toBe(true)
  })

  it('marks a missing API key as unavailable instead of throwing', async () => {
    const result = await discoverJobs(
      { ...config, joobleApiKey: '', usajobsApiKey: '', jobOpportunitiesEnabled: false },
      {
        roles: ['Java'],
        location: 'United States',
        remote: 'any',
        employmentType: 'any',
        experienceLevel: 'any',
        keywords: [],
        datePostedDays: 30,
        page: 1,
        pageSize: 10,
        minMatchScore: null,
        providers: [],
        persist: false,
      },
    )
    expect(result.jobs).toEqual([])
    expect(result.warnings.map((item) => item.code)).toEqual(expect.arrayContaining(['missing_key']))
    expect(result.providers.find((item) => item.name === 'jooble')?.available).toBe(false)
    expect(result.providers.find((item) => item.name === 'usajobs')?.available).toBe(false)
    expect(result.providers.find((item) => item.name === 'job-opportunities')?.connectionLabel).toBe('Disabled')
  })

  it('aggregates Job Opportunities API results without requiring a key', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toContain('api.jobopportunitiesapi.org/public/jobs')
      expect(url).toContain('country=US')
      expect(url).toContain('title=Java')
      expect(url).not.toContain('api_key')
      expect(url).not.toContain('Authorization')
      return jsonResponse(jobOpportunitiesPayload)
    })
    const result = await discoverJobs(
      { ...config, joobleEnabled: false, usajobsEnabled: false },
      {
        roles: ['Java Software Engineer'],
        location: 'United States',
        remote: 'any',
        employmentType: 'any',
        experienceLevel: 'any',
        keywords: [],
        datePostedDays: 30,
        page: 1,
        pageSize: 10,
        minMatchScore: null,
        providers: ['job-opportunities'],
        resumeText: JAVA_RESUME_TEXT,
        persist: false,
      },
      fetchImpl,
    )
    expect(result.jobs[0]?.provider).toBe('job-opportunities')
    expect(result.jobs[0]?.jobUrl).toMatch(/^https:\/\//)
    expect(result.jobs[0]?.matchScore).toBeGreaterThan(0)
    expect(result.jobs[0]?.source).toBe('Job Opportunities API')
    expect(result.providers.find((item) => item.name === 'job-opportunities')?.connectionLabel).toBe('Connected')
  })

  it('does not page the keyless Job Opportunities surface past the first request', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(jobOpportunitiesPayload))
    const result = await discoverJobs(
      { ...config, joobleEnabled: false, usajobsEnabled: false },
      {
        roles: ['Java Software Engineer'],
        location: 'United States',
        remote: 'any',
        employmentType: 'any',
        experienceLevel: 'any',
        keywords: [],
        datePostedDays: 30,
        page: 2,
        pageSize: 10,
        minMatchScore: null,
        providers: ['job-opportunities'],
        persist: false,
      },
      fetchImpl,
    )
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(result.jobs).toEqual([])
    expect(result.hasMore).toBe(false)
  })

  it('returns a provider warning instead of crashing when Job Opportunities API fails', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'down' }, 503))
    const result = await discoverJobs(
      { ...config, joobleEnabled: false, usajobsEnabled: false },
      {
        roles: ['Java Software Engineer'],
        location: 'United States',
        remote: 'any',
        employmentType: 'any',
        experienceLevel: 'any',
        keywords: [],
        datePostedDays: 30,
        page: 1,
        pageSize: 10,
        minMatchScore: null,
        providers: ['job-opportunities'],
        persist: false,
      },
      fetchImpl,
    )
    expect(result.jobs).toEqual([])
    expect(result.warnings[0]?.message).toBe('Live job source temporarily unavailable.')
  })

  it('returns a malformed warning when the Job Opportunities envelope is unexpected', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ unexpected: true }))
    const result = await discoverJobs(
      { ...config, joobleEnabled: false, usajobsEnabled: false },
      {
        roles: ['Cybersecurity Analyst'],
        location: 'United States',
        remote: 'any',
        employmentType: 'any',
        experienceLevel: 'any',
        keywords: [],
        datePostedDays: 30,
        page: 1,
        pageSize: 10,
        minMatchScore: null,
        providers: ['job-opportunities'],
        persist: false,
      },
      fetchImpl,
    )
    expect(result.jobs).toEqual([])
    expect(result.warnings[0]?.code).toBe('malformed')
    expect(result.warnings[0]?.message).toBe('Live job source temporarily unavailable.')
  })

  it('returns a rate-limit warning for HTTP 429', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'slow down' }, 429))
    const result = await discoverJobs(
      { ...config, joobleEnabled: false, usajobsEnabled: false },
      {
        roles: ['Software Engineer'],
        location: 'United States',
        remote: 'any',
        employmentType: 'any',
        experienceLevel: 'any',
        keywords: [],
        datePostedDays: 30,
        page: 1,
        pageSize: 10,
        minMatchScore: null,
        providers: ['job-opportunities'],
        persist: false,
      },
      fetchImpl,
    )
    expect(result.warnings[0]?.code).toBe('rate_limited')
    expect(result.warnings[0]?.message).toBe('Live job source temporarily unavailable.')
  })

  it('returns a timeout warning when the provider aborts', async () => {
    const fetchImpl = vi.fn(async () => {
      const error = new Error('aborted')
      error.name = 'AbortError'
      throw error
    })
    const result = await discoverJobs(
      { ...config, usajobsEnabled: false },
      {
        roles: ['Java'],
        location: 'Austin, TX',
        remote: 'any',
        employmentType: 'any',
        experienceLevel: 'any',
        keywords: [],
        datePostedDays: 30,
        page: 1,
        pageSize: 10,
        minMatchScore: null,
        providers: ['jooble'],
        persist: false,
      },
      fetchImpl,
    )
    expect(result.warnings[0]?.code).toBe('timeout')
  })

  it('filters by minimum match without calling an LLM', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('jooble.org')) return jsonResponse(jooblePayload)
      return jsonResponse({ SearchResult: { SearchResultItems: [], SearchResultCountAll: 0 } })
    })
    const result = await discoverJobs(
      config,
      {
        roles: ['Java Software Engineer'],
        location: 'Austin, TX',
        remote: 'any',
        employmentType: 'any',
        experienceLevel: 'any',
        keywords: [],
        datePostedDays: 30,
        page: 1,
        pageSize: 25,
        minMatchScore: 99,
        providers: [],
        resumeText: JAVA_RESUME_TEXT,
        persist: false,
      },
      fetchImpl,
    )
    expect(result.jobs.every((job) => job.matchScore == null || job.matchScore >= 99)).toBe(true)
  })

  it('exposes pagination metadata from providers', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('jooble.org')) return jsonResponse({ totalCount: 80, jobs: [jooblePayload.jobs[0]] })
      return jsonResponse(usaPayload)
    })
    const result = await discoverJobs(
      config,
      {
        roles: ['Java'],
        location: 'United States',
        remote: 'any',
        employmentType: 'any',
        experienceLevel: 'any',
        keywords: [],
        datePostedDays: 30,
        page: 1,
        pageSize: 1,
        minMatchScore: null,
        providers: [],
        persist: false,
      },
      fetchImpl,
    )
    expect(result.page).toBe(1)
    expect(result.pageSize).toBe(1)
    expect(result.hasMore).toBe(true)
    expect(result.total).toBeGreaterThan(1)
  })
})

describe('discover HTTP API', () => {
  it('returns live-shaped results and never sample jobs when keyed providers are missing', async () => {
    const app = createApp({
      config: { ...config, joobleApiKey: '', usajobsApiKey: '', usajobsUserAgentEmail: '', jobOpportunitiesEnabled: false },
    })
    const response = await request(app).post('/api/jobs/discover').send({
      roles: ['Java Software Engineer'],
      location: 'United States',
      datePostedDays: 30,
    })
    expect(response.status).toBe(200)
    expect(response.body.jobs).toEqual([])
    expect(response.body.demo).toBe(false)
    expect(response.body.warnings.length).toBeGreaterThan(0)
  })

  it('discovers live Job Opportunities jobs over HTTP without calling the network', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toContain('country=US')
      expect(url).toContain('title=Java')
      return jsonResponse(jobOpportunitiesPayload)
    })
    const app = createApp({
      config: { ...config, joobleEnabled: false, usajobsEnabled: false },
      fetchImpl,
    })
    const response = await request(app).post('/api/jobs/discover').send({
      roles: ['Java Software Engineer'],
      location: 'United States',
      pageSize: 10,
      persist: false,
      resumeText: JAVA_RESUME_TEXT,
    })
    expect(response.status).toBe(200)
    expect(response.body.demo).toBe(false)
    expect(response.body.jobs[0]?.source).toBe('Job Opportunities API')
    expect(response.body.jobs[0]?.provider).toBe('job-opportunities')
    expect(response.body.jobs[0]?.matchScore).toBeGreaterThan(0)
    expect(fetchImpl).toHaveBeenCalled()
  })

  it('hydrates a full Job Opportunities listing without creating an application', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/public/jobs/ffd759ce')) return jsonResponse(jobOpportunitiesDetail)
      return jsonResponse(jobOpportunitiesPayload)
    })
    const job = await fetchProviderJob(config, 'job-opportunities', 'ffd759ce-b1fa-4ace-a823-bb0d0595e4ae', fetchImpl)
    expect(job?.description).toMatch(/Spring Boot/)
    expect(job?.rawMetadata.status).toBe('live')
    expect(job?.title).toBe('Java Software Engineer')
    expect(job?.company).toBe('Teledyne FLIR')
    expect(job?.jobUrl).toContain('myworkdayjobs.com')
    const app = createApp({ config, fetchImpl })
    const live = await request(app).get(
      '/api/jobs/live/job-opportunities/ffd759ce-b1fa-4ace-a823-bb0d0595e4ae',
    )
    expect(live.status).toBe(200)
    expect(live.body.description).toMatch(/Spring Boot/)
    const save = await request(app).post('/api/jobs/save').send({
      userId: '11111111-1111-4111-8111-111111111111',
      job,
    })
    expect(save.status).toBe(200)
    expect(save.body.applicationCreated).toBe(false)
  })

  it('returns the live-source unavailable message when a full job cannot be fetched', async () => {
    const app = createApp({
      config,
      fetchImpl: vi.fn(async () => jsonResponse({ error: 'down' }, 503)),
    })
    const response = await request(app).get('/api/jobs/live/job-opportunities/missing-id')
    expect(response.status).toBe(404)
    expect(response.body.error).toBe('Live job source temporarily unavailable.')
  })

  it('saves a job without creating an application', async () => {
    const app = createApp({ config })
    const job = normalizeJoobleJob(jooblePayload.jobs[0])
    const response = await request(app).post('/api/jobs/save').send({
      userId: '11111111-1111-4111-8111-111111111111',
      job,
    })
    expect(response.status).toBe(200)
    expect(response.body.applicationCreated).toBe(false)
    expect(response.body.jobId).toBeTruthy()
  })

  it('rejects a duplicate-looking save payload that is not a job object', async () => {
    const app = createApp({ config })
    const response = await request(app).post('/api/jobs/save').send({ userId: 'x', job: 'nope' })
    expect(response.status).toBe(400)
  })

  it('parses discover filters with defaults', () => {
    const parsed = parseDiscoverRequest({ roles: ['Java'], page: 2, pageSize: 10 })
    expect(parsed.remote).toBe('any')
    expect(parsed.page).toBe(2)
    expect(parsed.datePostedDays).toBe(30)
  })

  it('maps GET /api/jobs query filters onto official Job Opportunities parameters', () => {
    const parsed = parseLiveJobsQuery({
      q: 'Cybersecurity Analyst',
      country: 'us',
      state: 'tx',
      remote: 'on_site',
      employment_type: 'Full-time',
      seniority: 'Mid',
      limit: 80,
      page: 1,
    })
    expect(parsed.q).toBe('Cybersecurity Analyst')
    expect(parsed.country).toBe('US')
    expect(parsed.state).toBe('TX')
    expect(parsed.remote).toBe('onsite')
    expect(parsed.employmentType).toBe('full-time')
    expect(parsed.seniority).toBe('Mid')
    expect(parsed.limit).toBe(50)
    expect(parsed.sort).toBe('match')
    expect(parsed.jobType).toBe('all')
    expect(parseLiveJobsQuery({ jobType: 'c2c' }).jobType).toBe('c2c')
  })
})

describe('GET /api/jobs live catalog', () => {
  it('normalizes live jobs into the internal catalog model', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toContain('api.jobopportunitiesapi.org/public/jobs')
      expect(url).toContain('country=US')
      expect(url).toContain('state=TX')
      expect(url).toContain('q=Java')
      expect(url).toContain('remote=remote')
      expect(url).toContain('employment_type=Full-time')
      expect(url).toContain('seniority=Senior')
      expect(url).toContain('limit=10')
      expect(url).not.toContain('api_key')
      return jsonResponse({
        data: [jobOpportunitiesPayload.data[0], jobOpportunitiesPayload.data[0]],
      })
    })
    const app = createApp({
      config: { ...config, joobleEnabled: false, usajobsEnabled: false },
      fetchImpl,
    })
    const response = await request(app).get('/api/jobs').query({
      q: 'Java Software Engineer',
      country: 'US',
      state: 'TX',
      remote: 'remote',
      employment_type: 'full-time',
      seniority: 'Senior',
      limit: 10,
    })
    expect(response.status).toBe(200)
    expect(response.body.jobs).toHaveLength(1)
    expect(response.body.jobs[0].title).toBe('Java Software Engineer')
    expect(response.body.jobs[0].company).toBe('Teledyne FLIR')
    expect(response.body.jobs[0].url).toContain('myworkdayjobs.com')
    expect(response.body.jobs[0].jobUrl).toBe(response.body.jobs[0].url)
    expect(response.body.jobs[0].source).toBe('Job Opportunities API')
    expect(response.body.jobs[0].sourceJobId).toBe('ffd759ce-b1fa-4ace-a823-bb0d0595e4ae')
    expect(response.body.jobs[0].fetchedAt).toBeTruthy()
    expect(response.body.jobs[0].seniority).toBe('Senior')
    expect(response.body.jobs[0].match.score).toBeNull()
    expect(response.body.source).toBe('Job Opportunities API')
    const catalog = toLiveJob(normalizeJobOpportunitiesJob(jobOpportunitiesPayload.data[0])!)
    expect(catalog.url).toBe(catalog.jobUrl)
    expect(catalog.sourceJobId).toBe(catalog.providerJobId)
  })

  it('returns an empty list when the provider has no matching rows', async () => {
    const app = createApp({
      config: { ...config, joobleEnabled: false, usajobsEnabled: false },
      fetchImpl: vi.fn(async () => jsonResponse({ data: [] })),
    })
    const response = await request(app).get('/api/jobs').query({ q: 'no-such-role', country: 'US' })
    expect(response.status).toBe(200)
    expect(response.body.jobs).toEqual([])
    expect(response.body.warning).toBeUndefined()
  })

  it('returns a provider warning instead of crashing when the live catalog fails', async () => {
    const app = createApp({
      config: { ...config, joobleEnabled: false, usajobsEnabled: false },
      fetchImpl: vi.fn(async () => jsonResponse({ error: 'down' }, 503)),
    })
    const response = await request(app).get('/api/jobs').query({ country: 'US' })
    expect(response.status).toBe(200)
    expect(response.body.jobs).toEqual([])
    expect(response.body.warning.message).toBe('Live job source temporarily unavailable.')
  })

  it('scores live jobs against the selected resume and sorts by match score', async () => {
    const weakJob = {
      ...jobOpportunitiesPayload.data[0],
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      slug: 'kubernetes-administrator',
      title: 'Kubernetes Administrator',
      company: 'Other Corp',
      description: 'Required qualifications: Kubernetes, Terraform, Go, Kafka. No Java.',
      apply_url: 'https://jobs.example.com/k8s',
      posted_at: '2026-09-18T00:00:00Z',
    }
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        data: [weakJob, jobOpportunitiesPayload.data[0]],
      }),
    )
    const app = createApp({
      config: { ...config, joobleEnabled: false, usajobsEnabled: false },
      fetchImpl,
    })
    const response = await request(app).post('/api/jobs').send({
      q: 'Engineer',
      country: 'US',
      sort: 'match',
      resumeText: JAVA_RESUME_TEXT,
      resumeVersionId: 'resume-1',
    })
    expect(response.status).toBe(200)
    expect(response.body.jobs).toHaveLength(2)
    expect(response.body.jobs[0].title).toBe('Java Software Engineer')
    expect(response.body.jobs[0].match.score).toBeGreaterThan(response.body.jobs[1].match.score)
    expect(response.body.jobs[0].match.matchedSkills.join(' ')).toMatch(/Java/i)
    expect(response.body.jobs[0].match.resumeVersionId).toBe('resume-1')
    expect(response.body.jobs[0].url).toContain('myworkdayjobs.com')
    const ranked = sortLiveJobs(response.body.jobs, {
      q: 'Engineer',
      country: 'US',
      state: '',
      remote: 'any',
      employmentType: 'any',
      seniority: '',
      page: 1,
      limit: 25,
      sort: 'match',
    })
    expect(ranked[0].match.score ?? -1).toBeGreaterThanOrEqual(ranked[1].match.score ?? -1)
  })

  it('previews current and tailored scores without submitting an application', async () => {
    const job = normalizeJobOpportunitiesJob(jobOpportunitiesPayload.data[0])
    const app = createApp({ config })
    const response = await request(app).post('/api/jobs/preview').send({
      resumeText: JAVA_RESUME_TEXT,
      resumeVersionId: 'resume-1',
      job,
    })
    expect(response.status).toBe(200)
    expect(response.body.current.score).toEqual(expect.any(Number))
    expect(response.body.tailored.score).toEqual(expect.any(Number))
    expect(response.body.improvement).toEqual(expect.any(Number))
    expect(response.body.stillMissing).toEqual(expect.any(Array))
  })

  it('saves a live job with title, employer URL, resume version, and match score', async () => {
    const app = createApp({ config })
    const job = normalizeJobOpportunitiesJob(jobOpportunitiesPayload.data[0])
    const response = await request(app).post('/api/jobs/save').send({
      userId: '11111111-1111-4111-8111-111111111111',
      job: {
        ...job,
        matchScore: 82,
        resumeVersionId: 'resume-1',
        createdAt: '2026-09-17T00:00:00.000Z',
      },
    })
    expect(response.status).toBe(200)
    expect(response.body.applicationCreated).toBe(false)
    const parsed = parseNormalizedJob({
      ...job,
      matchScore: 82,
      resumeVersionId: 'resume-1',
      createdAt: '2026-09-17T00:00:00.000Z',
    })
    expect(parsed.jobUrl).toContain('myworkdayjobs.com')
    expect(parsed.rawMetadata.matchScore).toBe(82)
    expect(parsed.rawMetadata.resumeVersionId).toBe('resume-1')
    expect(parsed.rawMetadata.createdAt).toBe('2026-09-17T00:00:00.000Z')
  })

  it('classifies C2C locally and returns only confirmed jobs for the C2C filter', async () => {
    const confirmed = {
      ...jobOpportunitiesPayload.data[0],
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      title: 'Java Engineer C2C',
      description: 'Corp to Corp Java Spring Boot. Rate is $60/hr on C2C.',
      employment_type: 'Contract',
      apply_url: 'https://jobs.example.com/c2c-java',
    }
    const blocked = {
      ...jobOpportunitiesPayload.data[0],
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      title: 'Java Engineer W2',
      description: 'No C2C. W2 only.',
      apply_url: 'https://jobs.example.com/w2-java',
    }
    const generic = {
      ...jobOpportunitiesPayload.data[0],
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      title: 'Java Contract',
      description: '1099 contract position.',
      employment_type: 'Contract',
      apply_url: 'https://jobs.example.com/1099-java',
    }
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toMatch(/C2C|corp\+to\+corp|corp%20to%20corp/i)
      expect(url).toContain('employment_type=Contract')
      return jsonResponse({ data: [confirmed, blocked, generic] })
    })
    const app = createApp({
      config: { ...config, joobleEnabled: false, usajobsEnabled: false },
      fetchImpl,
    })
    const response = await request(app).get('/api/jobs').query({
      q: 'Java',
      country: 'US',
      jobType: 'c2c',
    })
    expect(response.status).toBe(200)
    expect(fetchImpl.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(response.body.jobs).toHaveLength(1)
    expect(response.body.jobs[0].title).toBe('Java Engineer C2C')
    expect(response.body.jobs[0].c2cStatus).toBe('confirmed')
    expect(response.body.jobs[0].c2cEvidence.length).toBeGreaterThan(0)
  })
})
