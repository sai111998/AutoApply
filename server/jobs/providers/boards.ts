import { queryTokensMatch } from '../query-expand'

export function parseCsvBoards(value: string | string[] | null | undefined): string[] {
  const items = Array.isArray(value) ? value : (value ?? '').split(',')
  return [...new Set(items.map((item) => item.trim().toLowerCase()).filter(Boolean))]
}

export function displayBoardName(token: string): string {
  const cleaned = token.replace(/[-_]+/g, ' ').trim()
  if (!cleaned) return token
  return cleaned.replace(/\b\w/g, (char) => char.toUpperCase())
}

export function matchesProviderQuery(
  job: { title: string; company: string; description?: string | null; location?: string | null },
  params: { q?: string; keywords?: string; location?: string },
): boolean {
  const query = (params.q || params.keywords || '').trim()
  if (query && !queryTokensMatch(job, query)) return false
  const location = params.location?.trim().toLowerCase() ?? ''
  if (location && !/^(united states|usa|us|u\.s\.?|remote|nationwide|anywhere)$/i.test(location)) {
    const haystack = `${job.location ?? ''} ${job.description ?? ''}`.toLowerCase()
    const city = location.split(',')[0]?.trim()
    if (city && !haystack.includes(city)) return false
  }
  return true
}

export function parseGreenhouseBoardUrl(value: string | null | undefined): { boardToken: string; jobId: string | null } | null {
  const raw = value?.trim() ?? ''
  if (!raw) return null
  try {
    const url = new URL(raw)
    const host = url.hostname.toLowerCase()
    if (!/(?:^|\.)greenhouse\.io$/.test(host)) return null
    const api = url.pathname.match(/\/v1\/boards\/([^/]+)(?:\/jobs\/(\d+))?/i)
    if (api) return { boardToken: decodeURIComponent(api[1]).toLowerCase(), jobId: api[2] ?? null }
    const hosted = url.pathname.match(/^\/([^/]+)(?:\/jobs\/(\d+))?/i)
    if (hosted) return { boardToken: decodeURIComponent(hosted[1]).toLowerCase(), jobId: hosted[2] ?? null }
    return null
  } catch {
    return null
  }
}

export function parseLeverSiteUrl(value: string | null | undefined): { site: string; jobId: string | null } | null {
  const raw = value?.trim() ?? ''
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (!/(?:^|\.)lever\.co$/.test(url.hostname.toLowerCase())) return null
    const match = url.pathname.match(/^\/([^/]+)(?:\/([^/]+))?/i)
    if (!match || match[1] === 'v0') return null
    return { site: decodeURIComponent(match[1]).toLowerCase(), jobId: match[2] && match[2] !== 'apply' ? match[2] : null }
  } catch {
    return null
  }
}

export function parseAshbyBoardUrl(value: string | null | undefined): { board: string; jobId: string | null } | null {
  const raw = value?.trim() ?? ''
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (!/(?:^|\.)ashbyhq\.com$/.test(url.hostname.toLowerCase())) return null
    const api = url.pathname.match(/\/posting-api\/job-board\/([^/]+)/i)
    if (api) return { board: decodeURIComponent(api[1]).toLowerCase(), jobId: null }
    const hosted = url.pathname.match(/^\/([^/]+)(?:\/([^/]+))?/i)
    if (!hosted) return null
    return { board: decodeURIComponent(hosted[1]).toLowerCase(), jobId: hosted[2] ?? null }
  } catch {
    return null
  }
}
