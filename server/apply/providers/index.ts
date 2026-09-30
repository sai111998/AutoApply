import type { ApplicationProvider, ApplicationProviderId, ApplicationProviderMatchInput } from './types'
import { hostnameOf } from './types'

const workday: ApplicationProvider = {
  id: 'workday',
  applyNames: [
    /^\s*apply\s*$/i,
    /^\s*apply now\s*$/i,
    /^\s*apply manually\s*$/i,
    /^\s*start application\s*$/i,
    /^\s*begin application\s*$/i,
  ],
  match({ hostname, url, html }) {
    return (
      /\.myworkdayjobs\.com$/i.test(hostname) ||
      /myworkdayjobs\.com/i.test(hostname) ||
      /\/wday\//i.test(url) ||
      /workday/i.test(html.slice(0, 4_000)) && /wd\d+\.myworkdayjobs/i.test(url)
    )
  },
}

const greenhouse: ApplicationProvider = {
  id: 'greenhouse',
  applyNames: [/^\s*apply\s*$/i, /^\s*submit application\s*$/i, /^\s*apply for this job\s*$/i],
  match({ hostname, url }) {
    return /greenhouse\.io$/i.test(hostname) || /boards\.greenhouse\.io/i.test(hostname) || /greenhouse\.io/i.test(url)
  },
}

const lever: ApplicationProvider = {
  id: 'lever',
  applyNames: [/^\s*apply for this job\s*$/i, /^\s*apply\s*$/i, /^\s*submit application\s*$/i],
  match({ hostname, url }) {
    return /jobs\.lever\.co$/i.test(hostname) || /lever\.co$/i.test(hostname) || /jobs\.lever\.co/i.test(url)
  },
}

const ashby: ApplicationProvider = {
  id: 'ashby',
  applyNames: [/^\s*apply\s*$/i, /^\s*apply now\s*$/i, /^\s*start application\s*$/i],
  match({ hostname, url }) {
    return /ashbyhq\.com$/i.test(hostname) || /jobs\.ashbyhq\.com/i.test(hostname) || /ashbyhq\.com/i.test(url)
  },
}

const icims: ApplicationProvider = {
  id: 'icims',
  applyNames: [/^\s*apply\s*$/i, /^\s*apply for this job online\s*$/i, /^\s*apply now\s*$/i],
  match({ hostname, url }) {
    return /icims\.com$/i.test(hostname) || /\.icims\.com/i.test(hostname) || /icims\.com/i.test(url)
  },
}

const smartrecruiters: ApplicationProvider = {
  id: 'smartrecruiters',
  applyNames: [/^\s*apply\s*$/i, /^\s*apply now\s*$/i],
  match({ hostname, url }) {
    return /smartrecruiters\.com$/i.test(hostname) || /smartrecruiters\.com/i.test(url)
  },
}

const workable: ApplicationProvider = {
  id: 'workable',
  applyNames: [/^\s*apply\s*$/i, /^\s*apply now\s*$/i],
  match({ hostname, url }) {
    return /(?:^|\.)workable\.com$/i.test(hostname) || /workable\.com/i.test(url)
  },
}

const oraclecloud: ApplicationProvider = {
  id: 'oraclecloud',
  applyNames: [/^\s*apply now\s*$/i, /^\s*apply\s*$/i, /^\s*start application\s*$/i],
  match({ hostname, url }) {
    return (
      /oraclecloud\.com$/i.test(hostname) ||
      /\.fa\.oraclecloud\.com/i.test(hostname) ||
      /\/hcmUI\/CandidateExperience/i.test(url)
    )
  },
}

const generic: ApplicationProvider = {
  id: 'generic',
  applyNames: [
    /^\s*apply now\s*$/i,
    /^\s*apply to (this )?job\s*$/i,
    /^\s*start (your )?application\s*$/i,
    /^\s*apply\s*$/i,
  ],
  match() {
    return true
  },
}

const PROVIDERS: ApplicationProvider[] = [workday, greenhouse, lever, ashby, icims, smartrecruiters, workable, oraclecloud, generic]

export function detectApplicationProvider(input: { url?: string | null; html?: string | null }): ApplicationProvider {
  const url = input.url?.trim() || ''
  const hostname = hostnameOf(url)
  const html = input.html ?? ''
  const matchInput: ApplicationProviderMatchInput = { url, hostname, html }
  return PROVIDERS.find((provider) => provider.id !== 'generic' && provider.match(matchInput)) ?? generic
}

export function applicationProviderId(input: { url?: string | null; html?: string | null }): ApplicationProviderId {
  return detectApplicationProvider(input).id
}

export { hostnameOf }
export type { ApplicationProvider, ApplicationProviderId }
