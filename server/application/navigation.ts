import { isFinalSubmitLabel } from '../apply/confirm'
import { isLegitimateApplyLabel, isLegitimateNextLabel } from '../apply/apply-action'

export type NavigationControl = 'apply' | 'next' | 'submit' | 'unknown'

export interface ApplicationStepState {
  step: number
  pageType: string
  url: string
  persistedAt: string
}

export function classifyNavigationControl(label: string): NavigationControl {
  if (isFinalSubmitLabel(label)) return 'submit'
  if (isLegitimateNextLabel(label)) return 'next'
  if (isLegitimateApplyLabel(label)) return 'apply'
  return 'unknown'
}

export function shouldAdvanceStep(input: { hasNext: boolean; hasSubmit: boolean; onReview: boolean }): boolean {
  return input.hasNext && !input.onReview && !(!input.hasNext && input.hasSubmit)
}

export function persistStepState(input: { step: number; pageType: string; url: string; now?: string }): ApplicationStepState {
  return {
    step: input.step,
    pageType: input.pageType,
    url: input.url,
    persistedAt: input.now ?? new Date().toISOString(),
  }
}

export function isBoundedStepTimeout(elapsedMs: number, limitMs = 16_000): boolean {
  return elapsedMs <= limitMs
}
