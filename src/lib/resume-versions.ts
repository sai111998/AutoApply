import type { SupabaseClient } from '@supabase/supabase-js'
import { mapResumeVersion, resumeVersionToRow } from '@/lib/mappers'
import { isForeignKeyError, isMissingColumnError, userFacingPersistError } from '@/lib/persist-errors'
import type { ResumeVersion } from '@/types/domain'

type ResumeVersionRow = ReturnType<typeof resumeVersionToRow>

export function resumeVersionCoreRow(version: ResumeVersion): Omit<
  ResumeVersionRow,
  'status' | 'created_by' | 'is_selected' | 'generation_id' | 'comparison_analysis_id' | 'original_content'
> {
  const row = resumeVersionToRow(version)
  return {
    id: row.id,
    user_id: row.user_id,
    source_resume_id: row.source_resume_id,
    job_id: row.job_id,
    analysis_id: row.analysis_id,
    version_name: row.version_name,
    resume_content: row.resume_content,
    tailoring_summary: row.tailoring_summary,
    changes: row.changes,
    warnings: row.warnings,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

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
  const full = resumeVersionToRow(version)
  let result = await client.from('resume_versions').upsert(full, { onConflict: 'id', defaultToNull: false })

  if (result.error && isMissingColumnError(result.error)) {
    console.info('[tailor] persist-fallback-core-columns', { versionId: version.id })
    result = await client
      .from('resume_versions')
      .upsert(resumeVersionCoreRow(version), { onConflict: 'id', defaultToNull: false })
  }

  if (result.error && isForeignKeyError(result.error)) {
    console.info('[tailor] persist-fallback-nullable-analysis', { versionId: version.id })
    const core = resumeVersionCoreRow(version)
    result = await client.from('resume_versions').upsert(
      { ...core, analysis_id: null },
      { onConflict: 'id', defaultToNull: false },
    )
  }

  if (result.error) {
    throw new Error(userFacingPersistError(result.error, 'Could not keep the resume.'))
  }
}

export async function deselectOtherResumeVersions(client: SupabaseClient, version: ResumeVersion) {
  if (!version.jobId) return
  const result = await client
    .from('resume_versions')
    .update({ is_selected: false })
    .eq('user_id', version.userId)
    .eq('job_id', version.jobId)
    .neq('id', version.id)
  if (result.error && isMissingColumnError(result.error)) {
    console.info('[tailor] persist-deselect-missing-column', { versionId: version.id })
    return
  }
  if (result.error) {
    throw new Error(userFacingPersistError(result.error, 'Could not keep the resume.'))
  }
}

export async function deleteResumeVersionRecord(client: SupabaseClient, userId: string, versionId: string) {
  const result = await client.from('resume_versions').delete().eq('id', versionId).eq('user_id', userId)
  if (result.error) throw result.error
}
