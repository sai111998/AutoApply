import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { inspectApplicationUrl } from './validate'

const SECRET_RE = /password|token|authorization|secret|api[_-]?key|service\.role/i

export interface ApplyDebugPage {
  url?: (() => string) | string
  title?: () => Promise<string>
  content?: () => Promise<string>
  screenshot?: (options?: { path?: string; fullPage?: boolean }) => Promise<unknown>
}

export async function saveApplyDebugArtifact(
  page: ApplyDebugPage | undefined,
  reason: string,
  outputDir = path.join(process.cwd(), '.auto-apply-debug'),
): Promise<string | null> {
  if (process.env.NODE_ENV === 'production') return null
  if (!page) return null
  const rawUrl = typeof page.url === 'function' ? page.url() : page.url || ''
  const inspected = inspectApplicationUrl(rawUrl)
  const title = (await page.title?.().catch(() => '')) || ''
  const html = (await page.content?.().catch(() => '')) || ''
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const folder = path.join(outputDir, stamp)
  await mkdir(folder, { recursive: true })
  const summary = {
    reason: SECRET_RE.test(reason) ? '[redacted]' : reason,
    url: inspected.url ? `${inspected.url.origin}${inspected.url.pathname}` : null,
    hostname: inspected.url?.hostname ?? null,
    title,
    capturedAt: new Date().toISOString(),
  }
  await writeFile(path.join(folder, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  const sanitized = html
    .replace(/<input[^>]*type=['"]password['"][^>]*>/gi, '<input type="password" />')
    .slice(0, 200_000)
  await writeFile(path.join(folder, 'snippet.html'), sanitized)
  try {
    await page.screenshot?.({ path: path.join(folder, 'page.png'), fullPage: false })
  } catch {
    // Screenshots are optional.
  }
  return folder
}
