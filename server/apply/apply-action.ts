import { detectApplicationProvider } from './providers'

type ClickableHandle = {
  count?: () => Promise<number>
  click?: (options?: { timeout?: number }) => Promise<unknown>
  innerText?: () => Promise<string>
  getAttribute?: (name: string) => Promise<string | null>
  first?: () => ClickableHandle
}

type RolePage = {
  getByRole?: (role: 'button' | 'link', options?: { name?: string | RegExp }) => ClickableHandle
  locator?: (selector: string) => ClickableHandle
}

export const APPLY_ACTION_NAMES = [
  /^\s*apply now\s*$/i,
  /^\s*apply to (this )?job\s*$/i,
  /^\s*start (your )?application\s*$/i,
  /^\s*begin application\s*$/i,
  /^\s*apply for this job( online)?\s*$/i,
  /^\s*apply manually\s*$/i,
  /^\s*apply\s*$/i,
]

export const SECONDARY_APPLY_NAMES = [/^\s*apply manually\s*$/i, /^\s*start your application\s*$/i]

export const NEXT_ACTION_NAMES = [/^\s*next\s*$/i, /^\s*continue\s*$/i, /^\s*save and continue\s*$/i]

export const REJECT_ACTION_NAMES = /linkedin|indeed|easy apply|glassdoor|workday account|continue working|view more|add job|share|sign in|log in|accept|decline/i

export function isLegitimateApplyLabel(label: string): boolean {
  const text = label.replace(/\s+/g, ' ').trim()
  if (!text || REJECT_ACTION_NAMES.test(text)) return false
  return APPLY_ACTION_NAMES.some((pattern) => pattern.test(text))
}

export function isLegitimateNextLabel(label: string): boolean {
  const text = label.replace(/\s+/g, ' ').trim()
  if (!text || REJECT_ACTION_NAMES.test(text) || /submit/i.test(text)) return false
  return NEXT_ACTION_NAMES.some((pattern) => pattern.test(text))
}

async function labelOf(locator: ClickableHandle, fallback: string): Promise<string> {
  try {
    const text = ((await locator.innerText?.()) ?? '').replace(/\s+/g, ' ').trim()
    if (text) return text
  } catch {
    // Fall through.
  }
  try {
    const aria = ((await locator.getAttribute?.('aria-label')) ?? '').trim()
    if (aria) return aria
  } catch {
    // Ignore.
  }
  return fallback
}

async function clickNamedControl(
  page: RolePage,
  names: RegExp[],
  accept: (label: string) => boolean,
): Promise<{ clicked: boolean; label: string | null }> {
  if (page.getByRole) {
    for (const name of names) {
      for (const role of ['button', 'link'] as const) {
        try {
          const raw = page.getByRole(role, { name })
          const locator = raw.first?.() ?? raw
          const count = locator.count ? await locator.count() : 1
          if (!count) continue
          const label = await labelOf(locator, name.source)
          if (!accept(label)) continue
          await locator.click?.({ timeout: 5_000 })
          return { clicked: true, label }
        } catch {
          // Try the next accessible name.
        }
      }
    }
  }
  return { clicked: false, label: null }
}

export async function clickApplyControl(
  page: RolePage,
  input: { url?: string; html?: string } = {},
): Promise<{ clicked: boolean; label: string | null }> {
  const provider = detectApplicationProvider(input)
  const names = [...provider.applyNames, ...APPLY_ACTION_NAMES]
  return clickNamedControl(page, names, isLegitimateApplyLabel)
}

export async function clickNextControl(page: RolePage): Promise<{ clicked: boolean; label: string | null }> {
  return clickNamedControl(page, NEXT_ACTION_NAMES, isLegitimateNextLabel)
}

export async function dismissBlockingNotices(page: RolePage): Promise<{ dismissed: boolean; label: string | null }> {
  const selectors = ['[data-automation-id="legalNoticeAcceptButton"]', '[data-automation-id="legalNoticeAccept"]']
  for (const selector of selectors) {
    try {
      const locator = page.locator?.(selector)
      const target = locator?.first?.() ?? locator
      if (!target) continue
      const count = target.count ? await target.count() : 1
      if (!count) continue
      await target.click?.({ timeout: 4_000 })
      return { dismissed: true, label: 'Accept cookies' }
    } catch {
      // Try the next known notice control.
    }
  }
  const accepted = await clickNamedControl(page, [/^\s*accept cookies\s*$/i, /^\s*accept all\s*$/i], (label) =>
    /accept cookies|accept all/i.test(label),
  )
  return { dismissed: accepted.clicked, label: accepted.label }
}

export async function clickSecondaryApplyControl(page: RolePage): Promise<{ clicked: boolean; label: string | null }> {
  return clickNamedControl(page, SECONDARY_APPLY_NAMES, (label) => SECONDARY_APPLY_NAMES.some((pattern) => pattern.test(label)))
}
