import type { ExtensionProviderId } from '../shared/types'

export interface ProviderDetectInput {
  url: string
  hostname: string
  html: string
}

export interface ApplicationProvider {
  id: Exclude<ExtensionProviderId, 'unknown'>
  detect(context: ProviderDetectInput): boolean
}

export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}
