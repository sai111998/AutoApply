import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerConfig } from '../config'
import { JobAggregator } from './aggregator'
import { clearHttpCaches } from './http'
import { listLiveJobs } from './list'
import { parseLiveJobsQuery } from './parse'
import { createAshbyProvider } from './providers/ashby'
import { createGreenhouseProvider } from './providers/greenhouse'
import { createJobOpportunitiesProvider } from './providers/job-opportunities'
import { createJsearchProvider } from './providers/jsearch'
import { createLeverProvider } from './providers/lever'
import type { JobProvider, ProviderSearchParams } from './types'

const API_KEY = 'integration-rapidapi-key'

const greenhouseJob = {
  id: 555,
  title: 'Backend Engineer',
  absolute_url: 'https://boards.greenhouse.io/acme/jobs/555',
  updated_at: '2026-09-20T12:00:00.000Z',
  location: { name: 'Austin, TX' },
  content: '<p>Build backend engineer services for Acme robots in Austin.</p>',
}

const leverJob = {
  id: 'lev-1',
  text: 'Frontend Engineer',
  categories: { location: 'Remote', commitment: 'Full-time' },
  descriptionPlain: 'Frontend engineer building React dashboards.',
  hostedUrl: 'https://jobs.lever.co/acme/lev-1',
  applyUrl: 'https://jobs.lever.co/acme/lev-1/apply',
  createdAt: Date.parse('2026-09-18T00:00:00.000Z'),
}

const ashbyJob = {
  id: 'ash-9',
  title: 'Platform Engineer',
  locationName: 'New York, NY',
  employmentType: 'FullTime',
  isRemote: false,
  jobUrl: 'https://jobs.ashbyhq.com/acme/ash-9',
  applyUrl: 'https://jobs.ashbyhq.com/acme/ash-9/application',
  publishedDate: '2026-09-19T00:00:00.000Z',
  descriptionPlain: 'Platform engineer owning Kubernetes for Acme in New York.',
}

const joaJob = {
  id: 'joa-77',
  title: 'Data Engineer',
  company: 'Umbrella Analytics',
  location: 'Chicago, IL',
  remote: 'on_site',
  employment_type: 'Full-time',
  apply_url: 'https://careers.umbrella.example/jobs/77',
  posted_at: '2026-09-21T00:00:00.000Z',
  description: 'Data engineer building pipelines.',
}

const jsearchJobs = [
  {
    job_id: 'js-greenhouse-twin',
    job_title: 'Backend Engineer',
    employer_name: 'Acme',
    job_publisher: 'LinkedIn',
    job_apply_link: 'https://www.linkedin.com/jobs/view/111',
    job_apply_is_direct: false,
    apply_options: [
      { publisher: 'LinkedIn', apply_link: 'https://www.linkedin.com/jobs/view/111', is_direct: false },
      { publisher: 'Acme', apply_link: 'https://boards.greenhouse.io/acme/jobs/555', is_direct: true },
    ],
    job_description: 'Backend engineer role.',
    job_location: 'Austin, TX',
  },
  {
    job_id: 'js-ashby-twin',
    job_title: 'Platform Engineer',
    employer_name: 'Acme',
    job_publisher: 'Indeed',
    job_apply_link: 'https://www.indeed.com/viewjob?jk=222',
    job_apply_is_direct: false,
    job_description: 'Platform engineer role.',
    job_location: 'New York, NY, US',
  },
  {
    job_id: 'js-workday',
    job_title: 'Site Reliability Engineer',
    employer_name: 'Globex',
    job_publisher: 'Globex Careers',
    job_apply_link: 'https://globex.wd5.myworkdayjobs.com/globex/job/Denver/SRE_R-1',
    job_apply_is_direct: true,
    job_description: 'Site reliability engineer for Globex.',
    job_location: 'Denver, CO',
  },
  {
    job_id: 'js-no-apply',
    job_title: 'QA Engineer',
    employer_name: 'Initech',
    job_publisher: 'Some Board',
    job_apply_link: null,
    job_description: 'QA engineer.',
    job_location: 'Dallas, TX',
  },
]

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function stubFetch(options: { jsearch?: 'ok' | 'error' | 'throw' } = {}) {
  const hosts: string[] = []
  const fetchImpl = vi.fn(async (input: string) => {
    const url = new URL(input)
    hosts.push(url.host)
    if (url.host === 'api.jobopportunitiesapi.org') return jsonResponse({ data: [joaJob] })
    if (url.host === 'boards-api.greenhouse.io') {
      return url.pathname.endsWith('/acme') ? jsonResponse({ name: 'Acme' }) : jsonResponse({ jobs: [greenhouseJob] })
    }
    if (url.host === 'api.lever.co') return jsonResponse([leverJob])
    if (url.host === 'api.ashbyhq.com') return jsonResponse({ jobs: [ashbyJob] })
    if (url.host === 'jsearch.p.rapidapi.com') {
      if (options.jsearch === 'throw') throw new Error('network down')
      if (options.jsearch === 'error') return jsonResponse({ message: 'upstream error' }, 500)
      return jsonResponse({ status: 'OK', data: jsearchJobs })
    }
    return jsonResponse({}, 404)
  })
  return { fetchImpl, hosts }
}

function fiveProviders(fetchImpl: (input: string, init?: RequestInit) => Promise<Response>): JobProvider[] {
  return [
    createJobOpportunitiesProvider({ enabled: true, fetchImpl }),
    createGreenhouseProvider({ enabled: true, boardTokens: ['acme'], fetchImpl }),
    createLeverProvider({ enabled: true, sites: ['acme'], fetchImpl }),
    createAshbyProvider({ enabled: true, boards: ['acme'], fetchImpl }),
    createJsearchProvider({ apiKey: API_KEY, enabled: true, minIntervalMs: 0, fetchImpl }),
  ]
}

const params: ProviderSearchParams = {
  keywords: '',
  q: 'engineer',
  location: '',
  country: 'US',
  remote: 'any',
  employmentType: 'any',
  datePostedDays: 0,
  page: 1,
  pageSize: 25,
}

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
  greenhouseEnabled: true,
  greenhouseBoardTokens: ['acme'],
  leverEnabled: true,
  leverSites: ['acme'],
  ashbyEnabled: true,
  ashbyBoards: ['acme'],
  rapidApiKey: API_KEY,
  jsearchEnabled: true,
  jsearchMaxPages: 1,
}

beforeEach(() => {
  clearHttpCaches()
})

describe('JOA + Greenhouse + Lever + Ashby + JSearch aggregation', () => {
  it('normalizes all five providers and removes cross-provider duplicates', async () => {
    const { fetchImpl } = stubFetch()
    const aggregated = await JobAggregator.aggregate(fiveProviders(fetchImpl), params)
    const byTitle = Object.fromEntries(aggregated.jobs.map((job) => [job.title, job]))
    expect(aggregated.jobs.map((job) => job.title).sort()).toEqual([
      'Backend Engineer',
      'Data Engineer',
      'Frontend Engineer',
      'Platform Engineer',
      'QA Engineer',
      'Site Reliability Engineer',
    ])
    expect(byTitle['Backend Engineer']).toMatchObject({ provider: 'greenhouse', applicationUrl: 'https://boards.greenhouse.io/acme/jobs/555' })
    expect(byTitle['Backend Engineer'].rawMetadata.sources).toEqual(expect.arrayContaining(['jsearch']))
    expect(byTitle['Platform Engineer']).toMatchObject({ provider: 'ashby' })
    expect(byTitle['Platform Engineer'].rawMetadata.sources).toEqual(expect.arrayContaining(['jsearch']))
    expect(byTitle['Site Reliability Engineer']).toMatchObject({
      provider: 'jsearch',
      discoveryProvider: 'jsearch',
      applicationProvider: 'workday',
      applicationCapability: 'unknown',
      applicationUrl: 'https://globex.wd5.myworkdayjobs.com/globex/job/Denver/SRE_R-1',
    })
    expect(byTitle['QA Engineer']).toMatchObject({ provider: 'jsearch', applicationUrl: null, applicationCapability: 'unsupported' })
    expect(byTitle['Data Engineer'].provider).toBe('job-opportunities')
    expect(byTitle['Frontend Engineer'].provider).toBe('lever')
    expect(aggregated.warnings).toEqual([])
    expect(JSON.stringify(aggregated)).not.toContain(API_KEY)
  })

  it('reports per-provider discovery metrics through the Live Jobs path', async () => {
    const { fetchImpl } = stubFetch()
    const result = await listLiveJobs(config, { ...parseLiveJobsQuery({ q: 'engineer' }), includeSynthetic: false }, fetchImpl)
    const jsearch = result.diagnostics?.find((entry) => entry.provider === 'jsearch')
    expect(jsearch).toMatchObject({ raw: 4, normalized: 4, duplicatesRemoved: 2, usableApplicationUrls: 3, deduplicated: 2 })
    for (const provider of ['job-opportunities', 'greenhouse', 'lever', 'ashby']) {
      expect(result.diagnostics?.find((entry) => entry.provider === provider)?.normalized).toBeGreaterThan(0)
    }
    expect(result.jobs.find((job) => job.title === 'QA Engineer')?.applicationUrl).toBeNull()
    expect(result.jobs).toHaveLength(6)
  })

  it.each(['error', 'throw'] as const)('keeps the other providers when JSearch fails (%s)', async (mode) => {
    const { fetchImpl } = stubFetch({ jsearch: mode })
    const aggregated = await JobAggregator.aggregate(fiveProviders(fetchImpl), params)
    expect(aggregated.jobs.map((job) => job.provider).sort()).toEqual(['ashby', 'greenhouse', 'job-opportunities', 'lever'])
    expect(aggregated.warnings).toEqual([expect.objectContaining({ provider: 'jsearch', code: 'unavailable' })])
  })

  it('isolates a provider whose search throws unexpectedly', async () => {
    const { fetchImpl } = stubFetch()
    const throwing = async (): Promise<never> => {
      throw new TypeError('bug in provider')
    }
    const broken: JobProvider = {
      ...createJsearchProvider({ apiKey: API_KEY, enabled: true, minIntervalMs: 0, fetchImpl }),
      search: throwing,
      searchJobs: throwing,
    }
    const providers = [...fiveProviders(fetchImpl).slice(0, 4), broken]
    const aggregated = await JobAggregator.aggregate(providers, params)
    expect(aggregated.jobs.length).toBe(4)
    expect(aggregated.warnings).toEqual([expect.objectContaining({ provider: 'jsearch' })])
  })

  it('skips JSearch entirely when RAPIDAPI_KEY is missing', async () => {
    const { fetchImpl, hosts } = stubFetch()
    const result = await listLiveJobs({ ...config, rapidApiKey: '' }, { ...parseLiveJobsQuery({ q: 'engineer' }), includeSynthetic: false }, fetchImpl)
    expect(hosts).not.toContain('jsearch.p.rapidapi.com')
    expect(result.diagnostics?.some((entry) => entry.provider === 'jsearch')).toBe(false)
    expect(result.warning).toBeUndefined()
    expect(result.jobs.length).toBe(4)
  })
})
