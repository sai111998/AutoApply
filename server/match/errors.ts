export function publicErrorMessage(error: unknown, fallback = 'The analysis service failed. Please try again.'): string {
  const raw = error instanceof Error ? error.message : fallback
  if (/api[_-]?key|service.role|password|secret|bearer |supabase_service|stack/i.test(raw)) {
    return fallback
  }
  return raw
}
