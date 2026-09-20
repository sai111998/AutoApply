import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pageVisibleText, snapshotFromHtml } from './page-snapshot'
import { inspectApplicationUrl } from './validate'

function sanitizedUrl(value: string | undefined): string | null {
  if (!value) return null
  const inspected = inspectApplicationUrl(value)
  return inspected.url ? `${inspected.url.origin}${inspected.url.pathname}` : null
}

const SECRET_RE = /password|token|authorization|secret|api[_-]?key|service\.role/i

export interface ApplyDebugPage {
  url?: (() => string) | string
  title?: () => Promise<string>
  content?: () => Promise<string>
  screenshot?: (options?: { path?: string; fullPage?: boolean }) => Promise<unknown>
}

export interface ApplyDebugExtras {
  initialUrl?: string
  finalUrl?: string
  frames?: number
  signals?: string[]
  fields?: string[]
  provider?: string
  applyControl?: boolean
}

export async function saveApplyDebugArtifact(
  page: ApplyDebugPage | undefined,
  reason: string,
  outputDir = path.join(process.cwd(), '.auto-apply-debug'),
  extras: ApplyDebugExtras = {},
): Promise<string | null> {
  if (process.env.NODE_ENV === 'production') return null
  if (!page) return null
  const rawUrl = typeof page.url === 'function' ? page.url() : page.url || ''
  const inspected = inspectApplicationUrl(rawUrl)
  const title = (await page.title?.().catch(() => '')) || ''
  const html = (await page.content?.().catch(() => '')) || ''
  const snapshot = snapshotFromHtml(html, extras.finalUrl || rawUrl)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const folder = path.join(outputDir, stamp)
  await mkdir(folder, { recursive: true })
  const summary = {
    reason: SECRET_RE.test(reason) ? '[redacted]' : reason,
    initialUrl: sanitizedUrl(extras.initialUrl),
    url: inspected.url ? `${inspected.url.origin}${inspected.url.pathname}` : null,
    finalUrl: sanitizedUrl(extras.finalUrl) ?? snapshot.finalUrl,
    hostname: inspected.url?.hostname ?? snapshot.hostname,
    title,
    frames: extras.frames ?? snapshot.iframes,
    forms: snapshot.forms,
    inputs: snapshot.inputs,
    buttons: snapshot.buttons,
    applyControl: extras.applyControl ?? snapshot.keywords.Apply,
    signals: extras.signals ?? [],
    fields: extras.fields ?? [],
    provider: extras.provider ?? null,
    text: pageVisibleText(html).slice(0, 800),
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
