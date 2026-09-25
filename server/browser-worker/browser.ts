import { chromiumLaunchOptions, importPlaywright } from '../apply/health'
import { getCandidateProfile } from '../application/candidate-store'
import { buildCandidateApplicationProfile } from '../application/profile'
import { selectedResumeForUpload } from '../application/resume'
import { mapSyntheticApplicationFields } from '../agent/eligibility'
import { persistExecutionState, type ExecutionState } from '../agent/state'
import { logExecution, SYNTHETIC_SLICE_CONFIRMATION } from '../agent/campaign'
import { createBrowserApplicationSession } from './session'
import type { AutoApplyQueueItem } from '../apply/types'

export interface ExecutionBrowserResult {
  status: AutoApplyQueueItem['applicationStatus'] | 'needs_confirmation'
  executionState: ExecutionState
  failureReason: string | null
  confirmationNumber: string | null
  confirmationText: string | null
  finalUrl: string | null
  fieldsFilled: string[]
  resumeUploaded: boolean
  submitClicked: boolean
}

export function detectSyntheticConfirmation(html: string, title = ''): {
  confirmed: boolean
  confirmationNumber: string | null
  confirmationText: string | null
} {
  const text = `${title} ${html}`.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
  const submitted = /application submitted/i.test(text)
  const number = text.match(/confirmation number[:\s]*([A-Z0-9][A-Z0-9-]{4,})/i)?.[1] ?? null
  if (submitted && number) {
    return { confirmed: true, confirmationNumber: number, confirmationText: 'Application Submitted' }
  }
  return { confirmed: false, confirmationNumber: number, confirmationText: null }
}

async function setState(itemId: string, state: ExecutionState, reason: string | null = null) {
  persistExecutionState(itemId, state, reason)
}

export async function runExecutionBrowser(input: {
  item: AutoApplyQueueItem
  userId: string
  navigationMs?: number
  playwrightAvailable?: boolean
}): Promise<ExecutionBrowserResult> {
  const failed = (state: ExecutionState, reason: string, extras: Partial<ExecutionBrowserResult> = {}): ExecutionBrowserResult => {
    persistExecutionState(input.item.id, state, reason)
    return {
      status: state === 'needs_user_input' ? 'needs_user_input' : state === 'submission_uncertain' ? 'needs_confirmation' : 'failed',
      executionState: state,
      failureReason: reason,
      confirmationNumber: null,
      confirmationText: null,
      finalUrl: input.item.applicationUrl,
      fieldsFilled: [],
      resumeUploaded: false,
      submitClicked: false,
      ...extras,
    }
  }

  const url = input.item.applicationUrl
  if (!url || !/^https?:\/\//i.test(url)) {
    return failed('failed', 'INVALID_URL')
  }

  const candidate = getCandidateProfile(input.userId)
  if (!candidate?.profile) {
    return failed('failed', 'MISSING_PROFILE_FIELD')
  }
  const built = buildCandidateApplicationProfile({
    userId: input.userId,
    profile: candidate.profile,
    resumeText: candidate.resumeText ?? input.item.tailoredResumeText,
    resumeVersionId: candidate.resumeVersionId ?? input.item.resumeVersionId,
  })
  const mapped = mapSyntheticApplicationFields(built)
  if (mapped.missing.length) {
    return failed('needs_user_input', `MISSING_PROFILE_FIELD:${mapped.missing.join(',')}`)
  }
  const resume = selectedResumeForUpload({
    resumeVersionId: input.item.resumeVersionId,
    resumeVersionName: input.item.resumeVersionName,
    tailoredResumeText: candidate.resumeText ?? input.item.tailoredResumeText,
    masterResumeUnchanged: true,
  })
  if (!resume) {
    return failed('failed', 'MISSING_RESUME')
  }

  if (input.playwrightAvailable === false) {
    return failed('failed', 'BROWSER_UNAVAILABLE')
  }
  const playwright = await importPlaywright()
  if (!playwright) {
    return failed('failed', 'BROWSER_UNAVAILABLE')
  }

  logExecution('BROWSER_STARTED')
  persistExecutionState(input.item.id, 'opening')
  createBrowserApplicationSession({
    applicationId: input.item.applicationId,
    itemId: input.item.id,
    runId: input.item.runId,
    jobId: input.item.jobId,
    resumeVersionId: input.item.resumeVersionId,
    browserContextId: 'execution',
    applicationUrl: url,
    provider: 'generic',
  })

  let browser: { close: () => Promise<void>; newPage: () => Promise<import('playwright').Page> } | undefined
  const navigationMs = input.navigationMs ?? 16_000
  try {
    browser = (await playwright.chromium.launch(chromiumLaunchOptions())) as unknown as {
      close: () => Promise<void>
      newPage: () => Promise<import('playwright').Page>
    }
    const page = await browser.newPage()
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: navigationMs })
    } catch {
      return failed('failed', 'NAVIGATION_TIMEOUT')
    }
    await setState(input.item.id, 'job_page')
    logExecution('JOB_PAGE_OPENED')

    const apply = page.getByRole('link', { name: /^Apply$/i }).first()
    if ((await apply.count()) === 0) {
      return failed('failed', 'FORM_NOT_FOUND')
    }
    await apply.click()
    await page.waitForLoadState('domcontentloaded').catch(() => undefined)
    logExecution('APPLY_CLICKED')
    await setState(input.item.id, 'application_page')
    logExecution('APPLICATION_PAGE_DETECTED')

    const firstName = page.locator('#first-name')
    if ((await firstName.count()) === 0) {
      return failed('failed', 'FORM_NOT_FOUND')
    }
    const values = Object.fromEntries(mapped.mapped.map((field) => [field.id, field.value]))
    logExecution('FIELDS_DETECTED')
    await setState(input.item.id, 'filling')
    await page.locator('#first-name').fill(values.first_name)
    await page.locator('#last-name').fill(values.last_name)
    await page.locator('#email').fill(values.email)
    await page.locator('#phone').fill(values.phone)
    if (values.linkedin) await page.locator('#linkedin').fill(values.linkedin)
    logExecution('FIELDS_FILLED')
    await page.getByRole('button', { name: /^Next$/i }).click()
    await page.waitForLoadState('domcontentloaded').catch(() => undefined)
    logExecution('NEXT_CLICKED')
    await setState(input.item.id, 'next_step')

    await setState(input.item.id, 'uploading_resume')
    const file = page.locator('input[type="file"]')
    if ((await file.count()) === 0) {
      return failed('failed', 'MISSING_RESUME')
    }
    await file.setInputFiles({ name: resume.fileName, mimeType: resume.mimeType, buffer: resume.buffer })
    if (values.work_authorization) {
      await page.locator('#work-auth').selectOption(values.work_authorization).catch(() => undefined)
    }
    logExecution('RESUME_UPLOADED')
    await page.getByRole('button', { name: /^Continue$/i }).click()
    await page.waitForLoadState('domcontentloaded').catch(() => undefined)

    const review = await page.locator('h1').innerText().catch(() => '')
    if (!/review/i.test(review)) {
      return failed('failed', 'FORM_NOT_FOUND')
    }
    await setState(input.item.id, 'review')
    logExecution('REVIEW_REACHED')

    const submit = page.getByRole('button', { name: /^Submit Application$/i }).first()
    if ((await submit.count()) === 0) {
      return failed('failed', 'SUBMIT_NOT_FOUND')
    }
    await setState(input.item.id, 'submitting')
    await submit.click()
    logExecution('SUBMIT_CLICKED')
    await page.waitForLoadState('domcontentloaded').catch(() => undefined)

    const html = await page.content()
    const title = await page.title()
    const confirmation = detectSyntheticConfirmation(html, title)
    const finalUrl = page.url()
    if (!confirmation.confirmed || confirmation.confirmationNumber !== SYNTHETIC_SLICE_CONFIRMATION) {
      logExecution('CONFIRMATION_MISSING')
      return failed('submission_uncertain', 'CONFIRMATION_MISSING', {
        submitClicked: true,
        resumeUploaded: true,
        fieldsFilled: mapped.mapped.map((field) => field.id),
        finalUrl,
        confirmationNumber: confirmation.confirmationNumber,
      })
    }
    await setState(input.item.id, 'submitted')
    logExecution('CONFIRMATION_DETECTED')
    return {
      status: 'submitted',
      executionState: 'submitted',
      failureReason: null,
      confirmationNumber: confirmation.confirmationNumber,
      confirmationText: confirmation.confirmationText,
      finalUrl,
      fieldsFilled: mapped.mapped.map((field) => field.id),
      resumeUploaded: true,
      submitClicked: true,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'BROWSER_UNAVAILABLE'
    if (/timeout/i.test(message)) return failed('failed', 'NAVIGATION_TIMEOUT')
    return failed('failed', 'BROWSER_UNAVAILABLE')
  } finally {
    await browser?.close().catch(() => undefined)
  }
}
