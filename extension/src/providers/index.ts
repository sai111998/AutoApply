import type { ExtensionProviderId } from '../shared/types'
import { hostnameOf, type ApplicationProvider, type ProviderDetectInput } from './types'

const workday: ApplicationProvider = {
  id: 'workday',
  detect({ hostname, url, html }) {
    return (
      /\.myworkdayjobs\.com$/i.test(hostname) ||
      /myworkdayjobs\.com/i.test(hostname) ||
      /\/wday\//i.test(url) ||
      (/workday/i.test(html.slice(0, 4_000)) && /wd\d+\.myworkdayjobs/i.test(url))
    )
  },
}

const greenhouse: ApplicationProvider = {
  id: 'greenhouse',
  detect({ hostname, url }) {
    return /greenhouse\.io$/i.test(hostname) || /boards\.greenhouse\.io/i.test(hostname) || /greenhouse\.io/i.test(url)
  },
}

const lever: ApplicationProvider = {
  id: 'lever',
  detect({ hostname, url }) {
    return /jobs\.lever\.co$/i.test(hostname) || /lever\.co$/i.test(hostname) || /jobs\.lever\.co/i.test(url)
  },
}

const ashby: ApplicationProvider = {
  id: 'ashby',
  detect({ hostname, url }) {
    return /ashbyhq\.com$/i.test(hostname) || /jobs\.ashbyhq\.com/i.test(hostname) || /ashbyhq\.com/i.test(url)
  },
}

const icims: ApplicationProvider = {
  id: 'icims',
  detect({ hostname, url }) {
    return /icims\.com$/i.test(hostname) || /\.icims\.com/i.test(hostname) || /icims\.com/i.test(url)
  },
}

const named: ApplicationProvider[] = [workday, greenhouse, lever, ashby, icims]

export function detectApplicationProvider(input: { url?: string | null; html?: string | null }): {
  id: ExtensionProviderId
  known: boolean
} {
  const url = input.url?.trim() || ''
  const hostname = hostnameOf(url)
  const html = input.html ?? ''
  const context: ProviderDetectInput = { url, hostname, html }
  const match = named.find((provider) => provider.detect(context))
  if (match) return { id: match.id, known: true }
  return { id: 'unknown', known: false }
}

export { hostnameOf }
export type { ApplicationProvider, ProviderDetectInput }
