import { inspectApplicationUrl } from './validate'

export const APPLICATION_KEYWORD_LABELS = [
  'Apply',
  'Apply now',
  'Apply to job',
  'Start application',
  'Continue',
  'Next',
  'Submit application',
  'First name',
  'Last name',
  'Email',
  'Phone',
  'Resume',
  'Upload resume',
] as const

export interface PageSnapshot {
  url: string
  finalUrl: string
  hostname: string | null
  title: string
  heading: string
  forms: number
  inputs: number
  buttons: number
  iframes: number
  iframeUrls: string[]
  keywords: Record<(typeof APPLICATION_KEYWORD_LABELS)[number], boolean>
  html: string
}

const KEYWORD_PATTERNS: Array<[(typeof APPLICATION_KEYWORD_LABELS)[number], RegExp]> = [
  ['Apply', /\bapply\b/i],
  ['Apply now', /apply now/i],
  ['Apply to job', /apply to (this )?job/i],
  ['Start application', /start (your )?application|apply manually|begin application/i],
  ['Continue', /\bcontinue\b/i],
  ['Next', /\bnext\b/i],
  ['Submit application', /submit application/i],
  ['First name', /first name/i],
  ['Last name', /last name/i],
  ['Email', /\bemail\b/i],
  ['Phone', /\bphone\b|\bmobile\b/i],
  ['Resume', /\bresume\b|\bcv\b/i],
  ['Upload resume', /upload (your )?(resume|cv)/i],
]

function decode(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
}

function visibleText(html: string): string {
  return decode(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function snapshotFromHtml(html: string, url = ''): PageSnapshot {
  const inspected = inspectApplicationUrl(url)
  const text = visibleText(html)
  const headingMatch = html.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i)
  const heading = headingMatch ? headingMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : ''
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : ''
  const iframeUrls = [...html.matchAll(/<iframe[^>]+src=['"]([^'"]+)['"]/gi)].map((match) => match[1])
  const keywords = Object.fromEntries(
    KEYWORD_PATTERNS.map(([label, pattern]) => [label, pattern.test(html) || pattern.test(text)]),
  ) as PageSnapshot['keywords']
  return {
    url,
    finalUrl: url,
    hostname: inspected.url?.hostname ?? null,
    title,
    heading,
    forms: (html.match(/<form\b/gi) || []).length,
    inputs: (html.match(/<(input|textarea|select)\b/gi) || []).length,
    buttons: (html.match(/<button\b|role=['"]button['"]/gi) || []).length,
    iframes: (html.match(/<iframe\b/gi) || []).length,
    iframeUrls,
    keywords,
    html,
  }
}

export function hasApplyControl(html: string, text = visibleText(html)): boolean {
  if (
    /<(button|a)[^>]*>[\s\S]{0,200}?\b(apply now|apply to (this )?job|start (your )?application|begin application|apply manually|\bapply\b)/i.test(
      html,
    )
  ) {
    return true
  }
  if (/aria-label=['"][^'"]*\b(apply now|start application|begin application|apply)\b/i.test(html)) return true
  if (
    /data-automation-id=['"][^'"]*(apply|adventureButton|jobPostingApplyButton|applyManually)[^'"]*['"]/i.test(html)
  ) {
    return true
  }
  return /\b(apply now|apply to (this )?job|start (your )?application|begin application|apply manually)\b/i.test(text)
}

export function pageVisibleText(html: string): string {
  return visibleText(html)
}
