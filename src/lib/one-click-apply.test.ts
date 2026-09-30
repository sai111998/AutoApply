import { describe, expect, it, vi } from 'vitest'
import { ApplyOneError, type ApplyOneStatus } from '@/lib/ai/client'
import { applyOneDebugFromError, applyOneDebugFromStatus, applyOneOutcome, waitForApplyOneOutcome } from './one-click-apply'

function status(overrides: Partial<ApplyOneStatus> = {}): ApplyOneStatus {
  return {
    runId: 'run-1',
    applicationId: null,
    jobId: 'job-1',
    employer: 'Acme',
    title: 'Senior Engineer',
    applicationSystem: 'Greenhouse',
    currentStage: 'JOB_LOADED',
    state: 'queued',
    provider: null,
    currentUrl: null,
    queueState: 'queued',
    workerState: 'idle',
    browserState: 'not_started',
    submissionAttempted: false,
    submissionConfirmed: false,
    blocker: null,
    trace: [],
    firstMissingStage: 'WORKER_STARTED',
    ...overrides,
  }
}

const job = { title: 'Senior Engineer', company: 'Acme' }

describe('waitForApplyOneOutcome', () => {
  it('polls the run until it finishes', async () => {
    const sequence = [
      status(),
      status({ state: 'filling', queueState: 'processing' }),
      status({ state: 'submitted', queueState: 'finished', submissionAttempted: true, submissionConfirmed: true }),
    ]
    const getStatus = vi.fn(async () => sequence.shift()!)
    const final = await waitForApplyOneOutcome('run-1', getStatus, { intervalMs: 1 })
    expect(final.state).toBe('submitted')
    expect(getStatus).toHaveBeenCalledTimes(3)
  })

  it('stops when the queue is not consumed or the page goes away', async () => {
    const notConsumed = status({ queueState: 'not_consumed', blocker: { code: 'QUEUE_NOT_CONSUMED', message: 'stuck' } })
    await expect(waitForApplyOneOutcome('run-1', async () => notConsumed, { intervalMs: 1 })).resolves.toBe(notConsumed)
    const controller = new AbortController()
    const pending = waitForApplyOneOutcome('run-1', async () => status({ queueState: 'processing' }), {
      intervalMs: 60_000,
      signal: controller.signal,
    })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('applyOneOutcome', () => {
  it('only reports Applied for a confirmed submission', () => {
    expect(
      applyOneOutcome(status({ state: 'submitted', queueState: 'finished', submissionAttempted: true, submissionConfirmed: true }), job),
    ).toEqual({ tone: 'success', message: 'Applied to Senior Engineer at Acme. The employer confirmed the submission.' })
    const uncertain = applyOneOutcome(
      status({
        state: 'submission_uncertain',
        queueState: 'finished',
        submissionAttempted: true,
        blocker: { code: 'CONFIRMATION_NOT_FOUND', message: 'Submit was clicked, but no reliable confirmation was detected.' },
      }),
      job,
    )
    expect(uncertain.tone).toBe('error')
    expect(uncertain.message).not.toMatch(/^Applied/)
    expect(uncertain.message).toMatch(/CONFIRMATION_NOT_FOUND/)
  })

  it('names each blocker with its exact code', () => {
    const finished = (state: string, code: string, message = code) =>
      applyOneOutcome(status({ state, queueState: 'finished', blocker: { code, message } }), job).message
    expect(finished('needs_user_input', 'UNKNOWN_REQUIRED_FIELD', 'Years of Rust experience *')).toBe(
      'Senior Engineer at Acme needs your input before it can be submitted: Years of Rust experience * (UNKNOWN_REQUIRED_FIELD)',
    )
    expect(finished('captcha_required', 'CAPTCHA_REQUIRED')).toMatch(/CAPTCHA_REQUIRED/)
    expect(finished('login_required', 'LOGIN_REQUIRED')).toMatch(/LOGIN_REQUIRED/)
    expect(finished('mfa_required', 'MFA_REQUIRED')).toMatch(/MFA_REQUIRED/)
    expect(finished('failed', 'APPLY_BUTTON_NOT_FOUND', 'The job page has no legitimate Apply control.')).toBe(
      'Apply Now stopped for Senior Engineer at Acme: The job page has no legitimate Apply control. (APPLY_BUTTON_NOT_FOUND)',
    )
    expect(finished('failed', 'APPLICATION_NOT_PERSISTED', 'needs a valid SUPABASE_SERVICE_ROLE_KEY')).toBe(
      'Apply Now stopped for Senior Engineer at Acme: APPLICATION_NOT_PERSISTED',
    )
    expect(applyOneOutcome(status({ queueState: 'not_consumed' }), job).message).toMatch(/QUEUE_NOT_CONSUMED/)
  })

  it('flags a confirmed submission whose Applications record was not saved', () => {
    const outcome = applyOneOutcome(
      status({
        state: 'submitted',
        queueState: 'finished',
        submissionAttempted: true,
        submissionConfirmed: true,
        blocker: { code: 'APPLICATION_NOT_PERSISTED', message: 'The public.applications row was not found after saving.' },
      }),
      job,
    )
    expect(outcome.tone).toBe('error')
    expect(outcome.message).toMatch(/Applications record was not saved.*APPLICATION_NOT_PERSISTED/)
  })

  it('does not report Applied when the form is not a simple Lever or Greenhouse application', () => {
    const outcome = applyOneOutcome(
      status({
        state: 'unsupported',
        queueState: 'finished',
        applicationSystem: 'Other',
        blocker: { code: 'UNSUPPORTED_COMPLEX', message: 'WORKDAY: host is a Workday careers site' },
      }),
      job,
    )
    expect(outcome.tone).toBe('info')
    expect(outcome.message).toMatch(/not a simple form yet/)
    expect(outcome.message).toMatch(/WORKDAY/)
    expect(outcome.message).not.toMatch(/^Applied/)
  })
})

describe('Apply Now debug', () => {
  it('shows the employer, system, stage, and failure from a status poll', () => {
    expect(
      applyOneDebugFromStatus(
        status({
          state: 'filling',
          queueState: 'processing',
          currentStage: 'RESUME_UPLOADED',
          applicationSystem: 'Lever',
        }),
      ),
    ).toMatchObject({
      employer: 'Acme',
      title: 'Senior Engineer',
      applicationSystem: 'Lever',
      stage: 'RESUME_UPLOADED',
      status: 'filling (in progress)',
      failure: null,
    })
  })

  it('keeps a rejected Workday job at JOB_LOADED with the structured reason', () => {
    const error = new ApplyOneError(
      'UNSUPPORTED_COMPLEX',
      'This application is not a simple form. (UNSUPPORTED_COMPLEX: WORKDAY)',
      'WORKDAY',
      'Other',
    )
    expect(
      applyOneDebugFromError(error, {
        id: 'job-1',
        title: 'Engineer',
        company: 'Cisco',
        jobUrl: 'https://cisco.wd5.myworkdayjobs.com/jobs/1',
      }),
    ).toEqual({
      jobId: 'job-1',
      employer: 'Cisco',
      title: 'Engineer',
      applicationSystem: 'Other',
      stage: 'JOB_LOADED',
      status: 'unsupported',
      failure: 'This application is not a simple form. (UNSUPPORTED_COMPLEX: WORKDAY)',
    })
  })
})
