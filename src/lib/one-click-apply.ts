import type { ApplyOneStatus } from '@/lib/ai/client'

export interface ApplyOneOutcome {
  message: string
  tone: 'success' | 'info' | 'error'
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
  options: { intervalMs?: number; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<ApplyOneStatus> {
  const deadline = Date.now() + (options.timeoutMs ?? 15 * 60_000)
  for (;;) {
    const status = await getStatus(runId)
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
