import type { AutoApplyProfile, AutoApplyQueueItem, AutoApplyQueueStatus } from '../apply/types'
import type { ApplicationProviderId } from '../apply/providers/types'

export const BROWSER_SESSION_STATES = [
  'queued',
  'opening',
  'job_page',
  'application_page',
  'provider_detected',
  'filling',
  'needs_user_input',
  'login_required',
  'mfa_required',
  'captcha_required',
  'ready_for_review',
  'submitting',
  'submitted',
  'failed',
  'skipped',
  'cancelled',
] as const

export type BrowserSessionState = (typeof BROWSER_SESSION_STATES)[number]

export const INTERVENTION_REASONS = [
  'LOGIN_REQUIRED',
  'MFA_REQUIRED',
  'CAPTCHA_REQUIRED',
  'UNKNOWN_REQUIRED_QUESTION',
] as const

export type InterventionReason = (typeof INTERVENTION_REASONS)[number]

export interface BrowserApplicationSession {
  applicationId: string | null
  itemId: string
  runId: string
  jobId: string
  resumeVersionId: string | null
  browserContextId: string
  pageId: string | null
  provider: ApplicationProviderId | 'unknown'
  initialUrl: string
  currentUrl: string
  redirectUrls: string[]
  state: BrowserSessionState
  failureReason: string | null
  createdAt: string
  updatedAt: string
}

export interface UserIntervention {
  applicationId: string
  itemId: string
  reason: InterventionReason
  currentUrl: string
  createdAt: string
  updatedAt: string
  resolvedAt: string | null
}

export interface BrowserJobRequest {
  runId: string
  itemId: string
  userId: string
  profile: AutoApplyProfile
  item: AutoApplyQueueItem
}

export interface AtsProviderAdapter {
  id: ApplicationProviderId | 'unknown'
  detect(input: { url: string; html: string }): boolean
  preflight(input: { url: string; html?: string; applicationUrl?: string }): import('../apply/preflight').ApplicationPreflightResult
  openApplication(page: BrowserPageLike): Promise<boolean>
  findForm(html: string): boolean
  findApplication(html: string): boolean
  detectFields(html: string): string[]
  fillFields(page: BrowserPageLike, values: Record<string, string>): Promise<string[]>
  uploadResume(page: BrowserPageLike, resume: { fileName: string; mimeType: string; buffer: Buffer }): Promise<boolean>
  advanceStep(page: BrowserPageLike): Promise<boolean>
  nextStep(page: BrowserPageLike): Promise<boolean>
  detectBlockingState(html: string): InterventionReason | 'APPLICATION_PAGE_BLOCKED' | null
  detectReview(html: string): boolean
  submit(page: BrowserPageLike): Promise<boolean>
  detectConfirmation(input: { html: string; title?: string; url?: string }): boolean
}

export interface BrowserPageLike {
  goto: (url: string, options?: { waitUntil?: string; timeout?: number }) => Promise<unknown>
  content: () => Promise<string>
  url?: (() => string) | string
  title?: () => Promise<string>
  waitForLoadState?: (state?: string, options?: { timeout?: number }) => Promise<unknown>
  waitForTimeout?: (ms: number) => Promise<unknown>
    fill?: (selector: string, value: string, options?: { timeout?: number }) => Promise<unknown>
  click?: (selector: string) => Promise<unknown>
  locator?: (selector: string) => {
    count?: () => Promise<number>
    fill?: (value: string, options?: { timeout?: number }) => Promise<unknown>
    click?: (options?: { timeout?: number }) => Promise<unknown>
    setInputFiles?: (files: unknown) => Promise<unknown>
    first: () => {
      count?: () => Promise<number>
      fill?: (value: string, options?: { timeout?: number }) => Promise<unknown>
      click?: (options?: { timeout?: number }) => Promise<unknown>
      setInputFiles?: (files: unknown) => Promise<unknown>
    }
  }
  getByRole?: (role: 'button' | 'link', options?: { name?: string | RegExp }) => {
    count?: () => Promise<number>
    click?: (options?: { timeout?: number }) => Promise<unknown>
    innerText?: () => Promise<string>
    first?: () => {
      count?: () => Promise<number>
      click?: (options?: { timeout?: number }) => Promise<unknown>
      innerText?: () => Promise<string>
    }
  }
  close?: () => Promise<unknown>
  evaluate?: (fn: () => unknown) => Promise<unknown>
  frames?: () => Array<{
    url?: (() => string) | string
    title?: () => Promise<string>
    content?: () => Promise<string>
  }>
  screenshot?: (options?: { path?: string; fullPage?: boolean }) => Promise<unknown>
  waitForURL?: (url: string | RegExp | ((value: URL) => boolean), options?: { timeout?: number }) => Promise<unknown>
}

export function queueStatusFromSession(state: BrowserSessionState): AutoApplyQueueStatus {
  if (state === 'job_page' || state === 'opening') return 'opening'
  if (state === 'application_page' || state === 'provider_detected') return 'filling'
  if (state === 'ready_for_review') return 'ready_for_submission'
  if (state === 'queued') return 'queued'
  if (state === 'filling') return 'filling'
  if (state === 'needs_user_input') return 'needs_user_input'
  if (state === 'login_required') return 'login_required'
  if (state === 'mfa_required') return 'mfa_required'
  if (state === 'captcha_required') return 'captcha_required'
  if (state === 'submitting') return 'submitting'
  if (state === 'submitted') return 'submitted'
  if (state === 'skipped') return 'skipped'
  if (state === 'cancelled') return 'cancelled'
  return 'failed'
}
