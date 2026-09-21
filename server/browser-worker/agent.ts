import { inspectApplicationUrl } from '../apply/validate'
import { canEnterAutonomousApply } from '../apply/capability'
import { logStoredApplication, uniqueUrls } from '../apply/diagnose'
import {
  applyDecisionToQueueItem,
  logApplicationPreflightReport,
  statusFromCapability,
} from '../apply/application-preflight'
import { rememberDecision } from '../apply/capability-cache'
import { liveCapabilityPreflight } from '../apply/live-capability'
import { documentsFromEvidencePage } from '../apply/page-evidence'
import { logApplyEvent } from '../apply/log'
import { mergeSurfaceDocuments } from '../apply/surface'
import { resolveApplicationQuestions } from '../apply/questions'
import { detectSubmissionConfirmation, isFinalSubmitLabel } from '../apply/confirm'
import { buildCandidateApplicationProfile, candidateFillValues } from '../application/profile'
import { selectedResumeForUpload } from '../application/resume'
import { persistStepState } from '../application/navigation'
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

function profileValues(profile: AutoApplyProfile, extras?: { userId?: string; resumeText?: string | null; resumeVersionId?: string | null; resumeVersionName?: string }): Record<string, string> {
  return candidateFillValues(
    buildCandidateApplicationProfile({
      userId: extras?.userId,
      profile,
      resumeText: extras?.resumeText,
      resumeVersionId: extras?.resumeVersionId,
      resumeVersionName: extras?.resumeVersionName,
    }),
  )
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
  const stored = logStoredApplication({
    jobId: input.item.jobId,
    company: input.item.company,
    title: input.item.title,
    applicationUrl: input.item.applicationUrl,
    applicationId: input.item.applicationId,
  })
  const inspected = inspectApplicationUrl(stored.url ?? input.item.applicationUrl)
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
  if (!stored.ok || !inspected.ok || !inspected.url) {
    session = markBrowserSessionState(session.itemId, 'failed', {
      failureReason: stored.reason || 'This listing does not include a valid application URL.',
    })
    return { session, status: 'failed', questions: [], failureReason: session.failureReason }
  }
  const initialUrl = inspected.url.toString()
  input.item.initialUrl = input.item.initialUrl || initialUrl
  const decision = await liveCapabilityPreflight({
    jobId: input.item.jobId,
    title: input.item.title,
    company: input.item.company,
    applicationUrl: initialUrl,
    page: input.page,
  })
  applyDecisionToQueueItem(input.item, decision)
  rememberDecision(input.item.identityKey, initialUrl, decision)
  let currentUrl = decision.finalUrl || pageUrl(input.page, initialUrl)
  session = recordBrowserRedirect(session, currentUrl)
  input.item.redirectUrls = uniqueUrls([...(input.item.redirectUrls ?? []), initialUrl, currentUrl])
  logApplicationPreflightReport({
    jobId: input.item.jobId,
    title: input.item.title,
    company: input.item.company,
    discoveryProvider: input.item.discoverySource,
    storedApplicationUrl: input.item.applicationUrl,
    redirectChain: input.item.redirectUrls,
    decision,
  })
  input.item.preflight = {
    capability: decision.capability,
    provider: decision.provider,
    confidence: decision.confidence,
    reasons: decision.evidence,
    blockers: decision.blockers,
    captcha: decision.pageType === 'CAPTCHA_PAGE',
    captchaDetectionConfidence: decision.pageType === 'CAPTCHA_PAGE' ? 'high' : 'none',
    captchaEvidence: decision.pageType === 'CAPTCHA_PAGE' ? decision.blockers : [],
    source: {
      capability: decision.capability,
      provider: decision.provider,
      discoverySource: input.item.discoverySource ?? null,
      applicationSource: decision.provider,
      sourceKind: 'auto_apply_ready',
      confidence: decision.confidence,
      reasons: decision.evidence,
    },
  }
  input.item.captchaDetectionConfidence = input.item.preflight.captchaDetectionConfidence
  input.item.captchaEvidence = input.item.preflight.captchaEvidence

  const mapped = statusFromCapability(decision)
  if (mapped.status === 'captcha_required') {
    recordUserIntervention({
      applicationId: input.item.applicationId || input.item.id,
      itemId: input.item.id,
      reason: 'CAPTCHA_REQUIRED',
      currentUrl,
    })
    session = markBrowserSessionState(session.itemId, 'captcha_required', { currentUrl, provider: decision.provider })
    return { session, status: 'captcha_required', questions: [], failureReason: null }
  }
  if (mapped.status === 'login_required') {
    recordUserIntervention({
      applicationId: input.item.applicationId || input.item.id,
      itemId: input.item.id,
      reason: 'LOGIN_REQUIRED',
      currentUrl,
    })
    session = markBrowserSessionState(session.itemId, 'login_required', { currentUrl, provider: decision.provider })
    return { session, status: 'login_required', questions: [], failureReason: null }
  }
  if (mapped.status === 'mfa_required') {
    recordUserIntervention({
      applicationId: input.item.applicationId || input.item.id,
      itemId: input.item.id,
      reason: 'MFA_REQUIRED',
      currentUrl,
    })
    session = markBrowserSessionState(session.itemId, 'mfa_required', { currentUrl, provider: decision.provider })
    return { session, status: 'mfa_required', questions: [], failureReason: null }
  }
  if (!canEnterAutonomousApply(decision.capability)) {
    session = markBrowserSessionState(session.itemId, mapped.status === 'needs_user_input' ? 'needs_user_input' : 'skipped', {
      currentUrl,
      failureReason: mapped.failureReason,
      provider: decision.provider,
    })
    return {
      session,
      status: mapped.status === 'queued' ? 'skipped' : mapped.status,
      questions: [],
      failureReason: mapped.failureReason,
    }
  }

  let html = (await documentsFromEvidencePage(input.page, currentUrl))[0]?.html ?? (await input.page.content())
  let adapter = detectAtsAdapter({ url: decision.finalUrl || currentUrl, html })
  session = markBrowserSessionState(session.itemId, adapter.id === 'unknown' ? 'job_page' : 'provider_detected', {
    provider: adapter.id,
    currentUrl,
  })

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
  const values = profileValues(input.profile, {
    userId: input.userId,
    resumeText: input.item.tailoredResumeText,
    resumeVersionId: input.item.resumeVersionId,
    resumeVersionName: input.item.resumeVersionName,
  })
  const resumeUpload = selectedResumeForUpload(input.item)
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
    const surface = mergeSurfaceDocuments(await documentsFromEvidencePage(input.page, currentUrl))
    const resolved = resolveApplicationQuestions(surface.inspection.questions, input.profile, input.userId)
    logApplyEvent('question-mapping', {
      jobId: input.item.jobId,
      applicationId: input.item.applicationId,
      itemId: input.item.id,
      resumeVersionId: input.item.resumeVersionId,
      matchScore: input.item.finalMatchScore,
      provider: adapter.id,
      capability: input.item.applicationCapability,
      code: resolved.unknown.length ? 'needs_user_input' : 'mapped',
    })
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
    persistStepState({ step: advanced + 1, pageType: surface.kind, url: currentUrl })
    await adapter.fillFields(input.page, values)
    if (resumeUpload) {
      await adapter.uploadResume(input.page, {
        fileName: resumeUpload.fileName,
        mimeType: resumeUpload.mimeType,
        buffer: resumeUpload.buffer,
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
          failureReason: surface.failureReason || 'The application workflow could not continue after filling.',
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
