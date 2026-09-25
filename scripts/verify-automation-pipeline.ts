import { JAVA_RESUME_TEXT } from '../server/tailor/fixtures'

const base = (process.env.API_BASE_URL?.trim() || `http://127.0.0.1:${process.env.API_PORT ?? 8787}`).replace(/\/$/, '')

const profile = {
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

const campaignConfig = {
  maxJobs: 1,
  minimumMatchRate: 70,
  autoTailorResume: false,
  jobType: 'all',
  remotePreference: 'any',
  employmentType: 'any',
  keywords: [],
  q: '',
  country: 'US',
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  const body = (await response.json()) as T
  if (!response.ok) {
    throw new Error(`${path} failed: ${response.status} ${JSON.stringify(body)}`)
  }
  return body
}

async function waitFor<T>(label: string, fn: () => Promise<T>, ok: (value: T) => boolean, timeoutMs = 90_000) {
  const started = Date.now()
  let last: T | undefined
  while (Date.now() - started < timeoutMs) {
    last = await fn()
    if (ok(last)) return last
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  throw new Error(`${label} timed out: ${JSON.stringify(last)}`)
}

async function main() {
  const health = await json<Record<string, unknown>>('/api/automation/health')
  console.log('HEALTH', JSON.stringify(health, null, 2))

  const started = await json<{
    run: { id: string; counts: Record<string, number> }
    items: Array<Record<string, unknown>>
  }>('/api/jobs/auto-apply/start', {
    method: 'POST',
    body: JSON.stringify({
      userId: 'verify-synthetic',
      resumeId: 'resume-1',
      resumeVersionId: 'resume-1',
      resumeText: JAVA_RESUME_TEXT,
      masterResumeText: JAVA_RESUME_TEXT,
      profile,
      config: { ...campaignConfig, includeSynthetic: true },
    }),
  })
  console.log('SYNTHETIC_START', {
    runId: started.run.id,
    queued: started.items.length,
    counts: started.run.counts,
    titles: started.items.map((item) => item.title),
  })

  const finished = await waitFor(
    'synthetic submission',
    () =>
      json<{
        run: { counts: Record<string, number> }
        items: Array<{ applicationStatus: string; confirmationNumber?: string | null; title?: string; company?: string }>
      }>(`/api/jobs/auto-apply/${started.run.id}`),
    (current) => current.items.some((item) => ['submitted', 'failed', 'needs_user_input', 'needs_confirmation'].includes(item.applicationStatus)),
  )
  const applications = await json<{ applications: Array<Record<string, unknown>> }>(
    '/api/automation/applications?userId=verify-synthetic',
  )
  console.log('SYNTHETIC_DONE', {
    status: finished.items[0]?.applicationStatus,
    confirmationNumber: finished.items[0]?.confirmationNumber,
    applications: applications.applications.length,
  })

  const discovered = await json<{
    jobs: Array<{
      title: string
      company: string
      provider: string
      discoveryProvider?: string
      url?: string | null
      matchScore?: number | null
    }>
    diagnostics?: Array<{ provider: string; raw: number; normalized: number; deduplicated: number; filtered: number }>
  }>(
    '/api/jobs?' +
      new URLSearchParams({
        q: 'Java Software Engineer',
        country: 'US',
        remote: 'any',
        jobType: 'all',
        includeSynthetic: '0',
      }).toString(),
  )
  const real = discovered.jobs.find(
    (job) =>
      job.company !== 'Test Employer' &&
      !/cisco/i.test(`${job.title} ${job.company}`) &&
      Boolean(job.url),
  )
  console.log('DISCOVERY', {
    diagnostics: discovered.diagnostics,
    total: discovered.jobs.length,
    realJob: real ? { title: real.title, company: real.company, provider: real.discoveryProvider || real.provider } : null,
  })

  if (!real) {
    console.log('REAL_JOB', { result: 'no_non_cisco_job_returned' })
    return
  }

  const realStart = await json<{
    run: { id: string; counts: Record<string, number> }
    items: Array<Record<string, unknown>>
  }>('/api/jobs/auto-apply/start', {
    method: 'POST',
    body: JSON.stringify({
      userId: 'verify-real',
      resumeId: 'resume-1',
      resumeVersionId: 'resume-1',
      resumeText: JAVA_RESUME_TEXT,
      masterResumeText: JAVA_RESUME_TEXT,
      profile,
      config: { ...campaignConfig, q: 'Java Software Engineer', includeSynthetic: false },
    }),
  })
  const realRun = await waitFor(
    'real job detection',
    () =>
      json<{
        run: { counts: Record<string, number> }
        items: Array<{
          title: string
          company: string
          applicationStatus: string
          applicationCapability?: string
          discoverySource?: string
          applicationProvider?: string
          failureReason?: string | null
        }>
      }>(`/api/jobs/auto-apply/${realStart.run.id}`),
    (current) =>
      current.items.length > 0 &&
      !['queued', 'opening'].includes(current.items[0]?.applicationStatus ?? 'queued'),
    60_000,
  ).catch(() => realStart)
  console.log('REAL_JOB', {
    title: real.title,
    company: real.company,
    discoveryProvider: real.discoveryProvider || real.provider,
    queued: realStart.items.length,
    counts: realStart.run.counts,
    processed: 'items' in realRun ? realRun.items[0] : null,
  })
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
