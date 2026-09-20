import { clickApplyControl, clickNextControl, isLegitimateApplyLabel } from '../apply/apply-action'
import { inspectApplicationPage } from '../apply/detect'
import { detectSubmissionConfirmation } from '../apply/confirm'
import { detectApplicationProvider } from '../apply/providers'
import { analyzeApplicationSurface } from '../apply/surface'
import type { ApplicationProviderId } from '../apply/providers/types'
import type { AtsProviderAdapter, BrowserPageLike, InterventionReason } from './types'

const FIELD_SELECTORS: Array<[string, string[]]> = [
  ['email', ['input[type="email"]', 'input[name="email"]', 'input[autocomplete="email"]']],
  ['firstName', ['input[name="first_name"]', 'input[name="firstName"]', 'input[autocomplete="given-name"]', 'input[id="first-name"]']],
  ['lastName', ['input[name="last_name"]', 'input[name="lastName"]', 'input[autocomplete="family-name"]', 'input[id="last-name"]']],
  ['fullName', ['input[name="name"]', 'input[autocomplete="name"]', 'input[name="full_name"]']],
  ['phone', ['input[type="tel"]', 'input[name="phone"]', 'input[autocomplete="tel"]']],
  ['address', ['input[autocomplete="street-address"]', 'input[name="address"]']],
  ['city', ['input[name="city"]', 'input[autocomplete="address-level2"]']],
  ['state', ['input[name="state"]', 'input[autocomplete="address-level1"]']],
  ['zip', ['input[name="zip"]', 'input[autocomplete="postal-code"]']],
  ['linkedin', ['input[name="linkedin"]', 'input[id="linkedin"]']],
  ['github', ['input[name="github"]']],
  ['workAuthorization', ['select[name="work_authorization"]', 'select[id="work-auth"]', 'input[name="work_authorization"]']],
  ['sponsorship', ['select[name="sponsorship"]', 'input[name="sponsorship"]']],
  ['yearsExperience', ['input[name="years_experience"]', 'input[name="experience"]']],
  ['salary', ['input[name="salary"]', 'input[name="compensation"]']],
]

async function fillSelectors(page: BrowserPageLike, selectors: string[], value: string) {
  if (!value.trim()) return false
  for (const selector of selectors) {
    try {
      const locator = page.locator?.(selector).first()
      if (locator?.count) {
        if ((await locator.count()) === 0) continue
        await locator.fill?.(value, { timeout: 1_500 })
        return true
      }
      await page.fill?.(selector, value)
      return true
    } catch {
      // Keep looking for a mapped field.
    }
  }
  return false
}

function blockingState(html: string): InterventionReason | 'APPLICATION_PAGE_BLOCKED' | null {
  const inspection = inspectApplicationPage(html)
  if (inspection.status === 'captcha_required') return 'CAPTCHA_REQUIRED'
  if (inspection.status === 'mfa_required') return 'MFA_REQUIRED'
  if (inspection.status === 'login_required') return 'LOGIN_REQUIRED'
  if (inspection.status === 'automation_blocked') return 'APPLICATION_PAGE_BLOCKED'
  return null
}

function createAdapter(id: ApplicationProviderId): AtsProviderAdapter {
  return {
    id,
    detect(input) {
      return detectApplicationProvider(input).id === id
    },
    async openApplication(page) {
      const clicked = await clickApplyControl(page)
      return clicked.clicked && isLegitimateApplyLabel(clicked.label || 'Apply')
    },
    detectFields(html) {
      return analyzeApplicationSurface(html).fields
    },
    async fillFields(page, values) {
      const filled: string[] = []
      for (const [field, selectors] of FIELD_SELECTORS) {
        const value = values[field]
        if (!value) continue
        if (await fillSelectors(page, selectors, value)) filled.push(field)
      }
      return filled
    },
    async uploadResume(page, resume) {
      try {
        const locator = page.locator?.('input[type="file"]').first()
        if (!locator?.setInputFiles) return false
        if (locator.count && (await locator.count()) === 0) return false
        await locator.setInputFiles({
          name: resume.fileName,
          mimeType: resume.mimeType,
          buffer: resume.buffer,
        })
        return true
      } catch {
        return false
      }
    },
    async advanceStep(page) {
      const clicked = await clickNextControl(page)
      return clicked.clicked
    },
    detectBlockingState(html) {
      return blockingState(html)
    },
    detectReview(html) {
      return /review your application|review and submit/i.test(html)
    },
    async submit(page) {
      const clicked = page.getByRole?.('button', { name: /^(submit( my)? application|send application|submit)$/i })
      const target = clicked?.first?.() ?? clicked
      const count = target?.count ? await target.count() : 0
      if (!count) return false
      await target?.click?.({ timeout: 5_000 })
      return true
    },
    detectConfirmation(input) {
      return detectSubmissionConfirmation(input).detected
    },
  }
}

const ADAPTERS: AtsProviderAdapter[] = [
  createAdapter('workday'),
  createAdapter('greenhouse'),
  createAdapter('lever'),
  createAdapter('ashby'),
  createAdapter('icims'),
  createAdapter('oraclecloud'),
  createAdapter('generic'),
]

export function detectAtsAdapter(input: { url: string; html?: string }): AtsProviderAdapter {
  const html = input.html ?? ''
  return ADAPTERS.find((adapter) => adapter.id !== 'generic' && adapter.detect({ url: input.url, html })) ?? ADAPTERS[ADAPTERS.length - 1]
}

export function supportedAtsProviders(): Array<ApplicationProviderId | 'unknown'> {
  return ADAPTERS.map((adapter) => adapter.id)
}

export { FIELD_SELECTORS }
