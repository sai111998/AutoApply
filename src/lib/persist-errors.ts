export function persistErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : null
}

export function persistErrorText(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message
  }
  return ''
}

export function isMissingColumnError(error: { message?: string; code?: string } | null | unknown): boolean {
  const message = persistErrorText(error)
  const code = persistErrorCode(error)
  return code === 'PGRST204' || /could not find the '[\w]+' column/i.test(message) || /schema cache/i.test(message)
}

export function isForeignKeyError(error: { message?: string; code?: string } | null | unknown): boolean {
  const message = persistErrorText(error)
  const code = persistErrorCode(error)
  return code === '23503' || /foreign key|violates foreign key/i.test(message)
}

export function isRlsError(error: unknown): boolean {
  const message = persistErrorText(error)
  const code = persistErrorCode(error)
  return code === '42501' || /row-level security|rls/i.test(message)
}

export function userFacingPersistError(error: unknown, fallback: string): string {
  const message = persistErrorText(error)
  const code = persistErrorCode(error)
  console.info('[tailor] persist-error', {
    code,
    kind: isRlsError(error) ? 'rls' : isForeignKeyError(error) ? 'foreign_key' : isMissingColumnError(error) ? 'schema' : 'error',
  })
  if (isRlsError(error)) {
    return 'You do not have permission to save this resume version. Sign in again and try Keep This Resume.'
  }
  if (isMissingColumnError(error)) {
    return 'Saved resume versions need an updated database schema. Run the latest Supabase migrations and try again.'
  }
  if (isForeignKeyError(error)) {
    return 'This tailored resume could not be linked to the saved job. Analyze the job again, then keep the resume.'
  }
  if (message.trim() && message.length < 180 && !/key|secret|bearer|stack/i.test(message)) return message
  return fallback
}
