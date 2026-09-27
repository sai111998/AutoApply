import type { Frame, Locator, Page } from 'playwright'
import type { CanonicalCandidateProfile } from '../application/candidate-profile'
import { updateV2Run } from './queue'
import { updateV2Session } from './session'
import { detectV2Confirmation, type V2ConfirmationInput } from './confirmation'
import { detectV2Fields, fillV2Fields, mapV2Fields } from './fields'
import { logV2, v2LogChannel } from './log'
import {
  clickV2Apply,
  findV2ApplyControl,
  clickV2ApplyManual,
  findV2ApplyManualControl,
  clickV2Next,
  findV2NextControl,
  findV2SubmitControl,
} from './navigation'
import { classifyV2ApplicationForm } from './simple'
import { clickV2Submit } from './submission'
import { detectV2Provider, unsupportedV2System, v2ApplicationSystem } from './system'
import { traceV2 } from './trace'
import type { V2Confirmation, V2PageState, V2Provider, V2QueueItem, V2Resume, V2RunStatus } from './types'

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

export { detectV2Provider }

export function classifyV2Page(input: {
  snapshot: V2PageSnapshot
  hasPasswordField: boolean
  hasApplyControl: boolean
  fieldCount: number
  hasFileInput: boolean
  hasVisibleCaptcha?: boolean
}): V2PageState {
  const haystack = `${input.snapshot.title}\n${input.snapshot.bodyText}`.slice(0, 20000)
  if (
    input.hasVisibleCaptcha ||
    (/verify you are (a )?human|complete.*captcha|security check|press (&|and) hold|checking your browser|just a moment/i.test(
      haystack,
    ) &&
      input.fieldCount === 0)
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

const V2_CAPTCHA_CHALLENGES = [
  'iframe[src*="recaptcha"][src*="/anchor"]:not([src*="size=invisible"])',
  'iframe[src*="recaptcha"][src*="/bframe"]',
  'iframe[src*="hcaptcha.com"]',
  'iframe[src*="challenges.cloudflare.com"]',
  'iframe[src*="captcha-delivery.com"]',
  '#px-captcha',
]

// Many real application forms load invisible reCAPTCHA/hCaptcha scripts that never show a challenge,
// so only a rendered, visible challenge widget counts.
export async function detectV2VisibleCaptcha(page: Page): Promise<boolean> {
  for (const selector of V2_CAPTCHA_CHALLENGES) {
    const widgets = page.locator(selector)
    const count = await widgets.count().catch(() => 0)
    for (let index = 0; index < count; index += 1) {
      const widget = widgets.nth(index)
      const box = await widget.boundingBox().catch(() => null)
      if (box && box.width >= 30 && box.height >= 30 && (await widget.isVisible().catch(() => false))) return true
    }
  }
  return false
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
  for (const frame of page.frames().slice(1)) {
    if (bodyText.length >= 30000) break
    const frameText = await frame.evaluate(() => document.body?.innerText ?? '').catch(() => '')
    if (frameText.trim()) bodyText += `\n${frameText}`
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

function fileInputPurpose(input: Locator): Promise<string> {
  return input
    .evaluate((element) => {
      const field = element as HTMLInputElement
      const labels = field.labels ? [...field.labels].map((label) => label.textContent ?? '') : []
      const labelledBy = (field.getAttribute('aria-labelledby') ?? '')
        .split(/\s+/)
        .map((id) => (id ? document.getElementById(id)?.textContent ?? '' : ''))
      return [...labels, ...labelledBy, field.getAttribute('aria-label') ?? '', field.name, field.id]
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase()
    })
    .catch(() => '')
}

export async function uploadV2Resume(page: Page, resume: V2Resume): Promise<boolean> {
  const candidates: Array<{ frame: Frame; input: Locator; purpose: string }> = []
  for (const frame of page.frames()) {
    const inputs = frame.locator('input[type=file]')
    const count = await inputs.count().catch(() => 0)
    for (let index = 0; index < count; index += 1) {
      const input = inputs.nth(index)
      candidates.push({ frame, input, purpose: await fileInputPurpose(input) })
    }
  }
  const eligible = candidates.filter((candidate) => !/cover[\s_-]*letter|motivation/.test(candidate.purpose))
  const resumeInputs = eligible.filter((candidate) => /resume|\bcv\b|curriculum/.test(candidate.purpose))
  // Several unlabeled file inputs give no way to tell which one wants the resume.
  const target = resumeInputs[0] ?? (eligible.length === 1 ? eligible[0] : null)
  if (!target) return false
  try {
    await target.input.setInputFiles(
      { name: resume.fileName, mimeType: resume.mimeType, buffer: resume.buffer },
      { timeout: 8000 },
    )
  } catch {
    return false
  }
  await page.waitForTimeout(800).catch(() => null)
  const selected = await target.input
    .evaluate((element) => Boolean((element as HTMLInputElement).files?.length), undefined, { timeout: 2000 })
    .catch(() => false)
  if (selected) return true
  // Some providers upload the file right away and re-render the field, leaving only the file name on the page.
  return target.frame.evaluate((fileName) => (document.body?.innerText ?? '').includes(fileName), resume.fileName).catch(() => false)
}

const BASIC_FIELD_KEYS = new Set(['firstName', 'lastName', 'fullName', 'email', 'phone'])

export async function runV2Application(input: {
  run: V2QueueItem
  profile: CanonicalCandidateProfile
  resume: V2Resume
  page: Page
}): Promise<V2AgentResult> {
  const { run, profile, resume, page } = input
  const channel = v2LogChannel(run.source)
  const redirectChain: string[] = [run.applicationUrl]
  const fieldsDetected = new Set<string>()
  const fieldsFilled = new Set<string>()
  let resumeUploaded = false
  let submitClicked = false
  let provider: V2Provider = 'unknown'
  let snapshot: V2PageSnapshot = { url: run.applicationUrl, title: '', html: '', bodyText: '' }

  const track = (status: V2RunStatus) => {
    updateV2Run(run.runId, { status })
    updateV2Session(run.runId, { state: status, currentUrl: page.url() })
  }

  const followNavigation = async (waitMs: number) => {
    await settleV2Page(page, waitMs)
    snapshot = await snapshotV2Page(page)
    if (redirectChain.at(-1) !== snapshot.url) redirectChain.push(snapshot.url)
    updateV2Run(run.runId, { finalUrl: snapshot.url, redirectChain: [...redirectChain] })
    updateV2Session(run.runId, { currentUrl: snapshot.url })
  }

  const detectProvider = () => {
    provider = detectV2Provider(snapshot.url, snapshot.html)
    updateV2Run(run.runId, { provider })
    updateV2Session(run.runId, { provider, currentUrl: snapshot.url })
  }

  track('opening')
  try {
    await page.goto(run.applicationUrl, { waitUntil: 'domcontentloaded', timeout: 16000 })
  } catch (error) {
    const detail = error instanceof Error ? error.message.split('\n')[0] : 'navigation failed'
    const timedOut = error instanceof Error && error.name === 'TimeoutError'
    return fail(timedOut ? 'NAVIGATION_TIMEOUT' : 'NAVIGATION_FAILED', `The application URL could not be opened (${detail}).`)
  }
  await settleV2Page(page)
  snapshot = await snapshotV2Page(page)
  if (redirectChain.at(-1) !== snapshot.url) redirectChain.push(snapshot.url)
  updateV2Run(run.runId, { initialUrl: snapshot.url, finalUrl: snapshot.url, redirectChain: [...redirectChain] })
  detectProvider()
  traceV2(run.runId, 'APPLICATION_URL_OPENED', {
    jobId: run.jobId,
    company: run.company,
    title: run.title,
    applicationUrl: run.applicationUrl,
    initialUrl: snapshot.url,
    system: v2ApplicationSystem(provider),
  })

  let unknownRetries = 0
  let applyClicks = 0
  let classifiedInitialPage = false
  let lastPageState: V2PageState = 'UNKNOWN'
  for (;;) {
    const portal = unsupportedV2System(snapshot.url)
    if (portal) return unsupportedForm(portal.reason, portal.detail)
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
      hasVisibleCaptcha: await detectV2VisibleCaptcha(page),
    })
    updateV2Run(run.runId, { pageState })
    lastPageState = pageState
    if (!classifiedInitialPage && (pageState !== 'UNKNOWN' || unknownRetries >= 4)) {
      traceV2(run.runId, 'PAGE_CLASSIFIED', { pageState, fields: fields.length })
      classifiedInitialPage = true
    }
    if (pageState === 'CAPTCHA_PAGE') return terminal('captcha_required', 'CAPTCHA_REQUIRED', null, pageState)
    if (pageState === 'LOGIN_PAGE') return terminal('login_required', 'LOGIN_REQUIRED', null, pageState)
    if (pageState === 'MFA_PAGE') return terminal('mfa_required', 'MFA_REQUIRED', null, pageState)
    if (pageState === 'ERROR_PAGE') {
      return fail('APPLICATION_PAGE_NOT_FOUND', 'The employer page reported an error or access denial.')
    }
    if (pageState === 'APPLICATION_PAGE') break
    if (pageState === 'JOB_PAGE' && hasApply && applyClicks < 3) {
      traceV2(run.runId, 'APPLY_FOUND', { control: 'apply' })
      track('opening')
      const clicked = await clickV2Apply(page)
      if (!clicked) return fail('APPLY_BUTTON_NOT_FOUND', 'The Apply control was found but could not be clicked.')
      applyClicks += 1
      unknownRetries = 0
      traceV2(run.runId, 'APPLY_CLICKED', { control: 'apply' })
      await followNavigation(2200)
      continue
    }
    const hasApplyManual =
      fields.length === 0 && !hasFileInput && applyClicks < 3 ? await findV2ApplyManualControl(page) : false
    if ((pageState === 'JOB_PAGE' || pageState === 'UNKNOWN') && !hasApply && hasApplyManual) {
      traceV2(run.runId, 'APPLY_FOUND', { control: 'apply-manually' })
      track('opening')
      const clicked = await clickV2ApplyManual(page)
      if (!clicked) return fail('APPLY_BUTTON_NOT_FOUND', 'The Apply Manually control could not be clicked.')
      applyClicks += 1
      unknownRetries = 0
      traceV2(run.runId, 'APPLY_CLICKED', { control: 'apply-manually' })
      await followNavigation(2200)
      continue
    }
    if (unknownRetries < 4) {
      unknownRetries += 1
      await page.waitForTimeout(2500).catch(() => null)
      snapshot = await snapshotV2Page(page)
      if (redirectChain.at(-1) !== snapshot.url) redirectChain.push(snapshot.url)
      continue
    }
    if (lastPageState === 'JOB_PAGE' && applyClicks === 0) {
      return fail('APPLY_BUTTON_NOT_FOUND', 'The job page has no legitimate Apply, Apply Now, or Start Application control.')
    }
    return fail(
      'APPLICATION_PAGE_NOT_FOUND',
      applyClicks > 0
        ? 'Apply was clicked, but no application form appeared.'
        : 'The page loaded, but no application form or Apply action was detected.',
    )
  }

  track('application_page')
  detectProvider()
  traceV2(run.runId, 'APPLY_FORM_FOUND', { url: snapshot.url, system: v2ApplicationSystem(provider) })

  let reachedFinalStep = false
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
      hasVisibleCaptcha: await detectV2VisibleCaptcha(page),
    })
    if (pageState === 'CAPTCHA_PAGE') return terminal('captcha_required', 'CAPTCHA_REQUIRED', null, pageState)
    if (pageState === 'LOGIN_PAGE') return terminal('login_required', 'LOGIN_REQUIRED', null, pageState)
    if (pageState === 'MFA_PAGE') return terminal('mfa_required', 'MFA_REQUIRED', null, pageState)

    track('filling')
    const mapping = mapV2Fields(fields, profile)
    for (const detected of mapping.detected) fieldsDetected.add(detected.key)
    let hasNext = await findV2NextControl(page)
    let hasSubmit = await findV2SubmitControl(page)
    if (!hasNext && !hasSubmit && fields.length === 0) {
      await page.waitForTimeout(2500).catch(() => null)
      hasNext = await findV2NextControl(page)
      hasSubmit = await findV2SubmitControl(page)
    }
    const form = classifyV2ApplicationForm({
      url: snapshot.url,
      fields,
      mapping,
      hasSubmit,
      hasNext,
      firstFormPage: step === 0,
      resumeUploaded,
    })
    logV2(
      'FORM_CLASSIFIED',
      {
        step: step + 1,
        classification: form.classification,
        reason: form.classification === 'UNSUPPORTED_COMPLEX' ? form.reason : null,
        system: v2ApplicationSystem(provider),
      },
      channel,
    )
    if (form.classification === 'UNSUPPORTED_COMPLEX') return unsupportedForm(form.reason, form.detail)

    const basicKeys = [...new Set(mapping.detected.map((field) => field.key).filter((key) => BASIC_FIELD_KEYS.has(key)))]
    if (basicKeys.length > 0) {
      traceV2(run.runId, 'BASIC_FIELDS_DETECTED', { step: step + 1, keys: basicKeys.join(','), unknownRequired: mapping.unknownRequired.length })
    }
    if (mapping.unknownRequired.length > 0) {
      const labels = mapping.unknownRequired.map((field) => field.label).slice(0, 5).join(' | ')
      updateV2Run(run.runId, { fieldsDetected: [...fieldsDetected], fieldsFilled: [...fieldsFilled] })
      return terminal('needs_user_input', `UNKNOWN_REQUIRED_FIELD: ${labels}`)
    }
    const filled = await fillV2Fields(page, mapping.mapped)
    for (const key of filled) fieldsFilled.add(key)
    const basicFilled = filled.filter((key) => BASIC_FIELD_KEYS.has(key))
    if (basicFilled.length > 0) traceV2(run.runId, 'BASIC_FIELDS_FILLED', { step: step + 1, keys: basicFilled.join(',') })
    updateV2Run(run.runId, { fieldsDetected: [...fieldsDetected], fieldsFilled: [...fieldsFilled] })

    if (hasFileInput && !resumeUploaded && mapping.detected.some((field) => field.key === 'resume')) {
      traceV2(run.runId, 'RESUME_INPUT_FOUND', { step: step + 1 })
      track('uploading_resume')
      const accepted = await uploadV2Resume(page, resume)
      if (!accepted) return fail('RESUME_UPLOAD_FAILED', 'The resume file was not accepted by the page.')
      resumeUploaded = true
      traceV2(run.runId, 'RESUME_UPLOADED', {
        resumeVersionId: run.resumeVersionId,
        bytes: resume.buffer.length,
        mimeType: resume.mimeType,
      })
      updateV2Run(run.runId, { resumeUploaded: true })
      if (mapping.mapped.length > 0) {
        // Some providers parse the uploaded resume into the form; the canonical profile values must win.
        await page.waitForTimeout(1500).catch(() => null)
        await fillV2Fields(page, mapping.mapped)
      }
    }

    if (!hasNext && hasSubmit) {
      reachedFinalStep = true
      break
    }
    if (hasNext) {
      track('navigating')
      const advanced = await clickV2Next(page)
      if (!advanced) return fail('NAVIGATION_FAILED', 'The Next control could not be clicked.')
      logV2('NEXT_STEP', { step: step + 1 }, channel)
      await followNavigation(2200)
      updateV2Session(run.runId, { step: step + 1 })
      continue
    }
    return fail('FORM_NOT_FOUND', 'The application step has no Next or Submit control, in the page or its frames.')
  }
  if (!reachedFinalStep) {
    return fail('NAVIGATION_FAILED', 'The application did not reach its final step within 8 steps.')
  }

  track('ready_to_submit')
  if (!(await findV2SubmitControl(page))) return fail('SUBMISSION_FAILED', 'The Submit application control was not found.')
  traceV2(run.runId, 'SUBMIT_BUTTON_FOUND', { url: page.url() })

  track('submitting')
  submitClicked = await clickV2Submit(page)
  if (!submitClicked) return fail('SUBMISSION_FAILED', 'The Submit application control could not be clicked.')
  traceV2(run.runId, 'SUBMIT_CLICKED')
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
    traceV2(run.runId, 'CONFIRMATION_DETECTED', {
      confirmationNumber: Boolean(confirmation.confirmationNumber),
      finalUrl: snapshot.url,
    })
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
  return terminal(
    'submission_uncertain',
    'CONFIRMATION_NOT_FOUND: Submit was clicked, but no reliable confirmation was detected. The run will not be retried.',
    confirmation,
  )

  function unsupportedForm(reason: string, detail: string): V2AgentResult {
    return terminal('unsupported', `UNSUPPORTED_COMPLEX: ${reason}: ${detail}`)
  }

  function terminal(
    status: V2RunStatus,
    failureReason: string,
    confirmationResult: V2Confirmation | null = null,
    resultPageState: V2PageState = 'APPLICATION_PAGE',
  ): V2AgentResult {
    updateV2Run(run.runId, { status, failureReason, finalUrl: snapshot.url, pageState: resultPageState })
    updateV2Session(run.runId, { state: status, currentUrl: snapshot.url })
    logV2('RUN_STOPPED', { status, reason: failureReason.split(':')[0], finalUrl: snapshot.url }, channel)
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
    logV2('RUN_STOPPED', { status: 'failed', reason: code, finalUrl: snapshot.url }, channel)
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
