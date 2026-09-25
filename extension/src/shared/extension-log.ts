const SECRET_KEY = /password|passwd|secret|token|authorization|api[-_]?key|credential|cookie/i

export function sanitizeExtensionLogDetails(details?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!details) return undefined
  const next: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(details)) {
    if (SECRET_KEY.test(key)) continue
    if (typeof value === 'string' && SECRET_KEY.test(value) && value.length > 16) continue
    next[key] = value
  }
  return next
}

export function extensionLog(message: string, details?: Record<string, unknown>): string {
  const safe = sanitizeExtensionLogDetails(details)
  const line = safe && Object.keys(safe).length ? `${message} ${JSON.stringify(safe)}` : message
  console.info(line)
  return line
}
