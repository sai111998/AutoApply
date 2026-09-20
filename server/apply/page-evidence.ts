import { pageVisibleText, snapshotFromHtml } from './page-snapshot'
import { hostnameOf } from './providers/types'
import { inspectApplicationUrl } from './validate'

export interface FrameEvidence {
  url: string
  title: string
  visibleText: string
  inputs: number
  buttons: number
  fileInputs: number
  forms: number
}

export interface PageEvidence {
  url: string
  hostname: string | null
  title: string
  visibleText: string
  forms: number
  inputs: number
  buttons: number
  links: number
  iframes: number
  fileInputs: number
  iframeUrls: string[]
  frames: FrameEvidence[]
}

export interface BrowserEvidencePage {
  url?: (() => string) | string
  title?: () => Promise<string>
  content?: () => Promise<string>
  frames?: () => Array<{
    url?: (() => string) | string
    title?: () => Promise<string>
    content?: () => Promise<string>
  }>
  evaluate?: (fn: () => unknown) => Promise<unknown>
}

function count(html: string, pattern: RegExp): number {
  return (html.match(pattern) || []).length
}

function frameUrl(frame: { url?: (() => string) | string }): string {
  if (!frame.url) return ''
  return typeof frame.url === 'function' ? frame.url() : frame.url
}

export function evidenceFromHtml(html: string, url = '', extras: { title?: string; frames?: FrameEvidence[] } = {}): PageEvidence {
  const snapshot = snapshotFromHtml(html, url)
  const inspected = inspectApplicationUrl(url)
  return {
    url,
    hostname: inspected.url?.hostname ?? hostnameOf(url) ?? snapshot.hostname,
    title: extras.title || snapshot.title,
    visibleText: pageVisibleText(html).slice(0, 1_200),
    forms: snapshot.forms,
    inputs: snapshot.inputs,
    buttons: snapshot.buttons,
    links: count(html, /<a\b/gi),
    iframes: snapshot.iframes,
    fileInputs: count(html, /type=['"]file['"]/gi),
    iframeUrls: snapshot.iframeUrls,
    frames: extras.frames ?? [],
  }
}

export async function collectFrameEvidence(
  page: BrowserEvidencePage,
): Promise<FrameEvidence[]> {
  const frames: FrameEvidence[] = []
  for (const frame of page.frames?.() ?? []) {
    const url = frameUrl(frame)
    if (!url || /hcaptcha|recaptcha|turnstile|about:blank/i.test(url)) continue
    try {
      const html = (await frame.content?.()) ?? ''
      if (html.trim().length < 40) continue
      const title = (await frame.title?.().catch(() => '')) || ''
      frames.push({
        url,
        title,
        visibleText: pageVisibleText(html).slice(0, 400),
        inputs: count(html, /<(input|textarea|select)\b/gi),
        buttons: count(html, /<button\b|role=['"]button['"]/gi),
        fileInputs: count(html, /type=['"]file['"]/gi),
        forms: count(html, /<form\b/gi),
      })
    } catch {
      frames.push({
        url,
        title: '',
        visibleText: '',
        inputs: 0,
        buttons: 0,
        fileInputs: 0,
        forms: 0,
      })
    }
  }
  return frames
}

export async function collectLivePageEvidence(page: BrowserEvidencePage, fallbackUrl: string): Promise<PageEvidence> {
  const url = typeof page.url === 'function' ? page.url() : page.url || fallbackUrl
  const title = (await page.title?.().catch(() => '')) || ''
  const html = (await page.content?.().catch(() => '')) || ''
  const frames = await collectFrameEvidence(page)
  return evidenceFromHtml(html, url, { title, frames })
}

export async function documentsFromEvidencePage(
  page: BrowserEvidencePage,
  fallbackUrl: string,
): Promise<Array<{ html: string; url: string; inIframe?: boolean }>> {
  const currentUrl = typeof page.url === 'function' ? page.url() : page.url || fallbackUrl
  const html = (await page.content?.().catch(() => '')) || ''
  const documents = [{ html, url: currentUrl, inIframe: false }]
  for (const frame of page.frames?.() ?? []) {
    const url = frameUrl(frame)
    if (!url || /hcaptcha|recaptcha|turnstile|about:blank/i.test(url)) continue
    try {
      const frameHtml = (await frame.content?.()) ?? ''
      if (frameHtml.trim().length > 40) documents.push({ html: frameHtml, url, inIframe: true })
    } catch {
      // Cross-origin frames are not readable.
    }
  }
  return documents
}
