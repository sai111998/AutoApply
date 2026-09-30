import { ApplyOneError, type ApplyOneStatus } from '@/lib/ai/client'

export interface ApplyOneOutcome {
  message: string
  tone: 'success' | 'info' | 'error'
}

export interface ApplyOneDebug {
  jobId: string
  employer: string
  title: string
  applicationSystem: string
  stage: string
  status: string
  failure: string | null
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new DOMException('Aborted', 'AbortError'))
      },
      { once: true },
    )
  })
}

export async function waitForApplyOneOutcome(
  runId: string,
  getStatus: (runId: string) => Promise<ApplyOneStatus>,
  options: { intervalMs?: number; timeoutMs?: number; signal?: AbortSignal; onStatus?: (status: ApplyOneStatus) => void } = {},
): Promise<ApplyOneStatus> {
  const deadline = Date.now() + (options.timeoutMs ?? 15 * 60_000)
  for (;;) {
    const status = await getStatus(runId)
    options.onStatus?.(status)
    if (status.queueState === 'finished' || status.queueState === 'not_consumed' || Date.now() >= deadline) return status
    await sleep(options.intervalMs ?? 3000, options.signal)
  }
}

function blockerText(status: ApplyOneStatus): string {
  const blocker = status.blocker
  if (!blocker) return status.state
  if (!blocker.message || blocker.message === blocker.code || /key|secret|service.role|token/i.test(blocker.message)) {
    return blocker.code
  }
  return `${blocker.message} (${blocker.code})`
}

export function applicationSystemForUrl(url: string | null | undefined): 'Lever' | 'Greenhouse' | 'Other' {
  const value = (url ?? '').toLowerCase()
  if (value.includes('lever.co')) return 'Lever'
  if (value.includes('greenhouse')) return 'Greenhouse'
  return 'Other'
}

export function applyOneDebugFromStatus(status: ApplyOneStatus): ApplyOneDebug {
  return {
    jobId: status.jobId,
    employer: status.employer,
    title: status.title,
    applicationSystem: status.applicationSystem,
    stage: status.currentStage ?? 'START',
    status: status.queueState === 'finished' ? status.state : `${status.state} (in progress)`,
    failure: status.blocker ? blockerText(status) : null,
  }
}

const JOB_LOADED_FAILURES = new Set(['UNSUPPORTED_COMPLEX', 'PROFILE_NOT_FOUND', 'PROFILE_INCOMPLETE', 'RESUME_NOT_FOUND', 'WORKER_BUSY'])

export function applyOneDebugFromError(
  error: unknown,
  job: { id: string; title: string; company?: string | null; jobUrl?: string | null; url?: string | null },
): ApplyOneDebug {
  const code = error instanceof ApplyOneError ? error.code : null
  return {
    jobId: job.id,
    employer: job.company || 'Unknown company',
    title: job.title,
    applicationSystem:
      (error instanceof ApplyOneError ? error.applicationSystem : null) ?? applicationSystemForUrl(job.jobUrl || job.url),
    stage: code && JOB_LOADED_FAILURES.has(code) ? 'JOB_LOADED' : 'START',
    status: code === 'UNSUPPORTED_COMPLEX' ? 'unsupported' : 'failed',
    failure: error instanceof Error ? error.message : 'Could not start Apply Now.',
  }
}

export function applyOneOutcome(status: ApplyOneStatus, job: { title: string; company?: string | null }): ApplyOneOutcome {
  const target = `${job.title} at ${job.company || 'the employer'}`
  if (status.state === 'submitted' && status.submissionConfirmed) {
    if (status.blocker) {
      return {
        tone: 'error',
        message: `Applied to ${target} and the employer confirmed it, but the Applications record was not saved: ${blockerText(status)}`,
      }
    }
    return { tone: 'success', message: `Applied to ${target}. The employer confirmed the submission.` }
  }
  if (status.queueState === 'not_consumed') {
    return { tone: 'error', message: `Apply Now for ${target} is waiting, but the application worker is not picking it up (QUEUE_NOT_CONSUMED).` }
  }
  if (status.queueState !== 'finished') {
    return { tone: 'info', message: `Apply Now is still working on ${target} (${status.state}).` }
  }
  switch (status.state) {
    case 'unsupported':
      return { tone: 'info', message: `Apply Now skipped ${target}: the application is not a simple form yet. ${blockerText(status)}` }
    case 'needs_user_input':
      return { tone: 'info', message: `${target} needs your input before it can be submitted: ${blockerText(status)}` }
    case 'captcha_required':
      return { tone: 'info', message: `${target} shows a CAPTCHA. JobPilot stopped without submitting (CAPTCHA_REQUIRED).` }
    case 'login_required':
      return { tone: 'info', message: `${target} requires signing in to the employer site. JobPilot stopped without submitting (LOGIN_REQUIRED).` }
    case 'mfa_required':
      return { tone: 'info', message: `${target} asked for a verification code. JobPilot stopped without submitting (MFA_REQUIRED).` }
    case 'submission_uncertain':
      return {
        tone: 'error',
        message: `Submit was clicked for ${target}, but no confirmation was detected. JobPilot will not submit it again: ${blockerText(status)}`,
      }
    default:
      return { tone: 'error', message: `Apply Now stopped for ${target}: ${blockerText(status)}` }
  }
}
