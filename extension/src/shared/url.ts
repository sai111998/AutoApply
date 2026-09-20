export function inspectApplicationUrl(value: string | null | undefined): {
  ok: boolean
  url: URL | null
  reason: string | null
} {
  const raw = value?.trim() ?? ''
  if (!raw) return { ok: false, url: null, reason: 'This listing does not include a valid application URL.' }
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { ok: false, url: null, reason: 'This listing does not include a valid application URL.' }
    }
    if (!url.hostname) return { ok: false, url: null, reason: 'This listing does not include a valid application URL.' }
    return { ok: true, url, reason: null }
  } catch {
    return { ok: false, url: null, reason: 'This listing does not include a valid application URL.' }
  }
}

export function originPattern(url: URL): string {
  return `${url.origin}/*`
}
