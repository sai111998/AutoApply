/**
 * Built-in Auto Apply application-provider registry.
 *
 * Discovery site lists (LEVER_SITES, ASHBY_BOARDS, GREENHOUSE_BOARD_TOKENS) are
 * optional job-board sources. They are not required for Auto Apply capability.
 * Supported adapters are registered here automatically.
 */
import { detectApplicationProvider } from '../../apply/providers'
import { hostnameOf, WORKFLOW_SUPPORTED_PROVIDER_IDS, type ApplicationProviderId } from '../../apply/providers/types'
import { inspectApplicationUrl } from '../../apply/validate'
import { isSyntheticApplicationHost } from '../../apply/capability'
import { detectAtsAdapter } from '../../browser-worker/providers'
import type { AtsProviderAdapter } from '../../browser-worker/types'

export const REQUIRED_ADAPTER_METHODS = [
  'detect',
  'preflight',
  'openApplication',
  'findForm',
  'findApplication',
  'detectFields',
  'fillFields',
  'uploadResume',
  'nextStep',
  'detectBlockingState',
  'detectReview',
  'submit',
  'detectConfirmation',
] as const

export interface RegisteredApplicationProvider {
  id: ApplicationProviderId
  label: string
  workflowSupported: boolean
  adapter: AtsProviderAdapter | null
}

export interface ProviderDetectionResult {
  provider: ApplicationProviderId | 'unknown'
  confidence: 'high' | 'medium' | 'low'
  evidence: string[]
  supported: boolean
}

const LABELS: Record<ApplicationProviderId, string> = {
  workday: 'Workday',
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
  icims: 'iCIMS',
  smartrecruiters: 'SmartRecruiters',
  workable: 'Workable',
  oraclecloud: 'Oracle Cloud',
  generic: 'Generic',
}

const PROBE_URLS: Record<ApplicationProviderId, string> = {
  workday: 'https://acme.wd1.myworkdayjobs.com/en-US/careers',
  greenhouse: 'https://boards.greenhouse.io/acme/jobs/1',
  lever: 'https://jobs.lever.co/acme/abc',
  ashby: 'https://jobs.ashbyhq.com/acme/x',
  icims: 'https://acme.icims.com/jobs/1',
  smartrecruiters: 'https://jobs.smartrecruiters.com/acme/1',
  workable: 'https://apply.workable.com/acme/j/1',
  oraclecloud: 'https://acme.fa.oraclecloud.com/hcmUI/CandidateExperience',
  generic: 'https://jobs.example.com/apply',
}

function adapterHasWorkflow(adapter: AtsProviderAdapter | null): boolean {
  if (!adapter) return false
  const record = adapter as unknown as Record<string, unknown>
  return REQUIRED_ADAPTER_METHODS.every((method) => typeof record[method] === 'function')
}

function register(id: ApplicationProviderId): RegisteredApplicationProvider {
  const adapter = detectAtsAdapter({ url: PROBE_URLS[id], html: '' })
  const matches = adapter.id === id || (id === 'generic' && adapter.id === 'generic')
  const resolved = matches ? adapter : null
  return {
    id,
    label: LABELS[id],
    workflowSupported: (WORKFLOW_SUPPORTED_PROVIDER_IDS as readonly string[]).includes(id) && adapterHasWorkflow(resolved),
    adapter: resolved,
  }
}

const REGISTRY: RegisteredApplicationProvider[] = [
  register('workday'),
  register('greenhouse'),
  register('lever'),
  register('ashby'),
  register('icims'),
  register('smartrecruiters'),
  register('workable'),
  register('oraclecloud'),
  register('generic'),
]

export function applicationProviderRegistry(): RegisteredApplicationProvider[] {
  return [...REGISTRY]
}

export function isApplicationProviderRegistryPopulated(): boolean {
  return REGISTRY.some((item) => item.workflowSupported && item.adapter)
}

export function workflowSupportedProviderIds(): ApplicationProviderId[] {
  return REGISTRY.filter((item) => item.workflowSupported).map((item) => item.id)
}

export function lookupRegisteredProvider(id: string | null | undefined): RegisteredApplicationProvider | null {
  if (!id) return null
  return REGISTRY.find((item) => item.id === id) ?? null
}

export function detectRegisteredProvider(input: { url?: string | null; html?: string | null }): ProviderDetectionResult {
  const rawUrl = (input.url || '').trim()
  const inspected = inspectApplicationUrl(rawUrl)
  const url = inspected.url?.toString() || rawUrl
  const hostname = inspected.url?.hostname.toLowerCase() || hostnameOf(url)
  const html = input.html ?? ''
  const evidence: string[] = []
  if (!url) {
    return { provider: 'unknown', confidence: 'high', evidence: ['Application URL is missing.'], supported: false }
  }
  if (isSyntheticApplicationHost(hostname, url)) {
    evidence.push('Synthetic or controlled employer application host.')
    return { provider: 'generic', confidence: 'high', evidence, supported: true }
  }
  const detected = detectApplicationProvider({ url, html })
  if (html) evidence.push('Page HTML was inspected for provider markers.')
  else evidence.push('Provider inferred from application URL, not company name.')
  if (detected.id !== 'generic') evidence.push(`URL/DOM provider marker: ${detected.id}.`)
  const registered = lookupRegisteredProvider(detected.id)
  if (!registered || detected.id === 'generic') {
    return {
      provider: detected.id === 'generic' ? 'unknown' : detected.id,
      confidence: detected.id === 'generic' ? 'low' : 'medium',
      evidence,
      supported: false,
    }
  }
  return {
    provider: registered.id,
    confidence: html ? 'high' : 'medium',
    evidence,
    supported: registered.workflowSupported,
  }
}

export function providerAdapterFor(input: { url: string; html?: string }): AtsProviderAdapter {
  return detectAtsAdapter(input)
}
