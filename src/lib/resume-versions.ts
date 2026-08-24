import type { SupabaseClient } from '@supabase/supabase-js'
import { mapResumeVersion, resumeVersionToRow } from '@/lib/mappers'
import type { ResumeVersion } from '@/types/domain'

export async function fetchResumeVersions(client: SupabaseClient, userId: string) {
  const result = await client
    .from('resume_versions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  if (result.error) return { versions: [] as ResumeVersion[], error: result.error.message }
  return { versions: (result.data ?? []).map(mapResumeVersion), error: null }
}

export async function persistResumeVersion(client: SupabaseClient, version: ResumeVersion) {
  const result = await client.from('resume_versions').upsert(resumeVersionToRow(version), {
    onConflict: 'id',
    defaultToNull: false,
  })
  if (result.error) throw result.error
}

export async function deleteResumeVersionRecord(client: SupabaseClient, userId: string, versionId: string) {
  const result = await client.from('resume_versions').delete().eq('id', versionId).eq('user_id', userId)
  if (result.error) throw result.error
}
