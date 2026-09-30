export const APPLICATION_PROVIDER_IDS = [
  'workday',
  'greenhouse',
  'lever',
  'ashby',
  'icims',
  'smartrecruiters',
  'workable',
  'oraclecloud',
  'generic',
] as const

export const WORKFLOW_SUPPORTED_PROVIDER_IDS = ['workday', 'greenhouse', 'lever', 'ashby', 'icims'] as const

export type ApplicationProviderId = (typeof APPLICATION_PROVIDER_IDS)[number]

export interface ApplicationProviderMatchInput {
  url: string
  hostname: string
  html: string
}

export interface ApplicationProvider {
  id: ApplicationProviderId
  match(input: ApplicationProviderMatchInput): boolean
  applyNames: RegExp[]
}

export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}
