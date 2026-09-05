import type { SupabaseClient } from '@supabase/supabase-js'
import type { Resume } from '@/types/domain'

export const RESUME_BUCKET = 'resumes'
export const SIGNED_URL_TTL_SECONDS = 120

export type ResumeFileKind = 'pdf' | 'text' | 'docx' | 'other'

export type ResumePreview = {
  resumeId: string
  fileName: string
  kind: ResumeFileKind
  signedUrl: string | null
  text: string | null
  canDownload: boolean
  error: string | null
}

export function resumeStoragePath(userId: string, resumeId: string, fileName: string): string {
  return `${userId}/${resumeId}/${fileName}`
}

export function isValidResumeStoragePath(path: string | null | undefined): path is string {
  if (!path?.trim()) return false
  const normalized = path.trim()
  if (normalized.includes('..') || normalized.startsWith('/') || normalized.includes('\\')) return false
  const parts = normalized.split('/').filter(Boolean)
  return parts.length >= 3
}

export function isOwnedResumePath(path: string, userId: string): boolean {
  return path === userId || path.startsWith(`${userId}/`)
}

export function resumeFileKind(fileName: string, fileType?: string | null): ResumeFileKind {
  const type = (fileType ?? '').toLowerCase()
  const name = fileName.toLowerCase()
  if (type.includes('pdf') || name.endsWith('.pdf')) return 'pdf'
  if (type.includes('text/plain') || name.endsWith('.txt')) return 'text'
  if (type.includes('wordprocessingml') || name.endsWith('.docx') || name.endsWith('.doc')) return 'docx'
  return 'other'
}

export function resumeFileKindLabel(kind: ResumeFileKind): string {
  if (kind === 'pdf') return 'PDF'
  if (kind === 'text') return 'TXT'
  if (kind === 'docx') return 'DOCX'
  return 'File'
}

export function userFacingStorageError(error: unknown, fallback = 'Unable to preview this resume.'): string {
  const message =
    error instanceof Error
      ? error.message
      : error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
        ? error.message
        : ''
  const status =
    error && typeof error === 'object' && 'statusCode' in error ? String((error as { statusCode?: unknown }).statusCode) : ''
  const text = `${status} ${message}`.toLowerCase()

  if (/bucket/.test(text) && /not found|missing/.test(text)) return 'Resume storage is not available.'
  if (/invalid path|malformed/.test(text)) return 'This resume has an invalid storage path.'
  if (/not found|no such file|404|object not found/.test(text)) return 'This resume file was not found in storage.'
  if (/42501|403|unauthorized|permission|row-level security|rls|not allowed/.test(text)) {
    return 'You do not have permission to open this resume.'
  }
  if (/signed url|sign/.test(text)) return 'Unable to create a secure preview link for this resume.'
  if (message.trim() && message.length < 180 && !/key|secret|bearer|stack/i.test(message)) return message
  return fallback
}

export async function createResumeSignedUrl(
  client: SupabaseClient,
  path: string,
  userId: string,
  options?: { download?: string | boolean },
): Promise<string> {
  if (!isValidResumeStoragePath(path)) {
    throw new Error('This resume has an invalid storage path.')
  }
  if (!isOwnedResumePath(path, userId)) {
    throw new Error('You do not have permission to open this resume.')
  }

  const result = options?.download
    ? await client.storage.from(RESUME_BUCKET).createSignedUrl(path, SIGNED_URL_TTL_SECONDS, {
        download: options.download,
      })
    : await client.storage.from(RESUME_BUCKET).createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
  if (result.error || !result.data?.signedUrl) {
    throw new Error(userFacingStorageError(result.error, 'Unable to create a secure preview link for this resume.'))
  }
  return result.data.signedUrl
}

export async function downloadResumeObject(client: SupabaseClient, path: string, userId: string): Promise<Blob> {
  if (!isValidResumeStoragePath(path)) {
    throw new Error('This resume has an invalid storage path.')
  }
  if (!isOwnedResumePath(path, userId)) {
    throw new Error('You do not have permission to open this resume.')
  }
  const result = await client.storage.from(RESUME_BUCKET).download(path)
  if (result.error || !result.data) {
    throw new Error(userFacingStorageError(result.error, 'Unable to download this resume.'))
  }
  return result.data
}

export async function resolveResumePreview(input: {
  client: SupabaseClient | null
  userId: string | undefined
  resume: Resume
  isDemo: boolean
}): Promise<ResumePreview> {
  const kind = resumeFileKind(input.resume.fileName, input.resume.fileType)
  const text = input.resume.parsedText.trim() || null
  const base = {
    resumeId: input.resume.id,
    fileName: input.resume.fileName,
    kind,
    signedUrl: null as string | null,
    text,
    canDownload: false,
    error: null as string | null,
  }

  if (input.userId && input.resume.userId && input.resume.userId !== input.userId) {
    return { ...base, error: 'You do not have permission to open this resume.' }
  }

  if (input.isDemo || !input.client || !input.userId) {
    if (kind === 'pdf' && !input.resume.storagePath) {
      return {
        ...base,
        canDownload: Boolean(text),
        error: text ? null : 'Unable to preview this resume.',
        kind: text ? 'text' : kind,
      }
    }
    if (text) return { ...base, canDownload: true, kind: kind === 'pdf' ? 'text' : kind }
    return { ...base, error: 'Unable to preview this resume.' }
  }

  if (!input.resume.storagePath) {
    if (text) return { ...base, canDownload: true, kind: 'text' }
    return { ...base, error: 'This resume has no stored file.' }
  }

  try {
    const signedUrl = await createResumeSignedUrl(input.client, input.resume.storagePath, input.userId)
    if (kind === 'pdf') {
      return { ...base, signedUrl, canDownload: true }
    }
    if (kind === 'text') {
      const blob = await downloadResumeObject(input.client, input.resume.storagePath, input.userId)
      const fileText = (await blob.text()).trim() || text
      return { ...base, signedUrl, text: fileText, canDownload: true, kind: 'text' }
    }
    return {
      ...base,
      signedUrl,
      text,
      canDownload: true,
      error: text ? null : 'Unable to preview this resume.',
    }
  } catch (error) {
    return {
      ...base,
      text,
      canDownload: Boolean(input.resume.storagePath),
      error: userFacingStorageError(error, 'Unable to preview this resume.'),
    }
  }
}
