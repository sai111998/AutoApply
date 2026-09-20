import { inspectApplicationUrl } from '../apply/validate'
import { clickApplyControl } from '../apply/apply-action'
import { canEnterAutonomousApply } from '../apply/capability'
import { logApplyEvent } from '../apply/log'
import { analyzeApplicationSurface } from '../apply/surface'
import { resolveApplicationQuestions } from '../apply/questions'
import { detectSubmissionConfirmation, isFinalSubmitLabel } from '../apply/confirm'
import type { AutoApplyProfile, AutoApplyQueueItem, AutoApplyQueueStatus } from '../apply/types'
import { allowUnattendedSubmit } from './profile'
import { detectAtsAdapter } from './providers'
import { recordUserIntervention } from './intervention'
import {
  bindBrowserPage,
  createBrowserApplicationSession,
  markBrowserSessionState,
  recordBrowserRedirect,
} from './session'
import type { BrowserApplicationSession, BrowserPageLike, BrowserSessionState } from './types'
import { queueStatusFromSession } from './types'

async function visibleControlLabels(page: BrowserPageLike): Promise<string[]> {
  const names = ['Apply Now', 'Apply to Job', 'Start Application', 'Apply', 'Next', 'Continue', 'Submit Application', 'Submit']
  const found: string[] = []
  for (const name of names) {
    try {
      const locator = page.getByRole?.('button', { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') })
      const target = locator?.first?.() ?? locator
      const count = target?.count ? await target.count() : 0
      if (count) found.push(name)
      const link = page.getByRole?.('link', { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') })
      const linkTarget = link?.first?.() ?? link
      const linkCount = linkTarget?.count ? await linkTarget.count() : 0
      if (linkCount) found.push(name)
    } catch {
      // Ignore controls that are not present.
    }
  }
  return found
}

function pageUrl(page: BrowserPageLike, fallback: string): string {
  if (!page.url) return fallback
  return typeof page.url === 'function' ? page.url() : page.url
}

function profileValues(profile: AutoApplyProfile): Record<string, string> {
  const [firstName, ...rest] = profile.fullName.trim().split(/\s+/)
  const lastName = rest.join(' ')
  const values: Record<string, string> = {
    fullName: profile.fullName,
    firstName: firstName || '',
    lastName,
    email: profile.email,
    city: profile.location,
  }
  if (profile.yearsOfExperience != null) values.yearsExperience = String(profile.yearsOfExperience)
  if (profile.workAuthorization === 'us_citizen' || profile.workAuthorization === 'us_permanent_resident' || profile.workAuthorization === 'work_visa') {
    values.workAuthorization = 'Yes'
  } else if (profile.workAuthorization === 'needs_sponsorship') {
    values.workAuthorization = 'No'
  }
  values.sponsorship = profile.sponsorshipRequired ? 'Yes' : 'No'
  if (profile.targetSalaryMin != null || profile.targetSalaryMax != null) {
    values.salary = [profile.targetSalaryMin, profile.targetSalaryMax].filter((value) => value != null).join('-')
  }
  return values
}

export interface AgentRunResult {
  session: BrowserApplicationSession
  status: AutoApplyQueueStatus
  questions: AutoApplyQueueItem['questions']
  failureReason: string | null
  confirmationDetected?: boolean
  confirmation?: {
    success: boolean
    confirmed: boolean
    detected?: boolean
    confirmationNumber?: string
    confirmationText?: string
    finalUrl?: string
    provider?: string
    reason?: string
  }
}

export async function runApplicationAgent(input: {
  item: AutoApplyQueueItem
  userId: string
  profile: AutoApplyProfile
  page: BrowserPageLike
  pageId: string
  contextId: string
  autoSubmit?: boolean
}): Promise<AgentRunResult> {
  const inspected = inspectApplicationUrl(input.item.applicationUrl)
  let session = createBrowserApplicationSession({
    applicationId: input.item.applicationId,
    itemId: input.item.id,
    runId: input.item.runId,
    jobId: input.item.jobId,
    resumeVersionId: input.item.resumeVersionId,
    browserContextId: input.contextId,
    applicationUrl: inspected.url?.toString() ?? input.item.applicationUrl ?? '',
  })
  session = bindBrowserPage(session, input.pageId)
  if (!inspected.ok || !inspected.url) {
    session = markBrowserSessionState(session.itemId, 'failed', {
      failureReason: 'This listing does not include a valid application URL.',
    })
    return { session, status: 'failed', questions: [], failureReason: session.failureReason }
  }
  const initialUrl = inspected.url.toString()
  input.item.initialUrl = input.item.initialUrl || initialUrl
  await input.page.goto(initialUrl, { waitUntil: 'domcontentloaded', timeout: 16_000 })
  await input.page.waitForLoadState?.('domcontentloaded', { timeout: 8_000 }).catch(() => undefined)
  let currentUrl = pageUrl(input.page, initialUrl)
  session = recordBrowserRedirect(session, currentUrl)
  input.item.redirectUrls = [...(input.item.redirectUrls ?? []), currentUrl].filter((value, index, all) => all.indexOf(value) === index)
  let html = await input.page.content()
  let adapter = detectAtsAdapter({ url: currentUrl, html })
  const livePreflight = adapter.preflight({ url: currentUrl, html, applicationUrl: initialUrl })
  input.item.preflight = livePreflight
  input.item.applicationProvider = adapter.id
  input.item.applicationCapability = livePreflight.capability
  input.item.captchaDetectionConfidence = livePreflight.captchaDetectionConfidence
  input.item.captchaEvidence = livePreflight.captchaEvidence
  logApplyEvent('application-preflight', {
    jobId: input.item.jobId,
    applicationId: input.item.applicationId,
    itemId: input.item.id,
    resumeVersionId: input.item.resumeVersionId,
    applicationUrl: currentUrl,
    matchScore: input.item.finalMatchScore,
    applicationStatus: input.item.applicationStatus,
    code: livePreflight.capability,
  })
  if (!canEnterAutonomousApply(livePreflight.capability)) {
    if (livePreflight.capability === 'blocked' && livePreflight.captcha) {
      recordUserIntervention({
        applicationId: input.item.applicationId || input.item.id,
        itemId: input.item.id,
        reason: 'CAPTCHA_REQUIRED',
        currentUrl,
      })
      session = markBrowserSessionState(session.itemId, 'captcha_required', { currentUrl, provider: adapter.id })
      return { session, status: 'captcha_required', questions: [], failureReason: null }
    }
    if (livePreflight.capability === 'blocked' && /login/i.test(livePreflight.blockers.join(' '))) {
      recordUserIntervention({
        applicationId: input.item.applicationId || input.item.id,
        itemId: input.item.id,
        reason: 'LOGIN_REQUIRED',
        currentUrl,
      })
      session = markBrowserSessionState(session.itemId, 'login_required', { currentUrl, provider: adapter.id })
      return { session, status: 'login_required', questions: [], failureReason: null }
    }
    if (livePreflight.capability === 'blocked' && /multi-factor|mfa/i.test(livePreflight.blockers.join(' '))) {
      recordUserIntervention({
        applicationId: input.item.applicationId || input.item.id,
        itemId: input.item.id,
        reason: 'MFA_REQUIRED',
        currentUrl,
      })
      session = markBrowserSessionState(session.itemId, 'mfa_required', { currentUrl, provider: adapter.id })
      return { session, status: 'mfa_required', questions: [], failureReason: null }
    }
    if (livePreflight.capability === 'assisted_apply') {
      recordUserIntervention({
        applicationId: input.item.applicationId || input.item.id,
        itemId: input.item.id,
        reason: 'UNKNOWN_REQUIRED_QUESTION',
        currentUrl,
      })
      session = markBrowserSessionState(session.itemId, 'needs_user_input', { currentUrl, provider: adapter.id })
      return { session, status: 'needs_user_input', questions: [], failureReason: null }
    }
    session = markBrowserSessionState(session.itemId, 'failed', {
      currentUrl,
      failureReason: livePreflight.blockers[0] || livePreflight.reasons[0] || 'This application is not Auto-Apply capable.',
    })
    return { session, status: 'skipped', questions: [], failureReason: session.failureReason }
  }
  session = markBrowserSessionState(session.itemId, adapter.id === 'unknown' ? 'job_page' : 'provider_detected', {
    provider: adapter.id,
    currentUrl,
  })
  const analysis = analyzeApplicationSurface(html, { url: currentUrl })
  if (analysis.kind === 'job_details' || (analysis.hasApplyControl && analysis.kind !== 'application' && analysis.kind !== 'blocked')) {
    session = markBrowserSessionState(session.itemId, 'job_page', { currentUrl })
    const opened = await adapter.openApplication(input.page)
    if (!opened) {
      const fallback = await clickApplyControl(input.page)
      if (!fallback.clicked) {
        session = markBrowserSessionState(session.itemId, 'failed', {
          failureReason: 'The employer application form could not be found.',
          currentUrl,
        })
        return { session, status: 'failed', questions: [], failureReason: session.failureReason }
      }
    }
    await input.page.waitForLoadState?.('domcontentloaded', { timeout: 8_000 }).catch(() => undefined)
    currentUrl = pageUrl(input.page, currentUrl)
    session = recordBrowserRedirect(session, currentUrl)
    html = await input.page.content()
    adapter = detectAtsAdapter({ url: currentUrl, html })
  }

  const blocked = adapter.detectBlockingState(html)
  if (blocked === 'CAPTCHA_REQUIRED' || blocked === 'MFA_REQUIRED' || blocked === 'LOGIN_REQUIRED') {
    const state = blocked === 'CAPTCHA_REQUIRED' ? 'captcha_required' : blocked === 'MFA_REQUIRED' ? 'mfa_required' : 'login_required'
    recordUserIntervention({
      applicationId: input.item.applicationId || input.item.id,
      itemId: input.item.id,
      reason: blocked,
      currentUrl,
    })
    session = markBrowserSessionState(session.itemId, state, { currentUrl, provider: adapter.id })
    return { session, status: queueStatusFromSession(state), questions: [], failureReason: null }
  }
  if (blocked === 'APPLICATION_PAGE_BLOCKED') {
    session = markBrowserSessionState(session.itemId, 'failed', {
      currentUrl,
      failureReason: 'The employer site blocked automated interaction. JobPilot will not bypass that protection.',
    })
    return { session, status: 'failed', questions: [], failureReason: session.failureReason }
  }

  session = markBrowserSessionState(session.itemId, 'application_page', { currentUrl, provider: adapter.id })
  const values = profileValues(input.profile)
  const resumeText = input.item.tailoredResumeText
  let advanced = 0
  while (advanced < 8) {
    html = await input.page.content()
    currentUrl = pageUrl(input.page, currentUrl)
    session = recordBrowserRedirect(session, currentUrl)
    input.item.redirectUrls = [...(input.item.redirectUrls ?? []), currentUrl].filter((value, index, all) => all.indexOf(value) === index)
    input.item.finalApplicationUrl = currentUrl
    const pause = adapter.detectBlockingState(html)
    if (pause === 'CAPTCHA_REQUIRED' || pause === 'MFA_REQUIRED' || pause === 'LOGIN_REQUIRED') {
      const state = pause === 'CAPTCHA_REQUIRED' ? 'captcha_required' : pause === 'MFA_REQUIRED' ? 'mfa_required' : 'login_required'
      recordUserIntervention({
        applicationId: input.item.applicationId || input.item.id,
        itemId: input.item.id,
        reason: pause,
        currentUrl,
      })
      session = markBrowserSessionState(session.itemId, state, { currentUrl })
      return { session, status: queueStatusFromSession(state), questions: [], failureReason: null }
    }
    const surface = analyzeApplicationSurface(html, { url: currentUrl })
    const resolved = resolveApplicationQuestions(surface.inspection.questions, input.profile, input.userId)
    if (resolved.unknown.length && surface.kind === 'application') {
      recordUserIntervention({
        applicationId: input.item.applicationId || input.item.id,
        itemId: input.item.id,
        reason: 'UNKNOWN_REQUIRED_QUESTION',
        currentUrl,
      })
      session = markBrowserSessionState(session.itemId, 'needs_user_input', { currentUrl })
      return {
        session,
        status: 'needs_user_input',
        questions: [...resolved.answered, ...resolved.unknown],
        failureReason: null,
      }
    }
    session = markBrowserSessionState(session.itemId, 'filling', { currentUrl, provider: adapter.id })
    await adapter.fillFields(input.page, values)
    if (resumeText?.trim()) {
      await adapter.uploadResume(input.page, {
        fileName: `${input.item.resumeVersionName || 'resume'}.txt`,
        mimeType: 'text/plain',
        buffer: Buffer.from(resumeText),
      })
    }
    const labels = await visibleControlLabels(input.page)
    const hasVisibleNext = labels.some((label) => /^(next|continue|save and continue)$/i.test(label))
    const hasVisibleSubmit = labels.some((label) => /^(submit( my)? application|send application|submit)$/i.test(label))
    const onReview = adapter.detectReview(html) && hasVisibleSubmit && !hasVisibleNext
    if (onReview || (hasVisibleSubmit && !hasVisibleNext)) {
      const title = (await input.page.title?.()) ?? ''
      const shouldSubmit = input.autoSubmit ?? allowUnattendedSubmit(currentUrl)
      if (shouldSubmit) {
        session = markBrowserSessionState(session.itemId, 'submitting', { currentUrl })
        const submitted = await adapter.submit(input.page)
        await input.page.waitForLoadState?.('domcontentloaded', { timeout: 8_000 }).catch(() => undefined)
        const confirmationHtml = await input.page.content()
        const confirmationTitle = (await input.page.title?.()) ?? title
        const confirmationUrl = pageUrl(input.page, currentUrl)
        const confirmation = detectSubmissionConfirmation({ html: confirmationHtml, title: confirmationTitle, url: confirmationUrl, provider: adapter.id })
        if (!submitted || !confirmation.confirmed) {
          session = markBrowserSessionState(session.itemId, 'failed', {
            currentUrl: confirmationUrl,
            failureReason: confirmation.reason ?? 'Submission could not be confirmed on the employer site.',
          })
          return {
            session,
            status: submitted ? 'needs_confirmation' : 'needs_user_confirmation',
            questions: resolved.answered,
            failureReason: confirmation.reason ?? 'Submission could not be confirmed on the employer site.',
            confirmationDetected: false,
            confirmation: { ...confirmation, success: false, confirmed: false },
          }
        }
        session = markBrowserSessionState(session.itemId, 'submitted', { currentUrl: confirmationUrl })
        input.item.finalApplicationUrl = confirmationUrl
        input.item.applicationUrl = confirmationUrl
        return {
          session,
          status: 'submitted',
          questions: resolved.answered,
          failureReason: null,
          confirmationDetected: true,
          confirmation,
        }
      }
      session = markBrowserSessionState(session.itemId, 'ready_for_review', { currentUrl })
      return { session, status: 'ready_for_submission', questions: resolved.answered, failureReason: null }
    }
    const moved = await adapter.advanceStep(input.page)
    if (!moved) {
      if (surface.kind !== 'application') {
        session = markBrowserSessionState(session.itemId, 'failed', {
          currentUrl,
          failureReason: 'The employer application form could not be found.',
        })
        return { session, status: 'failed', questions: [], failureReason: session.failureReason }
      }
      session = markBrowserSessionState(session.itemId, 'ready_for_review', { currentUrl })
      return { session, status: 'ready_for_submission', questions: resolved.answered, failureReason: null }
    }
    advanced += 1
    await input.page.waitForTimeout?.(400)
  }
  session = markBrowserSessionState(session.itemId, 'failed', {
    currentUrl,
    failureReason: 'Application preparation timed out.',
  })
  return { session, status: 'failed', questions: [], failureReason: session.failureReason }
}

export function mapSessionToQueueStatus(state: BrowserSessionState) {
  return queueStatusFromSession(state)
}

export { isFinalSubmitLabel, detectSubmissionConfirmation }
