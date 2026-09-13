import { createClient } from '@supabase/supabase-js'
import type { ServerConfig } from '../config'
import type { NormalizedJob } from './types'

export function discoveredJobRow(userId: string, job: NormalizedJob) {
  return {
    id: job.id,
    user_id: userId,
    title: job.title,
    company: job.company || 'Unknown company',
    location: job.location ?? '',
    job_url: job.jobUrl ?? '',
    description: job.description ?? '',
    provider: job.provider,
    provider_job_id: job.providerJobId,
    remote: job.remote,
    work_arrangement: job.workArrangement,
    employment_type: job.employmentType,
    posted_at: job.postedAt,
    discovered_at: job.discoveredAt,
    last_verified_at: job.lastVerifiedAt,
    salary_min: job.salaryMin,
    salary_max: job.salaryMax,
    salary_currency: job.salaryCurrency,
    source: job.source,
    identity_key: job.identityKey,
    raw_metadata: job.rawMetadata,
  }
}

export async function persistDiscoveredJobs(
  config: ServerConfig,
  userId: string,
  jobs: NormalizedJob[],
): Promise<boolean> {
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey || !userId || !jobs.length) return false
  const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const full = jobs.map((job) => discoveredJobRow(userId, job))
  let result = await supabase.from('jobs').upsert(full, { onConflict: 'id', defaultToNull: false })
  if (result.error && /could not find the .* column|PGRST204|schema cache/i.test(result.error.message ?? '')) {
    result = await supabase.from('jobs').upsert(
      full.map((row) => ({
        id: row.id,
        user_id: row.user_id,
        title: row.title,
        company: row.company,
        location: row.location,
        job_url: row.job_url,
        description: row.description,
      })),
      { onConflict: 'id', defaultToNull: false },
    )
  }
  return !result.error
}

export async function persistSavedJob(
  config: ServerConfig,
  userId: string,
  job: NormalizedJob,
): Promise<{ saved: boolean; jobId: string }> {
  const persisted = await persistDiscoveredJobs(config, userId, [job])
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey || !userId) {
    return { saved: persisted, jobId: job.id }
  }
  const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const insert = await supabase.from('saved_jobs').upsert(
    { user_id: userId, job_id: job.id },
    { onConflict: 'user_id,job_id', defaultToNull: false },
  )
  return { saved: persisted || !insert.error, jobId: job.id }
}
