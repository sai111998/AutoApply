import type { SupabaseClient } from '@supabase/supabase-js'
import {
  applicationToRow,
  jobToRow,
  mapApplication,
  mapJob,
  mapMatch,
  matchToRow,
} from '@/lib/mappers'
import type { Application, Job, JobMatch } from '@/types/domain'

export function isUuid(value: string | undefined | null): value is string {
  return Boolean(
    value &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
  )
}

export function upsertById<T extends { id: string }>(items: T[], incoming: T): T[] {
  const index = items.findIndex((item) => item.id === incoming.id)
  if (index === -1) return [incoming, ...items]
  const next = [...items]
  next[index] = incoming
  return next
}

export async function persistAnalysisRecords(
  client: SupabaseClient,
  records: { job: Job; match: JobMatch; application: Application },
) {
  const jobResult = await client.from('jobs').upsert(jobToRow(records.job), { onConflict: 'id', defaultToNull: false })
  if (jobResult.error) throw jobResult.error

  const matchResult = await client
    .from('job_matches')
    .upsert(matchToRow(records.match), { onConflict: 'id', defaultToNull: false })
  if (matchResult.error) throw matchResult.error

  const applicationResult = await client
    .from('applications')
    .upsert(applicationToRow(records.application), { onConflict: 'id', defaultToNull: false })
  if (applicationResult.error) throw applicationResult.error
}

export async function fetchAnalysisHistory(client: SupabaseClient, userId: string) {
  const [jobsRes, matchesRes, applicationsRes] = await Promise.all([
    client.from('jobs').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
    client.from('job_matches').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
    client.from('applications').select('*').eq('user_id', userId).order('date_added', { ascending: false }),
  ])

  const error = jobsRes.error ?? matchesRes.error ?? applicationsRes.error
  if (error) {
    return {
      jobs: [] as Job[],
      matches: [] as JobMatch[],
      applications: [] as Application[],
      error: error.message,
    }
  }

  return {
    jobs: (jobsRes.data ?? []).map(mapJob),
    matches: (matchesRes.data ?? []).map(mapMatch),
    applications: (applicationsRes.data ?? []).map(mapApplication),
    error: null,
  }
}

export async function fetchMatchBundle(client: SupabaseClient, userId: string, matchId: string) {
  const matchRes = await client
    .from('job_matches')
    .select('*')
    .eq('id', matchId)
    .eq('user_id', userId)
    .maybeSingle()
  if (matchRes.error) throw matchRes.error
  if (!matchRes.data) return { match: null, job: null, application: null }

  const match = mapMatch(matchRes.data)
  const [jobRes, applicationRes] = await Promise.all([
    client.from('jobs').select('*').eq('id', match.jobId).eq('user_id', userId).maybeSingle(),
    client.from('applications').select('*').eq('match_id', match.id).eq('user_id', userId).maybeSingle(),
  ])
  if (jobRes.error) throw jobRes.error
  if (applicationRes.error) throw applicationRes.error

  return {
    match,
    job: jobRes.data ? mapJob(jobRes.data) : null,
    application: applicationRes.data ? mapApplication(applicationRes.data) : null,
  }
}

export async function deleteAnalysisRecords(
  client: SupabaseClient,
  userId: string,
  records: { matchId: string; jobId: string; applicationId: string | null },
) {
  if (records.applicationId) {
    const applicationDelete = await client
      .from('applications')
      .delete()
      .eq('id', records.applicationId)
      .eq('user_id', userId)
    if (applicationDelete.error) throw applicationDelete.error
  }

  const matchDelete = await client
    .from('job_matches')
    .delete()
    .eq('id', records.matchId)
    .eq('user_id', userId)
  if (matchDelete.error) throw matchDelete.error

  const remaining = await client
    .from('job_matches')
    .select('id')
    .eq('job_id', records.jobId)
    .eq('user_id', userId)
    .limit(1)
  if (remaining.error) throw remaining.error

  if (!remaining.data?.length) {
    const jobDelete = await client.from('jobs').delete().eq('id', records.jobId).eq('user_id', userId)
    if (jobDelete.error) throw jobDelete.error
  }
}
