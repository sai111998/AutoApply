import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import type { ServerConfig } from '../config'
import type { AnalysisResult, AnalyzeJobRequestBody } from '../types'

export interface PersistResult {
  persisted: boolean
  jobId: string | null
  matchId: string | null
}

function titleFromDescription(description: string, fallback?: string) {
  if (fallback?.trim()) return fallback.trim()
  const line = description.split('\n').map((part) => part.trim()).find(Boolean)
  if (!line) return 'Untitled role'
  return line.length > 120 ? `${line.slice(0, 117)}...` : line
}

function asUuid(value?: string): string {
  if (
    value &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  ) {
    return value
  }
  return randomUUID()
}

export async function persistAnalysis(
  config: ServerConfig,
  request: AnalyzeJobRequestBody,
  result: AnalysisResult,
): Promise<PersistResult> {
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey || !request.userId) {
    return { persisted: false, jobId: null, matchId: null }
  }

  const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const jobId = asUuid(request.jobId)
  const matchId = asUuid(request.matchId)
  const applicationId = asUuid(request.applicationId)
  const now = new Date().toISOString()

  const jobInsert = await supabase.from('jobs').upsert(
    {
      id: jobId,
      user_id: request.userId,
      title: titleFromDescription(request.jobDescription, request.title),
      company: request.company?.trim() || 'Unknown company',
      location: request.location?.trim() || '',
      job_url: request.jobUrl?.trim() || '',
      description: request.jobDescription,
      created_at: now,
    },
    { onConflict: 'id', defaultToNull: false },
  )

  if (jobInsert.error) {
    return { persisted: false, jobId: null, matchId: null }
  }

  const matchInsert = await supabase.from('job_matches').upsert(
    {
      id: matchId,
      user_id: request.userId,
      job_id: jobId,
      resume_id: request.resumeId ?? null,
      overall_score: result.matchScore,
      skills_matched: result.requiredSkills.matched.concat(result.preferredSkills.matched),
      skills_partial: result.requiredSkills.partial.concat(result.preferredSkills.partial),
      skills_missing: result.requiredSkills.missing.concat(result.preferredSkills.missing),
      experience_match: {
        score: result.experienceMatch ? 100 : 0,
        matched: result.experienceMatch,
        summary: result.experience.gap || result.experience.candidateEvidence,
      },
      education_match: {
        score: result.educationMatch ? 100 : 0,
        matched: result.educationMatch,
        summary: result.education.details,
      },
      location_match: {
        score: result.locationMatch ? 100 : 0,
        matched: result.locationMatch,
        summary: result.locationFit.details,
      },
      work_authorization_notes:
        result.report.missingEvidence.find((item) => /authorization|sponsor/i.test(item)) ||
        'Work authorization was compared only when the posting and resume stated it.',
      strengths: result.strengths,
      concerns: result.concerns,
      recommendation: result.recommendation,
      analysis_status: 'complete',
      analysis_source: 'api',
      provider: 'match-engine',
      error_message: null,
      created_at: now,
      analyzed_at: now,
      summary: result.summary,
      analysis_payload: result.report,
    },
    { onConflict: 'id', defaultToNull: false },
  )

  if (matchInsert.error) {
    return { persisted: false, jobId, matchId: null }
  }

  const applicationRow = {
    id: applicationId,
    user_id: request.userId,
    job_id: jobId,
    match_id: matchId,
    resume_id: request.resumeId ?? null,
    selected_resume_version_id: null,
    current_match_id: matchId,
    current_match_score: result.matchScore ?? null,
    status: 'ready',
    date_added: now.slice(0, 10),
    date_applied: null,
    next_action: 'Ready to apply',
    notes: '',
    created_at: now,
    updated_at: now,
  }

  let applicationInsert = await supabase.from('applications').upsert(applicationRow, { onConflict: 'id', defaultToNull: false })
  if (applicationInsert.error && /could not find the .* column|PGRST204|schema cache/i.test(applicationInsert.error.message)) {
    const {
      selected_resume_version_id: _selected,
      current_match_id: _current,
      current_match_score: _score,
      ...core
    } = applicationRow
    applicationInsert = await supabase.from('applications').upsert(core, { onConflict: 'id', defaultToNull: false })
  }

  if (applicationInsert.error) {
    console.error('Failed to persist application', applicationInsert.error.message)
  }

  return { persisted: true, jobId, matchId }
}
