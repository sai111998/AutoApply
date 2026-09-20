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
}

export const APPLY_ACTION_NAMES = [
  /^\s*apply now\s*$/i,
  /^\s*apply to (this )?job\s*$/i,
  /^\s*start (your )?application\s*$/i,
  /^\s*apply for this job( online)?\s*$/i,
  /^\s*apply manually\s*$/i,
  /^\s*apply\s*$/i,
]

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
