import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getServerConfig } from '../../config'
import { annotateCanonicalJob } from '../aggregator'
import { clearHttpCaches } from '../http'
import { providerStatuses } from '../provider'
import type { ProviderSearchParams } from '../types'
import {
  buildJsearchSearchParams,
  createJsearchProvider,
  jsearchDatePosted,
  jsearchFromConfig,
  normalizeJsearchJob,
  resolveJsearchApplicationUrl,
} from './jsearch'

const API_KEY = 'test-rapidapi-key-123'

const jsearchLinkedInJob = {
  job_id: 'JsAbC123xyz==',
  job_title: 'Backend Engineer',
  employer_name: 'Acme Robotics',
  employer_website: 'https://acme.example',
  job_publisher: 'LinkedIn',
  job_employment_type: 'FULLTIME',
  job_apply_link: 'https://www.linkedin.com/jobs/view/123?utm_source=google_jobs_apply&utm_medium=organic',
  job_apply_is_direct: false,
  apply_options: [
    { publisher: 'LinkedIn', apply_link: 'https://www.linkedin.com/jobs/view/123', is_direct: false },
    { publisher: 'Acme Careers', apply_link: 'https://boards.greenhouse.io/acme/jobs/555', is_direct: true },
  ],
  job_description: 'Build distributed systems.\n\nRequirements: Go and Kubernetes.',
  job_is_remote: false,
  job_posted_at_datetime_utc: '2026-09-20T10:00:00.000Z',
  job_city: 'Austin',
  job_state: 'TX',
  job_country: 'US',
  job_min_salary: 150000,
  job_max_salary: 180000,
  job_salary_currency: 'USD',
  job_salary_period: 'YEAR',
  job_google_link: 'https://www.google.com/search?q=jobs#vhid=abc',
}

function params(overrides: Partial<ProviderSearchParams> = {}): ProviderSearchParams {
  return {
    keywords: '',
    q: 'backend engineer',
    location: 'Austin, TX',
    country: 'US',
    remote: 'any',
    employmentType: 'any',
    datePostedDays: 0,
    page: 1,
    pageSize: 25,
    ...overrides,
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function recordingFetch(respond: (url: URL) => Response | Promise<Response>) {
  const calls: Array<{ url: URL; headers: Record<string, string> }> = []
  const fetchImpl = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input)
    calls.push({ url, headers: Object.fromEntries(new Headers(init?.headers).entries()) })
    return respond(url)
  })
  return { fetchImpl, calls }
}

function provider(fetchImpl: (input: string, init?: RequestInit) => Promise<Response>, overrides: Partial<Parameters<typeof createJsearchProvider>[0]> = {}) {
  return createJsearchProvider({ apiKey: API_KEY, enabled: true, minIntervalMs: 0, fetchImpl, ...overrides })
}

beforeEach(() => {
  clearHttpCaches()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('JSearch normalization', () => {
  it('maps a JSearch result into the internal Job model', () => {
    const job = normalizeJsearchJob(jsearchLinkedInJob)
    expect(job).toMatchObject({
      provider: 'jsearch',
      discoveryProvider: 'jsearch',
      providerJobId: 'JsAbC123xyz==',
      title: 'Backend Engineer',
      company: 'Acme Robotics',
      location: 'Austin, TX, US',
      description: 'Build distributed systems.\n\nRequirements: Go and Kubernetes.',
      applicationUrl: 'https://boards.greenhouse.io/acme/jobs/555',
      sourceUrl: 'https://www.linkedin.com/jobs/view/123',
      jobUrl: 'https://www.linkedin.com/jobs/view/123',
      postedAt: '2026-09-20T10:00:00.000Z',
      employmentType: 'Full-time',
      remote: false,
      salaryMin: 150000,
      salaryMax: 180000,
      salaryCurrency: 'USD',
      source: 'JSearch',
    })
    expect(job?.rawMetadata).toMatchObject({
      provider: 'jsearch',
      publisher: 'LinkedIn',
      applyIsDirect: false,
      salaryPeriod: 'YEAR',
      applyOptions: [
        { publisher: 'LinkedIn', applyLink: 'https://www.linkedin.com/jobs/view/123', isDirect: false },
        { publisher: 'Acme Careers', applyLink: 'https://boards.greenhouse.io/acme/jobs/555', isDirect: true },
      ],
    })
  })

  it('keeps the provider job id exactly and derives a stable id and identity', () => {
    const first = normalizeJsearchJob(jsearchLinkedInJob)
    const second = normalizeJsearchJob({ ...jsearchLinkedInJob, job_title: 'Backend Engineer II' })
    expect(first?.providerJobId).toBe('JsAbC123xyz==')
    expect(first?.identityKey).toMatch(/^jsearch:/)
    expect(first?.id).toBe(second?.id)
    expect(first?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('handles missing and alternate fields without inventing values', () => {
    expect(normalizeJsearchJob(null)).toBeNull()
    expect(normalizeJsearchJob([jsearchLinkedInJob])).toBeNull()
    expect(normalizeJsearchJob({ ...jsearchLinkedInJob, job_id: '' })).toBeNull()
    expect(normalizeJsearchJob({ ...jsearchLinkedInJob, job_title: '   ' })).toBeNull()
    const sparse = normalizeJsearchJob({
      job_id: 'sparse-1',
      job_title: 'Data Analyst',
      job_location: 'Remote',
      job_is_remote: true,
      job_employment_types: ['CONTRACTOR'],
      job_posted_at_timestamp: 1_758_000_000,
    })
    expect(sparse).toMatchObject({
      company: '',
      location: 'Remote',
      remote: true,
      workArrangement: 'remote',
      employmentType: 'Contract',
      description: null,
      applicationUrl: null,
      sourceUrl: null,
      salaryMin: null,
      postedAt: new Date(1_758_000_000 * 1000).toISOString(),
    })
  })
})

describe('JSearch application URL', () => {
  it('prefers a direct employer apply link over a job-board link', () => {
    expect(resolveJsearchApplicationUrl(jsearchLinkedInJob)).toBe('https://boards.greenhouse.io/acme/jobs/555')
    expect(
      resolveJsearchApplicationUrl({ ...jsearchLinkedInJob, job_apply_link: 'https://acme.wd5.myworkdayjobs.com/acme/job/1', job_apply_is_direct: true }),
    ).toBe('https://acme.wd5.myworkdayjobs.com/acme/job/1')
  })

  it('falls back to the exposed apply link, then to the first apply option', () => {
    expect(resolveJsearchApplicationUrl({ ...jsearchLinkedInJob, apply_options: [] })).toBe('https://www.linkedin.com/jobs/view/123')
    expect(
      resolveJsearchApplicationUrl({
        job_apply_link: null,
        apply_options: [{ publisher: 'Indeed', apply_link: 'https://www.indeed.com/viewjob?jk=abc', is_direct: false }],
      }),
    ).toBe('https://www.indeed.com/viewjob?jk=abc')
  })

  it('returns null instead of inventing an application URL', () => {
    const job = normalizeJsearchJob({
      ...jsearchLinkedInJob,
      job_apply_link: 'javascript:alert(1)',
      apply_options: [{ publisher: 'Mail', apply_link: 'mailto:jobs@acme.example', is_direct: true }, 'broken'],
    })
    expect(job?.applicationUrl).toBeNull()
    expect(job?.sourceUrl).toBeNull()
    const annotated = annotateCanonicalJob(job!)
    expect(annotated.applicationUrl).toBeNull()
    expect(annotated.applicationCapability).toBe('unsupported')
  })

  it('keeps JSearch a discovery provider and derives the application provider from the apply URL', () => {
    const greenhouse = annotateCanonicalJob(normalizeJsearchJob(jsearchLinkedInJob)!)
    expect(greenhouse).toMatchObject({ discoveryProvider: 'jsearch', applicationProvider: 'greenhouse', applicationCapability: 'unknown' })
    const workday = annotateCanonicalJob(
      normalizeJsearchJob({ ...jsearchLinkedInJob, apply_options: [], job_apply_link: 'https://acme.wd5.myworkdayjobs.com/acme/job/1', job_apply_is_direct: true })!,
    )
    expect(workday).toMatchObject({ discoveryProvider: 'jsearch', applicationProvider: 'workday', applicationCapability: 'unknown' })
    const board = annotateCanonicalJob(normalizeJsearchJob({ ...jsearchLinkedInJob, apply_options: [] })!)
    expect(board.applicationCapability).toBe('unsupported')
    for (const job of [greenhouse, workday, board]) expect(job.applicationCapability).not.toBe('auto_apply_supported')
  })
})

describe('JSearch search requests', () => {
  it('builds the query from keywords, location, remote, employment type, page, and date filters', () => {
    const query = buildJsearchSearchParams(
      params({ remote: 'remote', employmentType: 'contract', datePostedDays: 7, page: 2 }),
      5,
    )
    expect(Object.fromEntries(query!.entries())).toEqual({
      query: 'backend engineer in Austin, TX',
      page: '2',
      num_pages: '3',
      country: 'us',
      date_posted: 'week',
      work_from_home: 'true',
      employment_types: 'CONTRACTOR',
    })
    expect(buildJsearchSearchParams(params({ location: 'Remote' }))?.get('query')).toBe('backend engineer')
    expect(buildJsearchSearchParams(params({ q: '', keywords: '' }))).toBeNull()
    expect([0, 1, 3, 5, 30, 90].map(jsearchDatePosted)).toEqual(['all', 'today', '3days', 'week', 'month', 'all'])
  })

  it('sends the key only as a RapidAPI header and never in the URL or results', async () => {
    const { fetchImpl, calls } = recordingFetch(() => jsonResponse({ status: 'OK', data: [jsearchLinkedInJob] }))
    const result = await provider(fetchImpl).search(params())
    expect(calls).toHaveLength(1)
    expect(`${calls[0].url.origin}${calls[0].url.pathname}`).toBe('https://jsearch.p.rapidapi.com/search')
    expect(calls[0].headers['x-rapidapi-key']).toBe(API_KEY)
    expect(calls[0].headers['x-rapidapi-host']).toBe('jsearch.p.rapidapi.com')
    expect(calls[0].url.toString()).not.toContain(API_KEY)
    expect(JSON.stringify(result)).not.toContain(API_KEY)
    expect(result).toMatchObject({ provider: 'jsearch', rawCount: 1, hasMore: false })
    expect(result.jobs[0].providerJobId).toBe('JsAbC123xyz==')
  })

  it('does not call the API without keywords', async () => {
    const { fetchImpl } = recordingFetch(() => jsonResponse({ status: 'OK', data: [] }))
    const result = await provider(fetchImpl).search(params({ q: '', keywords: '' }))
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(result.warning?.code).toBe('empty')
  })

  it('paginates on request, bounds num_pages, and does not re-request the same page in one cycle', async () => {
    const page = (start: number) =>
      Array.from({ length: 10 }, (_, index) => ({ ...jsearchLinkedInJob, job_id: `job-${start + index}`, apply_options: [] }))
    const { fetchImpl, calls } = recordingFetch((url) => jsonResponse({ status: 'OK', data: page(Number(url.searchParams.get('page')) * 100) }))
    const jsearch = provider(fetchImpl, { maxPages: 99 })
    const first = await jsearch.search(params())
    const again = await jsearch.search(params())
    const second = await jsearch.search(params({ page: 2 }))
    expect(calls.map((call) => [call.url.searchParams.get('page'), call.url.searchParams.get('num_pages')])).toEqual([
      ['1', '3'],
      ['2', '3'],
    ])
    expect(first.jobs.map((job) => job.providerJobId)).toEqual(again.jobs.map((job) => job.providerJobId))
    expect(second.jobs[0].providerJobId).toBe('job-200')
    expect(first.hasMore).toBe(false)
    const onePage = provider(recordingFetch(() => jsonResponse({ status: 'OK', data: page(0) })).fetchImpl)
    expect((await onePage.search(params({ q: 'platform engineer' }))).hasMore).toBe(true)
  })

  it('returns an empty result without a warning when JSearch finds nothing', async () => {
    const result = await provider(recordingFetch(() => jsonResponse({ status: 'OK', data: [] })).fetchImpl).search(params())
    expect(result).toMatchObject({ jobs: [], rawCount: 0, hasMore: false })
    expect(result.warning).toBeUndefined()
  })

  it('reports malformed responses and skips malformed items', async () => {
    const malformed = [
      jsonResponse({ status: 'ERROR', error: { message: 'bad request' } }),
      jsonResponse({ status: 'OK', data: { job_id: 'x' } }),
      new Response('<html>not json</html>', { status: 200 }),
    ]
    for (const response of malformed) {
      clearHttpCaches()
      const result = await provider(recordingFetch(() => response).fetchImpl).search(params())
      expect(result.warning?.code).toBe('malformed')
      expect(result.jobs).toEqual([])
    }
    clearHttpCaches()
    const mixed = await provider(
      recordingFetch(() => jsonResponse({ status: 'OK', data: [jsearchLinkedInJob, { job_title: 'No id' }, 42] })).fetchImpl,
    ).search(params())
    expect(mixed.rawCount).toBe(3)
    expect(mixed.jobs).toHaveLength(1)
  })

  it('maps HTTP failures to explicit warnings instead of throwing', async () => {
    const cases: Array<[number, string]> = [
      [401, 'unauthorized'],
      [403, 'unauthorized'],
      [429, 'rate_limited'],
      [500, 'unavailable'],
    ]
    for (const [status, code] of cases) {
      clearHttpCaches()
      const result = await provider(recordingFetch(() => jsonResponse({ message: 'nope' }, status)).fetchImpl).search(params())
      expect(result.warning).toMatchObject({ provider: 'jsearch', code })
      expect(JSON.stringify(result)).not.toContain(API_KEY)
    }
    clearHttpCaches()
    const thrown = await provider(vi.fn(async () => { throw new Error('socket hang up') })).search(params())
    expect(thrown.warning?.code).toBe('unavailable')
  })
})

describe('JSearch job details', () => {
  it('loads and normalizes one job by id', async () => {
    const { fetchImpl, calls } = recordingFetch(() => jsonResponse({ status: 'OK', data: [jsearchLinkedInJob] }))
    const jsearch = provider(fetchImpl) as ReturnType<typeof provider> & { getJobDetails(id: string): Promise<unknown> }
    const job = await jsearch.getJobDetails('JsAbC123xyz==')
    expect(job).toMatchObject({ providerJobId: 'JsAbC123xyz==', applicationUrl: 'https://boards.greenhouse.io/acme/jobs/555' })
    expect(calls[0].url.pathname).toBe('/job-details')
    expect(calls[0].url.searchParams.get('job_id')).toBe('JsAbC123xyz==')
    expect(await jsearch.getJob?.('JsAbC123xyz==')).toMatchObject({ providerJobId: 'JsAbC123xyz==' })
    clearHttpCaches()
    expect(await provider(recordingFetch(() => jsonResponse({ status: 'OK', data: [] })).fetchImpl).getJob?.('missing')).toBeNull()
    expect(await provider(recordingFetch(() => jsonResponse({}, 404)).fetchImpl).getJob?.('missing-2')).toBeNull()
  })
})

describe('JSearch configuration', () => {
  it('is not_configured without RAPIDAPI_KEY and never calls the API', async () => {
    const { fetchImpl } = recordingFetch(() => jsonResponse({ status: 'OK', data: [] }))
    const jsearch = createJsearchProvider({ apiKey: '', enabled: true, fetchImpl })
    expect([jsearch.isEnabled(), jsearch.isAvailable(), jsearch.connectionLabel()]).toEqual([false, false, 'Not configured'])
    expect(providerStatuses([jsearch])[0]).toMatchObject({ name: 'jsearch', status: 'not_configured' })
    expect((await jsearch.search(params())).warning?.code).toBe('missing_key')
    expect(await jsearch.getJob?.('x')).toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('is available when RAPIDAPI_KEY is set and disabled when turned off', () => {
    vi.stubEnv('RAPIDAPI_KEY', API_KEY)
    const configured = jsearchFromConfig(getServerConfig())
    expect(providerStatuses([configured])[0]).toMatchObject({ status: 'available', available: true, connectionLabel: 'Connected' })
    vi.stubEnv('RAPIDAPI_KEY', '')
    expect(providerStatuses([jsearchFromConfig(getServerConfig())])[0].status).toBe('not_configured')
    vi.stubEnv('RAPIDAPI_KEY', API_KEY)
    vi.stubEnv('JSEARCH_ENABLED', 'false')
    expect(providerStatuses([jsearchFromConfig(getServerConfig())])[0].status).toBe('disabled')
  })

  it('keeps RAPIDAPI_KEY out of frontend and extension code', () => {
    const offenders: string[] = []
    const walk = (directory: string) => {
      for (const name of readdirSync(directory)) {
        const path = join(directory, name)
        if (statSync(path).isDirectory()) walk(path)
        else if (/\.(ts|tsx|js|jsx|json|html)$/.test(name) && /RAPIDAPI|rapidapi/.test(readFileSync(path, 'utf8'))) offenders.push(path)
      }
    }
    walk(join(process.cwd(), 'src'))
    walk(join(process.cwd(), 'extension', 'src'))
    expect(offenders).toEqual([])
    expect(readFileSync(join(process.cwd(), '.env.example'), 'utf8')).not.toMatch(/VITE_RAPIDAPI/)
  })
})
