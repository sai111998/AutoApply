import { afterEach, describe, expect, it, vi } from 'vitest'
import { listLiveJobsRequest, LiveJobsRequestError, visibleLiveJobsWarning } from './client'

const unavailable = 'Live job source temporarily unavailable.'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('listLiveJobsRequest', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('parses jobs from the response body when the provider warning is present', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain('/api/jobs?')
      expect(url).toContain('q=Java+Software+Engineer')
      expect(url).toContain('country=US')
      return jsonResponse({
        jobs: [{ id: 'job-1', title: 'AI Engineer' }],
        page: 1,
        limit: 25,
        total: 1,
        hasMore: false,
        source: 'Job Opportunities API',
        warning: { provider: 'job-opportunities', code: 'unavailable', message: unavailable },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await listLiveJobsRequest({
      q: 'Java Software Engineer',
      country: 'US',
      page: 1,
      limit: 25,
      sort: 'match',
    })

    expect(result.jobs).toHaveLength(1)
    expect(result.jobs[0]?.title).toBe('AI Engineer')
    expect(result.page).toBe(1)
    expect(result.source).toBe('Job Opportunities API')
    expect(visibleLiveJobsWarning(result.warning?.message)).toBeNull()
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('keeps a non-outage warning', () => {
    expect(visibleLiveJobsWarning('Some listings were skipped.')).toBe('Some listings were skipped.')
    expect(visibleLiveJobsWarning(null)).toBeNull()
  })

  it('treats HTTP 500 as a source failure and keeps the server message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'aggregator failed' }, 500)))
    const error = await listLiveJobsRequest({ q: 'Java' }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(LiveJobsRequestError)
    expect(error).toMatchObject({ status: 500, sourceUnavailable: true, message: 'aggregator failed' })
  })

  it('does not treat HTTP 404 as a source outage', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'Cannot GET /api/jobs' }, 404)))
    const error = await listLiveJobsRequest().catch((caught: unknown) => caught)
    expect(error).toMatchObject({ status: 404, sourceUnavailable: false, message: 'Cannot GET /api/jobs' })
  })

  it('treats a network failure as a source outage and keeps the error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )
    const error = await listLiveJobsRequest({ q: 'Java' }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(LiveJobsRequestError)
    expect(error).toMatchObject({ status: null, sourceUnavailable: true, message: 'Failed to fetch' })
  })
})
