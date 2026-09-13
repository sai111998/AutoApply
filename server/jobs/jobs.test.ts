import { afterEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../app'
import type { ServerConfig } from '../config'
import { clearHttpCaches } from './http'
import { discoverJobs } from './discover'
import { deduplicateJobs } from './deduplicate'
import { fingerprint, identityKey, parseSalary, stableJobId } from './normalize'
import { parseDiscoverRequest } from './parse'
import { normalizeCruciveJob } from './providers/crucive'
import { normalizeJoobleJob } from './providers/jooble'
import { normalizeUsaJobsJob } from './providers/usajobs'
import { JAVA_RESUME_TEXT } from '../tailor/fixtures'
import { CRUCIVE_DEMO_API_KEY, resolveCruciveCredentials } from '../config'

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
  cruciveApiKey: '',
  cruciveEnabled: true,
  cruciveUsingDemoKey: false,
  cruciveApiBaseUrl: 'https://api.crucive.com',
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

const crucivePayload = [
  {
    job_uuid: '1fcbc4f2-04c5-45df-8edf-8435159938ef',
    job_title: 'Java Software Engineer (m/f/d)',
    job_url: 'https://jobs.koerber.com/supplychain/job/Alges-Java-Software-Engineer/1425341933/',
    company_name: 'ASL Analytic Service Laboratory GmbH',
    job_city: 'Algés',
    job_country: 'Portugal',
    first_seen_date: '2026-09-06T13:19:44.602089+00:00',
    accepts_remote: false,
    accepts_hybrid: true,
    employment_type: ['full_time'],
    salary_min: null,
    salary_max: null,
    salary_currency: null,
    job_description_responsibilities: ['Develop Java services for parcel sorting systems.'],
    job_description_requirements: ['Java as your primary programming language.'],
    skill_names: ['Java', 'Kubernetes'],
  },
]

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

  it('parses Crucive jobs and keeps the career-page URL', () => {
    const job = normalizeCruciveJob(crucivePayload[0], true)
    expect(job?.provider).toBe('crucive')
    expect(job?.title).toBe('Java Software Engineer (m/f/d)')
    expect(job?.jobUrl).toContain('jobs.koerber.com')
    expect(job?.description).toMatch(/Java/)
    expect(job?.liveDemoProvider).toBe(true)
    expect(job?.source).toBe('Crucive')
    expect(normalizeCruciveJob({ company_name: 'Nope' })).toBeNull()
    expect(normalizeCruciveJob({ job_title: '***' })).toBeNull()
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
      if (url.includes('crucive.com')) return jsonResponse(crucivePayload)
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
    expect(result.providers.map((item) => item.name)).toEqual(['crucive', 'jooble', 'usajobs'])
    expect(result.providers.find((item) => item.name === 'jooble')?.connectionLabel).toBe('Connected')
    expect(result.providers.find((item) => item.name === 'usajobs')?.connectionLabel).toBe('Connected')
    expect(result.providers.find((item) => item.name === 'crucive')?.connectionLabel).toBe('Not configured')
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
      { ...config, joobleApiKey: '', usajobsApiKey: '' },
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
    expect(result.providers.every((item) => item.available === false)).toBe(true)
    expect(result.providers.find((item) => item.name === 'jooble')?.connectionLabel).toBe('Not configured')
    expect(result.providers.find((item) => item.name === 'usajobs')?.connectionLabel).toBe('Not configured')
    expect(result.providers.find((item) => item.name === 'crucive')?.connectionLabel).toBe('Not configured')
  })

  it('aggregates Crucive demo results without exposing the API key', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain('api.crucive.com/v1/jobs/search')
      expect(String(init?.headers)).not.toMatch(/test-demo-api-key-2026/)
      const headers = new Headers(init?.headers)
      expect(headers.get('X-API-Key')).toBe('crucive-test')
      return jsonResponse(crucivePayload)
    })
    const result = await discoverJobs(
      { ...config, cruciveApiKey: 'crucive-test', cruciveUsingDemoKey: true, joobleEnabled: false, usajobsEnabled: false },
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
        providers: ['crucive'],
        persist: false,
      },
      fetchImpl,
    )
    expect(result.jobs[0]?.provider).toBe('crucive')
    expect(result.jobs[0]?.liveDemoProvider).toBe(true)
    expect(result.jobs[0]?.jobUrl).toMatch(/^https:\/\//)
    expect(result.providers.find((item) => item.name === 'crucive')?.connectionLabel).toBe('Live Demo')
    expect(JSON.stringify(result)).not.toMatch(/crucive-test|test-demo-api-key-2026/)
  })

  it('retries Crucive without a United States filter when that market is empty', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { query?: { bool?: { filter?: unknown[] } } }
      const hasCountry = JSON.stringify(body).includes('United States')
      return jsonResponse(hasCountry ? [] : crucivePayload)
    })
    const result = await discoverJobs(
      { ...config, cruciveApiKey: 'crucive-test', cruciveUsingDemoKey: true, joobleEnabled: false, usajobsEnabled: false },
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
        providers: ['crucive'],
        persist: false,
      },
      fetchImpl,
    )
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(result.jobs).toHaveLength(1)
    expect(result.jobs[0]?.location).toMatch(/Portugal/)
    expect(result.warnings[0]?.message).toMatch(/United States listings/)
  })

  it('does not use the Crucive demo key outside development', () => {
    expect(resolveCruciveCredentials({ NODE_ENV: 'production' }).cruciveApiKey).toBe('')
    expect(resolveCruciveCredentials({ NODE_ENV: 'production', CRUCIVE_API_KEY: CRUCIVE_DEMO_API_KEY }).cruciveApiKey).toBe('')
    expect(resolveCruciveCredentials({ NODE_ENV: 'development' }).cruciveUsingDemoKey).toBe(true)
    expect(resolveCruciveCredentials({ NODE_ENV: 'development' }).cruciveApiKey).toBe(CRUCIVE_DEMO_API_KEY)
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
  it('returns live-shaped results and never sample jobs when keys are missing', async () => {
    const app = createApp({ config: { ...config, joobleApiKey: '', usajobsApiKey: '', usajobsUserAgentEmail: '' } })
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
})
