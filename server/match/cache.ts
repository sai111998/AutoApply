import { createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import type { ServerConfig } from '../config'
import type { ResumeProfile } from './types'

const memory = new Map<string, ResumeProfile>()

export function hashResumeText(text: string): string {
  return createHash('sha256').update(text.trim()).digest('hex')
}

export async function loadResumeProfile(
  config: ServerConfig,
  resumeId: string | undefined,
  resumeHash: string,
): Promise<ResumeProfile | null> {
  const memoryHit = memory.get(resumeHash)
  if (memoryHit) return memoryHit

  if (!resumeId || !config.supabaseUrl || !config.supabaseServiceRoleKey) return null

  const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const result = await supabase
    .from('resumes')
    .select('evidence_profile, evidence_hash')
    .eq('id', resumeId)
    .maybeSingle()

  if (result.error || !result.data) return null
  if (result.data.evidence_hash !== resumeHash || !result.data.evidence_profile) return null
  const profile = result.data.evidence_profile as ResumeProfile
  memory.set(resumeHash, profile)
  return profile
}

export async function saveResumeProfile(
  config: ServerConfig,
  resumeId: string | undefined,
  resumeHash: string,
  profile: ResumeProfile,
): Promise<void> {
  memory.set(resumeHash, profile)
  if (!resumeId || !config.supabaseUrl || !config.supabaseServiceRoleKey) return

  const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  await supabase
    .from('resumes')
    .update({ evidence_profile: profile, evidence_hash: resumeHash })
    .eq('id', resumeId)
}

export function clearResumeProfileCache() {
  memory.clear()
}
