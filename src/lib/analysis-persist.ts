import type { SupabaseClient } from '@supabase/supabase-js'
import {
  applicationCoreRow,
  applicationToRow,
  jobToRow,
  mapApplication,
  mapJob,
  mapMatch,
  mapResumeVersion,
  matchToRow,
} from '@/lib/mappers'
import { isForeignKeyError, isMissingColumnError, isRlsError, userFacingPersistError } from '@/lib/persist-errors'
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

export function removeAnalysisFromSnapshot<
  TMatch extends { id: string; jobId: string },
  TJob extends { id: string },
  TApp extends { matchId: string | null },
  T extends { matches: TMatch[]; jobs: TJob[]; applications: TApp[] },
>(state: T, matchId: string): T {
  const match = state.matches.find((item) => item.id === matchId)
  if (!match) return state
  const remainingMatches = state.matches.filter((item) => item.id !== matchId)
  const remainingApplications = state.applications.filter((item) => item.matchId !== matchId)
  const jobStillUsed = remainingMatches.some((item) => item.jobId === match.jobId)
  return {
    ...state,
    matches: remainingMatches,
    applications: remainingApplications,
    jobs: jobStillUsed ? state.jobs : state.jobs.filter((job) => job.id !== match.jobId),
  }
}

export function mergeFetchedMatches<T extends { id: string; analysisStatus: string }>(
  fetched: T[],
  current: T[],
): T[] {
  const fetchedIds = new Set(fetched.map((item) => item.id))
  const localInFlight = current.filter(
    (item) => !fetchedIds.has(item.id) && item.analysisStatus !== 'complete',
  )
  return [...fetched, ...localInFlight]
}

export function filterAnalysisHistory<
  T extends {
    job?: { title?: string; company?: string } | null
    match: { recommendation?: string | null }
    version?: { versionName?: string } | null
  },
>(rows: T[], query: string): T[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return rows
  return rows.filter((row) =>
    `${row.job?.title ?? ''} ${row.job?.company ?? ''} ${row.match.recommendation ?? ''} ${row.version?.versionName ?? ''}`
      .toLowerCase()
      .includes(needle),
  )
}

export async function persistMatchRecord(client: SupabaseClient, match: JobMatch) {
  const full = matchToRow(match)
  let result = await client.from('job_matches').upsert(full, { onConflict: 'id', defaultToNull: false })

  if (result.error && isMissingColumnError(result.error)) {
    console.info('[tailor] persist-match-fallback-core-columns', { matchId: match.id })
    const { parent_match_id: _parent, resume_version_id: _version, ...core } = full
    result = await client.from('job_matches').upsert(core, { onConflict: 'id', defaultToNull: false })
  }

  if (result.error && isForeignKeyError(result.error)) {
    console.info('[tailor] persist-match-fallback-nullable-fks', { matchId: match.id })
    result = await client.from('job_matches').upsert(
      { ...full, parent_match_id: null, resume_version_id: null },
      { onConflict: 'id', defaultToNull: false },
    )
  }

  if (result.error) {
    throw new Error(userFacingPersistError(result.error, 'Could not save the updated match analysis.'))
  }
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
  if (applicationResult.error && isMissingColumnError(applicationResult.error)) {
    const coreResult = await client
      .from('applications')
      .upsert(applicationCoreRow(records.application), { onConflict: 'id', defaultToNull: false })
    if (coreResult.error) throw coreResult.error
    return
  }
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

export async function persistApplicationSelection(client: SupabaseClient, application: Application) {
  const full = applicationToRow(application)
  let result = await client.from('applications').upsert(full, { onConflict: 'id', defaultToNull: false })
  if (result.error && isMissingColumnError(result.error)) {
    result = await client
      .from('applications')
      .upsert(applicationCoreRow(application), { onConflict: 'id', defaultToNull: false })
  }
  if (result.error) {
    throw new Error(userFacingPersistError(result.error, 'Could not update the application with the selected resume.'))
  }
}

function deleteApplicationError(error: unknown, fallback = 'Could not delete the selected applications.'): string {
  if (isRlsError(error)) {
    return 'You can only delete applications from your own account.'
  }
  return userFacingPersistError(error, fallback)
}

export async function deleteApplicationRecords(
  client: SupabaseClient,
  userId: string,
  applicationIds: string[],
): Promise<{ deletedIds: string[]; remainingIds: string[] }> {
  const ids = [...new Set(applicationIds.filter(Boolean))]
  if (!ids.length) return { deletedIds: [], remainingIds: [] }

  const owned = await client.from('applications').select('id').in('id', ids).eq('user_id', userId)
  if (owned.error) {
    throw new Error(deleteApplicationError(owned.error))
  }

  const ownedIds = (owned.data ?? []).map((row) => String((row as { id: string }).id))
  const unownedIds = ids.filter((id) => !ownedIds.includes(id))
  if (!ownedIds.length) {
    return { deletedIds: [], remainingIds: ids }
  }

  const result = await client.from('applications').delete().in('id', ownedIds).eq('user_id', userId)
  if (result.error) {
    throw new Error(deleteApplicationError(result.error))
  }

  const remaining = await client.from('applications').select('id').in('id', ownedIds).eq('user_id', userId)
  if (remaining.error) {
    throw new Error(deleteApplicationError(remaining.error, 'Could not confirm application deletion.'))
  }

  const remainingOwnedIds = (remaining.data ?? []).map((row) => String((row as { id: string }).id))
  const remainingSet = new Set(remainingOwnedIds)
  return {
    deletedIds: ownedIds.filter((id) => !remainingSet.has(id)),
    remainingIds: [...remainingOwnedIds, ...unownedIds],
  }
}

export async function fetchJobApplicationBundle(client: SupabaseClient, userId: string, jobId: string) {
  const [applicationsRes, versionsRes, matchesRes] = await Promise.all([
    client
      .from('applications')
      .select('*')
      .eq('user_id', userId)
      .eq('job_id', jobId)
      .order('updated_at', { ascending: false })
      .limit(1),
    client.from('resume_versions').select('*').eq('user_id', userId).eq('job_id', jobId).order('created_at', { ascending: false }),
    client.from('job_matches').select('*').eq('user_id', userId).eq('job_id', jobId).order('created_at', { ascending: false }),
  ])

  const error = applicationsRes.error ?? versionsRes.error ?? matchesRes.error
  return {
    application: applicationsRes.data?.[0] ? mapApplication(applicationsRes.data[0]) : null,
    versions: (versionsRes.data ?? []).map(mapResumeVersion),
    matches: (matchesRes.data ?? []).map(mapMatch),
    error: error?.message ?? null,
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
  const [jobRes, applicationByMatchRes, applicationByJobRes] = await Promise.all([
    client.from('jobs').select('*').eq('id', match.jobId).eq('user_id', userId).maybeSingle(),
    client.from('applications').select('*').eq('match_id', match.id).eq('user_id', userId).maybeSingle(),
    client
      .from('applications')
      .select('*')
      .eq('job_id', match.jobId)
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(1),
  ])
  if (jobRes.error) throw jobRes.error
  if (applicationByMatchRes.error) throw applicationByMatchRes.error
  if (applicationByJobRes.error) throw applicationByJobRes.error

  const applicationRow = applicationByMatchRes.data ?? applicationByJobRes.data?.[0] ?? null

  return {
    match,
    job: jobRes.data ? mapJob(jobRes.data) : null,
    application: applicationRow ? mapApplication(applicationRow) : null,
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
