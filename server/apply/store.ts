import { createClient } from '@supabase/supabase-js'
import type { ServerConfig } from '../config'
import { logApplyEvent } from './log'
import { DATABASE_TIMEOUT_MS, withTimeout } from './timeouts'
import type { AutoApplyCounts, AutoApplyQueueItem, AutoApplyRun } from './types'

export interface StoredRun {
  run: AutoApplyRun
  items: AutoApplyQueueItem[]
}

export interface AutoApplyStore {
  save(run: AutoApplyRun, items: AutoApplyQueueItem[]): Promise<void>
  get(runId: string): Promise<StoredRun | null>
  list(userId: string): Promise<StoredRun[]>
  listAll?(): Promise<StoredRun[]>
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
  async listAll() {
    return [...runs.values()].map((item) => ({
      run: { ...item.run },
      items: item.items.map((entry) => ({ ...entry })),
    }))
  },
}

export function clearAutoApplyMemory() {
  runs.clear()
}

function database(config?: ServerConfig) {
  if (!config?.supabaseUrl || !config.supabaseServiceRoleKey) return null
  return createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function asItem(row: Record<string, unknown>, runId: string): AutoApplyQueueItem {
  return {
    id: String(row.id ?? ''),
    runId,
    jobId: String(row.job_id ?? ''),
    identityKey: String(row.identity_key ?? ''),
    applicationId: typeof row.application_id === 'string' ? row.application_id : null,
    resumeVersionId: typeof row.resume_version_id === 'string' ? row.resume_version_id : null,
    resumeVersionName: String(row.resume_version_name ?? 'Master'),
    title: String(row.title ?? ''),
    company: String(row.company ?? ''),
    applicationUrl: typeof row.application_url === 'string' ? row.application_url : null,
    initialMatchScore: typeof row.initial_match_score === 'number' ? row.initial_match_score : null,
    finalMatchScore: typeof row.final_match_score === 'number' ? row.final_match_score : null,
    c2cStatus: row.c2c_status === 'confirmed' || row.c2c_status === 'not_allowed' ? row.c2c_status : 'unknown',
    c2cEvidence: Array.isArray(row.c2c_evidence) ? (row.c2c_evidence as AutoApplyQueueItem['c2cEvidence']) : [],
    applicationStatus: (typeof row.application_status === 'string' ? row.application_status : 'queued') as AutoApplyQueueItem['applicationStatus'],
    failureReason: typeof row.failure_reason === 'string' ? row.failure_reason : null,
    questions: Array.isArray(row.questions) ? (row.questions as AutoApplyQueueItem['questions']) : [],
    tailoredResumeText: typeof row.tailored_resume_text === 'string' ? row.tailored_resume_text : null,
    masterResumeUnchanged: true,
    sessionId: typeof row.session_id === 'string' ? row.session_id : null,
    createdAt: String(row.created_at ?? new Date().toISOString()),
    updatedAt: String(row.updated_at ?? new Date().toISOString()),
  }
}

function asRun(row: Record<string, unknown>): AutoApplyRun {
  return {
    id: String(row.id ?? ''),
    userId: String(row.user_id ?? ''),
    status: (typeof row.status === 'string' ? row.status : 'paused') as AutoApplyRun['status'],
    config: (row.config && typeof row.config === 'object' ? row.config : {}) as AutoApplyRun['config'],
    counts: (row.counts && typeof row.counts === 'object' ? row.counts : {}) as AutoApplyCounts,
    createdAt: String(row.created_at ?? new Date().toISOString()),
    updatedAt: String(row.updated_at ?? new Date().toISOString()),
  }
}

export async function loadRunFromDatabase(runId: string, config?: ServerConfig): Promise<StoredRun | null> {
  const supabase = database(config)
  if (!supabase || !runId) return null
  const runResult = await supabase.from('auto_apply_runs').select('*').eq('id', runId).maybeSingle()
  if (runResult.error) {
    logApplyEvent('database-load-run', { runId, code: 'DATABASE_ERROR', error: runResult.error.message })
    return null
  }
  if (!runResult.data) return null
  const queueResult = await supabase.from('auto_apply_queue').select('*').eq('run_id', runId).order('created_at', { ascending: true })
  if (queueResult.error) {
    logApplyEvent('database-load-queue', { runId, code: 'DATABASE_ERROR', error: queueResult.error.message })
    return null
  }
  const run = asRun(runResult.data as Record<string, unknown>)
  const items = (queueResult.data ?? []).map((row) => asItem(row as Record<string, unknown>, run.id))
  await memoryStore.save(run, items)
  return { run, items }
}

export async function loadRunsFromDatabase(userId: string, config?: ServerConfig): Promise<StoredRun[]> {
  const supabase = database(config)
  if (!supabase || !userId) return []
  const runResult = await supabase
    .from('auto_apply_runs')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  if (runResult.error) {
    logApplyEvent('database-load-runs', { userId, code: 'DATABASE_ERROR', error: runResult.error.message })
    return []
  }
  const loaded: StoredRun[] = []
  for (const row of runResult.data ?? []) {
    const current = await loadRunFromDatabase(String((row as { id?: string }).id ?? ''), config)
    if (current) loaded.push(current)
  }
  return loaded
}

export async function persistRun(
  store: AutoApplyStore,
  run: AutoApplyRun,
  items: AutoApplyQueueItem[],
  config?: ServerConfig,
) {
  await withTimeout(
    store.save(run, items),
    DATABASE_TIMEOUT_MS,
    'DATABASE_TIMEOUT',
    'Saving the application timed out.',
  )
  const supabase = database(config)
  if (!supabase) return
  try {
    const runResult = await withTimeout(
      Promise.resolve(
        supabase.from('auto_apply_runs').upsert(
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
        ),
      ),
      DATABASE_TIMEOUT_MS,
      'DATABASE_TIMEOUT',
      'Saving the application timed out.',
    )
    if (runResult.error) {
      logApplyEvent('database-persist-run', {
        runId: run.id,
        userId: run.userId,
        code: 'DATABASE_ERROR',
        error: runResult.error.message,
      })
    }
    if (!items.length) return
    const queueResult = await withTimeout(
      Promise.resolve(
        supabase.from('auto_apply_queue').upsert(
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
        ),
      ),
      DATABASE_TIMEOUT_MS,
      'DATABASE_TIMEOUT',
      'Saving the application timed out.',
    )
    if (queueResult.error) {
      logApplyEvent('database-persist-queue', {
        runId: run.id,
        userId: run.userId,
        code: 'DATABASE_ERROR',
        error: queueResult.error.message,
      })
    }
  } catch (error) {
    logApplyEvent('database-persist-timeout', {
      runId: run.id,
      userId: run.userId,
      code: 'DATABASE_TIMEOUT',
      error,
    })
  }
}
