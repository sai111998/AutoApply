import { createClient } from '@supabase/supabase-js'
import { getServerConfig } from '../config'
import { V2Error } from './errors'
import { logV2 } from './log'
import type { V2Resume } from './types'

const RESUME_BUCKET = 'resumes'

interface ResumeRow {
  id: string
  file_name: string | null
  file_type: string | null
  version_label: string | null
  is_master: boolean | null
  storage_path: string | null
  parsed_text: string | null
}

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
  rtf: 'application/rtf',
}

function resumeMimeType(row: ResumeRow): string {
  const declared = row.file_type?.trim()
  if (declared && declared.includes('/')) return declared
  const extension = row.file_name?.split('.').pop()?.toLowerCase() ?? ''
  return MIME_BY_EXTENSION[extension] ?? 'application/octet-stream'
}

export async function loadV2Resume(userId: string, resumeId?: string | null): Promise<V2Resume> {
  const config = getServerConfig()
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
    throw new V2Error('RESUME_NOT_FOUND', 'Resume storage is not configured on this server.', 422)
  }
  const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  let query = supabase
    .from('resumes')
    .select('id,file_name,file_type,version_label,is_master,storage_path,parsed_text')
    .eq('user_id', userId)
  query = resumeId?.trim()
    ? query.eq('id', resumeId.trim())
    : query.order('is_master', { ascending: false }).order('created_at', { ascending: false })
  const { data, error } = await query.limit(1).maybeSingle()
  const row = data as ResumeRow | null
  if (error || !row) {
    throw new V2Error('RESUME_NOT_FOUND', 'No saved resume was found for this account.', 422)
  }
  if (!row.storage_path?.trim()) {
    throw new V2Error('RESUME_NOT_FOUND', 'The saved resume has no stored file to upload.', 422)
  }
  const download = await supabase.storage.from(RESUME_BUCKET).download(row.storage_path)
  if (download.error || !download.data) {
    throw new V2Error('RESUME_NOT_FOUND', 'The saved resume file could not be downloaded.', 422)
  }
  const buffer = Buffer.from(await download.data.arrayBuffer())
  if (!buffer.length) {
    throw new V2Error('RESUME_NOT_FOUND', 'The saved resume file is empty.', 422)
  }
  const resume: V2Resume = {
    versionId: row.id,
    versionName: row.is_master ? 'Master' : row.version_label?.trim() || row.file_name?.trim() || 'Resume',
    fileName: row.file_name?.trim() || `resume.${resumeMimeType(row) === 'application/pdf' ? 'pdf' : 'txt'}`,
    mimeType: resumeMimeType(row),
    buffer,
    text: row.parsed_text ?? '',
  }
  logV2('RESUME_LOADED', { resumeId: resume.versionId, bytes: buffer.length, mimeType: resume.mimeType, hasText: Boolean(resume.text.trim()) })
  return resume
}
