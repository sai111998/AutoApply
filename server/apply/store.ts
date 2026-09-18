import { createClient } from '@supabase/supabase-js'
import type { ServerConfig } from '../config'
import type { AutoApplyQueueItem, AutoApplyRun } from './types'

export interface StoredRun {
  run: AutoApplyRun
  items: AutoApplyQueueItem[]
}

export interface AutoApplyStore {
  save(run: AutoApplyRun, items: AutoApplyQueueItem[]): Promise<void>
  get(runId: string): Promise<StoredRun | null>
  list(userId: string): Promise<StoredRun[]>
}

const runs = new Map<string, StoredRun>()

export const memoryStore: AutoApplyStore = {
  async save(run, items) {
    runs.set(run.id, { run: { ...run }, items: items.map((item) => ({ ...item })) })
  },
  async get(runId) {
    const current = runs.get(runId)
    if (!current) return null
    return { run: { ...current.run }, items: current.items.map((item) => ({ ...item })) }
  },
  async list(userId) {
    return [...runs.values()]
      .filter((item) => item.run.userId === userId)
      .sort((left, right) => right.run.createdAt.localeCompare(left.run.createdAt))
      .map((item) => ({ run: { ...item.run }, items: item.items.map((entry) => ({ ...entry })) }))
  },
}

export function clearAutoApplyMemory() {
  runs.clear()
}

export async function persistRun(
  store: AutoApplyStore,
  run: AutoApplyRun,
  items: AutoApplyQueueItem[],
  config?: ServerConfig,
) {
  await store.save(run, items)
  if (!config?.supabaseUrl || !config.supabaseServiceRoleKey) return
  const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  await supabase.from('auto_apply_runs').upsert(
    {
      id: run.id,
      user_id: run.userId,
      status: run.status,
      config: run.config,
      counts: run.counts,
      created_at: run.createdAt,
      updated_at: run.updatedAt,
    },
    { onConflict: 'id', defaultToNull: false },
  )
  if (items.length) {
    await supabase.from('auto_apply_queue').upsert(
      items.map((item) => ({
        id: item.id,
        run_id: item.runId,
        user_id: run.userId,
        job_id: item.jobId,
        application_id: item.applicationId,
        resume_version_id: item.resumeVersionId,
        identity_key: item.identityKey,
        title: item.title,
        company: item.company,
        application_url: item.applicationUrl,
        initial_match_score: item.initialMatchScore,
        final_match_score: item.finalMatchScore,
        c2c_status: item.c2cStatus,
        c2c_evidence: item.c2cEvidence,
        application_status: item.applicationStatus,
        failure_reason: item.failureReason,
        questions: item.questions,
        resume_version_name: item.resumeVersionName,
        tailored_resume_text: item.tailoredResumeText,
        session_id: item.sessionId,
        created_at: item.createdAt,
        updated_at: item.updatedAt,
      })),
      { onConflict: 'id', defaultToNull: false },
    )
  }
}
