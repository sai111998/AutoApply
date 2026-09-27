import type { V2Provider } from './types'

export type V2ApplicationSystem = 'Lever' | 'Greenhouse' | 'Other'

export type V2UnsupportedSystemReason = 'WORKDAY' | 'EXTERNAL_PORTAL'

// Recruiting portals and job boards that need accounts or multi-page wizards instead of a simple employer form.
const EXTERNAL_PORTAL_HOST =
  /(^|\.)(icims\.com|taleo\.net|successfactors\.(com|eu)|oraclecloud\.com|brassring\.com|workforcenow\.adp\.com|ultipro\.com|ukg\.net|linkedin\.com|indeed\.com|dice\.com|ziprecruiter\.com|glassdoor\.com|monster\.com)$/i

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

export function detectV2Provider(url: string, html: string): V2Provider {
  const host = hostOf(url)
  const haystack = `${host} ${html.slice(0, 20000)}`.toLowerCase()
  if (host.includes('myworkdayjobs') || host.includes('workday')) return 'workday'
  if (host.includes('greenhouse') || haystack.includes('boards.greenhouse.io')) return 'greenhouse'
  if (host.includes('lever.co')) return 'lever'
  if (host.includes('ashby')) return 'ashby'
  if (host.includes('icims')) return 'icims'
  if (host.includes('smartrecruiters')) return 'smartrecruiters'
  if (host.includes('workable')) return 'workable'
  if (/workday/.test(haystack)) return 'workday'
  if (/greenhouse/.test(haystack)) return 'greenhouse'
  if (/lever\.co/.test(haystack)) return 'lever'
  if (/ashby/.test(haystack)) return 'ashby'
  if (/icims/.test(haystack)) return 'icims'
  return 'generic'
}

export function v2ApplicationSystem(provider: V2Provider | null | undefined): V2ApplicationSystem {
  if (provider === 'lever') return 'Lever'
  if (provider === 'greenhouse') return 'Greenhouse'
  return 'Other'
}

// Host only: job descriptions often mention other systems, so page text is not evidence of where the form lives.
export function unsupportedV2System(url: string): { reason: V2UnsupportedSystemReason; detail: string } | null {
  const host = hostOf(url)
  if (host.includes('workday')) {
    return { reason: 'WORKDAY', detail: 'Workday applications are not supported by Apply Now yet.' }
  }
  if (EXTERNAL_PORTAL_HOST.test(host)) {
    return { reason: 'EXTERNAL_PORTAL', detail: `The application continues on an external portal (${host}) that Apply Now does not support.` }
  }
  return null
}
