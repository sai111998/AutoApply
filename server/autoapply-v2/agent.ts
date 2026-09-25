import type { Page } from 'playwright'
import { randomUUID } from 'node:crypto'
import type { CanonicalCandidateProfile } from '../application/candidate-profile'
import { loadV2Job } from './application'
import { V2Error } from './errors'
import { loadV2Profile } from './profile'
import { createV2Run, updateV2Run } from './queue'
import { loadV2Resume } from './resume'
import { updateV2Session } from './session'
import { detectV2Confirmation, type V2ConfirmationInput } from './confirmation'
import { detectV2Fields, fillV2Fields, mapV2Fields } from './fields'
import { clickV2Apply, findV2ApplyControl, clickV2ApplyManual, findV2ApplyManualControl, clickV2Next, findV2NextControl, findV2SubmitControl } from './navigation'
import { clickV2Submit } from './submission'
import type { V2Confirmation, V2PageState, V2Provider, V2QueueItem, V2Resume, V2RunStatus } from './types'

export async function startV2AutoApply(input: {
  userId: string
  jobId: string
}): Promise<{ runId: string; status: 'queued' }> {
  if (!input.userId?.trim()) throw new V2Error('PROFILE_INCOMPLETE', 'Authentication required.', 401)
  if (!input.jobId?.trim()) throw new V2Error('JOB_NOT_FOUND', 'jobId is required.', 400)
  const job = loadV2Job(input.userId, input.jobId)
  const { profileReady, missing } = await loadV2Profile(input.userId)
  if (!profileReady) {
    throw new V2Error('PROFILE_INCOMPLETE', `Profile incomplete, missing: ${missing.join(', ')}.`, 422)
  }
  const resume = await loadV2Resume(input.userId)
  const now = new Date().toISOString()
  const runId = randomUUID()
  createV2Run({
    runId,
    jobId: job.id,
    title: job.title,
    company: job.company,
    location: job.location,
    applicationUrl: job.applicationUrl,
    initialUrl: null,
    finalUrl: null,
    redirectChain: [],
    resumeVersionId: resume.versionId,
    resumeVersionName: resume.versionName,
    userId: input.userId,
    status: 'queued',
    failureReason: null,
    pageState: null,
    provider: null,
    fieldsDetected: [],
    fieldsFilled: [],
    resumeUploaded: false,
    submitClicked: false,
    confirmationNumber: null,
    confirmationText: null,
    confirmationEvidence: [],
    submittedAt: null,
    jdSnapshot: job.description,
    createdAt: now,
    updatedAt: now,
  })
  console.log(`[V2] RUN_QUEUED runId=${runId} jobId=${job.id}`)
  return { runId, status: 'queued' }
}

export interface V2AgentResult {
  status: V2RunStatus
  failureReason: string | null
  pageState: V2PageState
  provider: V2Provider
  finalUrl: string
  redirectChain: string[]
  fieldsDetected: string[]
  fieldsFilled: string[]
  resumeUploaded: boolean
  submitClicked: boolean
  confirmation: V2Confirmation | null
}

interface V2PageSnapshot {
  url: string
  title: string
  html: string
  bodyText: string
}

export function detectV2Provider(url: string, html: string): V2Provider {
  const host = (() => {
    try {
      return new URL(url).hostname.toLowerCase()
    } catch {
      return ''
    }
  })()
  const haystack = `${host} ${html.slice(0, 20000)}`.toLowerCase()
  if (host.includes('myworkdayjobs') || host.includes('workday')) return 'workday'
  if (host.includes('greenhouse') || haystack.includes('boards.greenhouse.io')) return 'greenhouse'
  if (host.includes('lever.co')) return 'lever'
  if (host.includes('ashby')) return 'ashby'
  if (host.includes('icims')) return 'icims'
  if (host.includes('smartrecruiters')) return 'smartrecruiters'
  if (host.includes('workable')) return 'workable'
  if (/workday/.test(haystack)) return 'workday'
  if (/greenhouse/.test(haystack)) return 'greenhouse'
  if (/lever\.co/.test(haystack)) return 'lever'
  if (/ashby/.test(haystack)) return 'ashby'
  if (/icims/.test(haystack)) return 'icims'
  return 'generic'
}

export function classifyV2Page(input: {
  snapshot: V2PageSnapshot
  hasPasswordField: boolean
  hasApplyControl: boolean
  fieldCount: number
  hasFileInput: boolean
}): V2PageState {
  const haystack = `${input.snapshot.title}\n${input.snapshot.bodyText}`.slice(0, 20000)
  const html = input.snapshot.html.slice(0, 60000)
  if (
    /g-recaptcha|recaptcha|cf-turnstile|hcaptcha|perimeterx|datadome/i.test(html) ||
    (/verify you are (a )?human|complete.*captcha|security check/i.test(haystack) && input.fieldCount === 0)
  ) {
    return 'CAPTCHA_PAGE'
  }
  if (
    /(verification|authentication|security)\s*code|one-?time\s*(pass\s*)?code|authenticator|enter the code/i.test(
      haystack,
    ) &&
    input.fieldCount <= 2
  ) {
    return 'MFA_PAGE'
  }
  if (input.hasPasswordField && /sign in|log in|password/i.test(haystack)) return 'LOGIN_PAGE'
  if (input.hasFileInput || input.fieldCount >= 2) return 'APPLICATION_PAGE'
  if (input.hasApplyControl) return 'JOB_PAGE'
  if (/404|page not found|access denied|forbidden|something went wrong/i.test(haystack) && input.fieldCount === 0) {
    return 'ERROR_PAGE'
  }
  if (/job description|responsibilities|qualifications|about the role/i.test(haystack)) return 'JOB_PAGE'
  return 'UNKNOWN'
}

async function snapshotV2Page(page: Page): Promise<V2PageSnapshot> {
  let title = ''
  let html = ''
  let bodyText = ''
  try {
    title = await page.title()
  } catch {
    title = ''
  }
  try {
    html = await page.content()
  } catch {
    html = ''
  }
  try {
    bodyText = await page.evaluate(() => document.body?.innerText ?? '')
  } catch {
    bodyText = ''
  }
  return { url: page.url(), title, html, bodyText: bodyText.slice(0, 30000) }
}

async function settleV2Page(page: Page, ms = 1800): Promise<void> {
  await Promise.race([
    page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => null),
    page.waitForTimeout(ms),
  ])
  await page.waitForTimeout(400).catch(() => null)
}

export async function uploadV2Resume(page: Page, resume: V2Resume): Promise<boolean> {
  const frames = page.frames()
  let uploaded = false
  for (const frame of frames) {
    let count = 0
    try {
      count = await frame.locator('input[type=file]').count()
    } catch {
      continue
    }
    for (let index = 0; index < count; index += 1) {
      const input = frame.locator('input[type=file]').nth(index)
      try {
        if (!(await input.isVisible({ timeout: 500 }))) continue
        await input.setInputFiles(
          { name: resume.fileName, mimeType: resume.mimeType, buffer: resume.buffer },
          { timeout: 8000 },
        )
        uploaded = true
      } catch {
        continue
      }
    }
  }
  if (!uploaded) return false
  await page.waitForTimeout(800).catch(() => null)
  try {
    const accepted = await page.evaluate((fileName) => {
      const inputs = [...document.querySelectorAll('input[type=file]')]
      const hasFile = inputs.some((input) => (input as HTMLInputElement).files?.length)
      const body = document.body?.innerText ?? ''
      return hasFile || body.includes(fileName)
    }, resume.fileName)
    return accepted === true
  } catch {
    return true
  }
}

export async function runV2Application(input: {
  run: V2QueueItem
  profile: CanonicalCandidateProfile
  resume: V2Resume
  page: Page
}): Promise<V2AgentResult> {
  const { run, profile, resume, page } = input
  const redirectChain: string[] = [run.applicationUrl]
  const fieldsDetected = new Set<string>()
  const fieldsFilled = new Set<string>()
  let resumeUploaded = false
  let submitClicked = false

  const track = (status: V2RunStatus) => {
    updateV2Run(run.runId, { status })
    updateV2Session(run.runId, { state: status, currentUrl: page.url() })
  }

  track('opening')
  try {
    await page.goto(run.applicationUrl, { waitUntil: 'domcontentloaded', timeout: 16000 })
  } catch {
    return fail('APPLICATION_PAGE_NOT_FOUND', 'The employer application page could not be opened.')
  }
  await settleV2Page(page)
  let snapshot = await snapshotV2Page(page)
  if (redirectChain.at(-1) !== snapshot.url) redirectChain.push(snapshot.url)
  updateV2Run(run.runId, { initialUrl: snapshot.url, finalUrl: snapshot.url, redirectChain: [...redirectChain] })
  const provider = detectV2Provider(snapshot.url, snapshot.html)
  updateV2Run(run.runId, { provider })
  updateV2Session(run.runId, { provider, currentUrl: snapshot.url })
  console.log(`[V2] JOB_PAGE_OPENED provider=${provider} url=${snapshot.url}`)

  let unknownRetries = 0
  let applyClicks = 0
  for (;;) {
    const fields = await detectV2Fields(page).catch(() => [])
    const hasPassword = fields.some((field) => field.type === 'password')
    const hasFileInput = fields.some((field) => field.type === 'file')
    const hasApply = await findV2ApplyControl(page)
    const pageState = classifyV2Page({
      snapshot,
      hasPasswordField: hasPassword,
      hasApplyControl: hasApply,
      fieldCount: fields.length,
      hasFileInput,
    })
    updateV2Run(run.runId, { pageState })
    if (pageState === 'CAPTCHA_PAGE') return terminal('captcha_required', 'CAPTCHA_REQUIRED', null, pageState)
    if (pageState === 'LOGIN_PAGE') return terminal('login_required', 'LOGIN_REQUIRED', null, pageState)
    if (pageState === 'MFA_PAGE') return terminal('mfa_required', 'MFA_REQUIRED', null, pageState)
    if (pageState === 'ERROR_PAGE') return fail('APPLICATION_PAGE_NOT_FOUND', 'The employer page reported an error.')
    if (pageState === 'APPLICATION_PAGE') break
    if (pageState === 'JOB_PAGE' && hasApply && applyClicks < 3) {
      console.log('[V2] APPLY_ACTION_FOUND')
      track('opening')
      const clicked = await clickV2Apply(page)
      if (!clicked) return fail('FORM_NOT_FOUND', 'The Apply control could not be clicked.')
      applyClicks += 1
      unknownRetries = 0
      console.log('[V2] APPLY_ACTION_CLICKED')
      await settleV2Page(page, 2200)
      snapshot = await snapshotV2Page(page)
      if (redirectChain.at(-1) !== snapshot.url) redirectChain.push(snapshot.url)
      updateV2Run(run.runId, { finalUrl: snapshot.url, redirectChain: [...redirectChain] })
      updateV2Session(run.runId, { currentUrl: snapshot.url })
      continue
    }
    const hasApplyManual =
      fields.length === 0 && !hasFileInput && applyClicks < 3 ? await findV2ApplyManualControl(page) : false
    if ((pageState === 'JOB_PAGE' || pageState === 'UNKNOWN') && !hasApply && hasApplyManual) {
      console.log('[V2] APPLY_ACTION_FOUND')
      track('opening')
      const clicked = await clickV2ApplyManual(page)
      if (!clicked) return fail('FORM_NOT_FOUND', 'The Apply Manually control could not be clicked.')
      applyClicks += 1
      unknownRetries = 0
      console.log('[V2] APPLY_ACTION_CLICKED')
      await settleV2Page(page, 2200)
      snapshot = await snapshotV2Page(page)
      if (redirectChain.at(-1) !== snapshot.url) redirectChain.push(snapshot.url)
      updateV2Run(run.runId, { finalUrl: snapshot.url, redirectChain: [...redirectChain] })
      updateV2Session(run.runId, { currentUrl: snapshot.url })
      continue
    }
    if (unknownRetries < 4) {
      unknownRetries += 1
      await page.waitForTimeout(2500).catch(() => null)
      snapshot = await snapshotV2Page(page)
      if (redirectChain.at(-1) !== snapshot.url) redirectChain.push(snapshot.url)
      continue
    }
    return fail('FORM_NOT_FOUND', 'No application form or Apply action was detected.')
  }

  track('application_detected')
  console.log('[V2] APPLICATION_PAGE_DETECTED')
  console.log('[V2] FORM_DETECTED')

  for (let step = 0; step < 8; step += 1) {
    snapshot = await snapshotV2Page(page)
    const fields = await detectV2Fields(page).catch(() => [])
    const hasPassword = fields.some((field) => field.type === 'password')
    const hasFileInput = fields.some((field) => field.type === 'file')
    const pageState = classifyV2Page({
      snapshot,
      hasPasswordField: hasPassword,
      hasApplyControl: false,
      fieldCount: fields.length,
      hasFileInput,
    })
    if (pageState === 'CAPTCHA_PAGE') return terminal('captcha_required', 'CAPTCHA_REQUIRED', null, pageState)
    if (pageState === 'LOGIN_PAGE') return terminal('login_required', 'LOGIN_REQUIRED', null, pageState)
    if (pageState === 'MFA_PAGE') return terminal('mfa_required', 'MFA_REQUIRED', null, pageState)

    track('filling')
    const mapping = mapV2Fields(fields, profile)
    for (const detected of mapping.detected) fieldsDetected.add(detected.key)
    console.log(`[V2] FIELDS_DETECTED count=${mapping.detected.length}`)
    if (mapping.unknownRequired.length > 0) {
      const labels = mapping.unknownRequired.map((field) => field.label).slice(0, 5).join(' | ')
      updateV2Run(run.runId, { fieldsDetected: [...fieldsDetected], fieldsFilled: [...fieldsFilled] })
      return terminal('needs_user_input', `UNKNOWN_REQUIRED_FIELD: ${labels}`)
    }
    const filled = await fillV2Fields(page, mapping.mapped)
    for (const key of filled) fieldsFilled.add(key)
    console.log(`[V2] FIELDS_FILLED count=${filled.length}`)
    updateV2Run(run.runId, { fieldsDetected: [...fieldsDetected], fieldsFilled: [...fieldsFilled] })

    if (hasFileInput && !resumeUploaded) {
      track('uploading_resume')
      const accepted = await uploadV2Resume(page, resume)
      if (!accepted) return fail('RESUME_UPLOAD_FAILED', 'The resume file was not accepted by the page.')
      resumeUploaded = true
      console.log('[V2] RESUME_UPLOADED')
      updateV2Run(run.runId, { resumeUploaded: true })
    }

    let hasNext = await findV2NextControl(page)
    let hasSubmit = await findV2SubmitControl(page)
    if (!hasNext && !hasSubmit && fields.length === 0) {
      await page.waitForTimeout(2500).catch(() => null)
      hasNext = await findV2NextControl(page)
      hasSubmit = await findV2SubmitControl(page)
    }
    if (!hasNext && hasSubmit) break
    if (hasNext) {
      track('navigating')
      const advanced = await clickV2Next(page)
      if (!advanced) return fail('NAVIGATION_TIMEOUT', 'The Next control could not be clicked.')
      console.log('[V2] NEXT_STEP')
      await settleV2Page(page, 2200)
      snapshot = await snapshotV2Page(page)
      if (redirectChain.at(-1) !== snapshot.url) redirectChain.push(snapshot.url)
      updateV2Run(run.runId, { finalUrl: snapshot.url, redirectChain: [...redirectChain] })
      updateV2Session(run.runId, { currentUrl: snapshot.url, step: step + 1 })
      continue
    }
    return fail('NAVIGATION_TIMEOUT', 'No Next or Submit control was detected on the application.')
  }

  console.log('[V2] REVIEW_REACHED')
  track('ready_to_submit')
  snapshot = await snapshotV2Page(page)
  const reviewFields = await detectV2Fields(page).catch(() => [])
  const reviewMapping = mapV2Fields(reviewFields, profile)
  if (reviewMapping.unknownRequired.length > 0) {
    return terminal('needs_user_input', 'UNKNOWN_REQUIRED_FIELD: unresolved required question on review step.')
  }
  const hasSubmit = await findV2SubmitControl(page)
  if (!hasSubmit) return fail('SUBMISSION_FAILED', 'The final Submit control was not found.')
  console.log('[V2] FINAL_SUBMIT_FOUND')

  track('submitting')
  submitClicked = await clickV2Submit(page)
  if (!submitClicked) return fail('SUBMISSION_FAILED', 'The final Submit control could not be clicked.')
  console.log('[V2] FINAL_SUBMIT_CLICKED')
  updateV2Run(run.runId, { submitClicked: true })
  await settleV2Page(page, 2800)
  snapshot = await snapshotV2Page(page)
  if (redirectChain.at(-1) !== snapshot.url) redirectChain.push(snapshot.url)

  const confirmationInput: V2ConfirmationInput = {
    title: snapshot.title,
    bodyText: snapshot.bodyText,
    url: snapshot.url,
  }
  const confirmation = detectV2Confirmation(confirmationInput)
  confirmation.attempted = true
  updateV2Run(run.runId, {
    finalUrl: snapshot.url,
    redirectChain: [...redirectChain],
    submitClicked: true,
    confirmationNumber: confirmation.confirmationNumber,
    confirmationText: confirmation.confirmationText,
    confirmationEvidence: confirmation.evidence,
    submittedAt: confirmation.confirmed ? new Date().toISOString() : null,
  })
  if (confirmation.confirmed) {
    console.log('[V2] CONFIRMATION_DETECTED')
    return {
      status: 'submitted',
      failureReason: null,
      pageState: 'APPLICATION_PAGE',
      provider,
      finalUrl: snapshot.url,
      redirectChain,
      fieldsDetected: [...fieldsDetected],
      fieldsFilled: [...fieldsFilled],
      resumeUploaded,
      submitClicked,
      confirmation,
    }
  }
  return terminal('submission_uncertain', 'SUBMISSION_UNCERTAIN', confirmation)

  function terminal(
    status: V2RunStatus,
    failureReason: string,
    confirmationResult: V2Confirmation | null = null,
    resultPageState: V2PageState = 'APPLICATION_PAGE',
  ): V2AgentResult {
    updateV2Run(run.runId, { status, failureReason, finalUrl: snapshot.url, pageState: resultPageState })
    updateV2Session(run.runId, { state: status, currentUrl: snapshot.url })
    return {
      status,
      failureReason,
      pageState: resultPageState,
      provider,
      finalUrl: snapshot.url,
      redirectChain,
      fieldsDetected: [...fieldsDetected],
      fieldsFilled: [...fieldsFilled],
      resumeUploaded,
      submitClicked,
      confirmation: confirmationResult,
    }
  }

  function fail(code: string, message: string): V2AgentResult {
    const failureReason = `${code}: ${message}`
    updateV2Run(run.runId, { status: 'failed', failureReason, finalUrl: snapshot.url })
    updateV2Session(run.runId, { state: 'failed', currentUrl: snapshot.url })
    return {
      status: 'failed',
      failureReason,
      pageState: 'UNKNOWN',
      provider,
      finalUrl: snapshot.url,
      redirectChain,
      fieldsDetected: [...fieldsDetected],
      fieldsFilled: [...fieldsFilled],
      resumeUploaded,
      submitClicked,
      confirmation: null,
    }
  }
}
