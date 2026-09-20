import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { Express, Request, Response } from 'express'
import type { ServerConfig } from '../config'
import { HttpError } from '../types'
import { applyExtensionEvent, getExtensionSession, startExtensionSession } from './sessions'
import { getExtensionApplicationContext } from './context'
import { heartbeatExtensionConnection, isExtensionConnected, registerExtensionConnection } from './connection'
import { applyAutomationEvent, nextAutomationQueueItem, peekAutomationQueueItem } from './queue'
import { getStoredProfile, getStoredResume } from './profile-store'
import { AUTOMATION_EVENT_TYPES, type AutomationEvent } from '../../extension/src/shared/queue'
import { profileFillValues } from '../../extension/src/agent/answers'

function queryString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function userIdFrom(req: Request): string {
  const header = req.header('x-jobpilot-user-id')?.trim() ?? ''
  const query = queryString(req.query.userId)
  const body = req.body && typeof req.body === 'object' ? String((req.body as { userId?: unknown }).userId ?? '').trim() : ''
  return header || body || query
}

function requireUserId(req: Request): string {
  const userId = userIdFrom(req)
  if (!userId) throw new HttpError(401, 'userId is required')
  return userId
}

function sendError(res: Response, error: unknown, fallback: string) {
  if (error instanceof HttpError) {
    res.status(error.status).json({ success: false, error: error.message })
    return
  }
  res.status(500).json({ success: false, error: fallback })
}

export function registerExtensionRoutes(app: Express, config?: ServerConfig) {
  app.get('/extension/test/application.html', (_req, res) => {
    const file = path.resolve(process.cwd(), 'extension/test-pages/synthetic-application.html')
    res.type('html').send(readFileSync(file, 'utf8'))
  })

  app.get('/extension/test/synthetic-application.html', (_req, res) => {
    const file = path.resolve(process.cwd(), 'extension/test-pages/synthetic-application.html')
    res.type('html').send(readFileSync(file, 'utf8'))
  })

  app.get('/extension/test/job.html', (_req, res) => {
    const file = path.resolve(process.cwd(), 'extension/test-pages/job-details.html')
    res.type('html').send(readFileSync(file, 'utf8'))
  })

  app.get('/api/extension/context', async (req: Request, res: Response) => {
    try {
      const userId = requireUserId(req)
      const context = await getExtensionApplicationContext(
        {
          userId,
          applicationId: queryString(req.query.applicationId) || undefined,
          jobId: queryString(req.query.jobId) || undefined,
          resumeVersionId: queryString(req.query.resumeVersionId) || undefined,
          applicationSessionId: queryString(req.query.applicationSessionId) || undefined,
        },
        config,
      )
      res.json(context)
    } catch (error) {
      sendError(res, error, 'Could not load the application context.')
    }
  })

  app.get('/api/extension/job', async (req: Request, res: Response) => {
    try {
      const userId = requireUserId(req)
      const context = await getExtensionApplicationContext(
        {
          userId,
          jobId: queryString(req.query.jobId) || undefined,
          applicationId: queryString(req.query.applicationId) || undefined,
        },
        config,
      )
      res.json({ job: context.job })
    } catch (error) {
      sendError(res, error, 'Could not load job information.')
    }
  })

  app.get('/api/extension/questions', async (req: Request, res: Response) => {
    try {
      const userId = requireUserId(req)
      const context = await getExtensionApplicationContext(
        {
          userId,
          jobId: queryString(req.query.jobId) || undefined,
          applicationId: queryString(req.query.applicationId) || undefined,
        },
        config,
      )
      res.json({ questions: context.questions })
    } catch (error) {
      sendError(res, error, 'Could not load application questions.')
    }
  })

  app.get('/api/extension/profile', (req: Request, res: Response) => {
    try {
      const userId = requireUserId(req)
      const stored = getStoredProfile(userId)
      res.json({ profile: stored ? profileFillValues(stored) : null })
    } catch (error) {
      sendError(res, error, 'Could not load the profile.')
    }
  })

  app.get('/api/extension/resume', async (req: Request, res: Response) => {
    try {
      const userId = requireUserId(req)
      const applicationId = queryString(req.query.applicationId) || queryString(req.query.itemId)
      const stored = applicationId ? getStoredResume(userId, applicationId) : null
      if (!stored?.text) {
        res.json({
          resume: { versionId: queryString(req.query.resumeVersionId) || null, name: 'Master' },
          available: false,
          reason: 'The selected resume is not available for this application.',
        })
        return
      }
      res.json({
        resume: {
          versionId: stored.versionId,
          name: stored.name,
          fileName: 'resume.txt',
          mimeType: 'text/plain',
          contentBase64: Buffer.from(stored.text).toString('base64'),
        },
        available: true,
      })
    } catch (error) {
      sendError(res, error, 'Could not load the resume.')
    }
  })

  app.post('/api/extension/sessions', (req: Request, res: Response) => {
    try {
      const userId = requireUserId(req)
      const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {}
      const session = startExtensionSession({
        userId,
        jobId: typeof body.jobId === 'string' ? body.jobId : null,
        applicationId: typeof body.applicationId === 'string' ? body.applicationId : null,
        resumeVersionId: typeof body.resumeVersionId === 'string' ? body.resumeVersionId : null,
        currentUrl: typeof body.currentUrl === 'string' ? body.currentUrl : null,
      })
      res.json({ session })
    } catch (error) {
      sendError(res, error, 'Could not start the extension session.')
    }
  })

  app.get('/api/extension/sessions/:sessionId', (req: Request, res: Response) => {
    try {
      const userId = requireUserId(req)
      const sessionId = typeof req.params.sessionId === 'string' ? req.params.sessionId : ''
      const session = getExtensionSession(sessionId, userId)
      if (!session) {
        res.status(404).json({ success: false, error: 'Extension session was not found.' })
        return
      }
      res.json({ session })
    } catch (error) {
      sendError(res, error, 'Could not load the extension session.')
    }
  })

  app.post('/api/extension/sessions/:sessionId/events', (req: Request, res: Response) => {
    try {
      const userId = requireUserId(req)
      const sessionId = typeof req.params.sessionId === 'string' ? req.params.sessionId : ''
      const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {}
      const session = applyExtensionEvent(sessionId, userId, body.message)
      if (!session) {
        res.status(404).json({ success: false, error: 'Extension session was not found.' })
        return
      }
      res.json({ session })
    } catch (error) {
      sendError(res, error, 'Could not record the extension event.')
    }
  })

  app.post('/api/automation/extension/register', (req: Request, res: Response) => {
    try {
      const userId = requireUserId(req)
      const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {}
      const connection = registerExtensionConnection(userId, typeof body.extensionId === 'string' ? body.extensionId : 'unpacked')
      res.json({ connected: true, connection })
    } catch (error) {
      sendError(res, error, 'Could not register the extension.')
    }
  })

  app.post('/api/automation/extension/heartbeat', (req: Request, res: Response) => {
    try {
      const userId = requireUserId(req)
      const connection = heartbeatExtensionConnection(userId) ?? registerExtensionConnection(userId)
      res.json({ connected: isExtensionConnected(userId), connection })
    } catch (error) {
      sendError(res, error, 'Could not update the extension connection.')
    }
  })

  app.get('/api/automation/extension/status', (req: Request, res: Response) => {
    try {
      const userId = requireUserId(req)
      res.json({ connected: isExtensionConnected(userId) })
    } catch (error) {
      sendError(res, error, 'Could not load extension status.')
    }
  })

  app.get('/api/automation/queue/next', async (req: Request, res: Response) => {
    try {
      const userId = requireUserId(req)
      const peek = queryString(req.query.claim) === '0' || queryString(req.query.peek) === '1'
      const result = peek ? await peekAutomationQueueItem(userId, config) : await nextAutomationQueueItem(userId, config)
      res.json(result)
    } catch (error) {
      sendError(res, error, 'Could not load the next application.')
    }
  })

  app.post('/api/automation/events', async (req: Request, res: Response) => {
    try {
      const userId = requireUserId(req)
      const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {}
      const type = typeof body.type === 'string' ? body.type : ''
      if (!(AUTOMATION_EVENT_TYPES as readonly string[]).includes(type)) {
        res.status(400).json({ success: false, error: 'Unknown automation event.' })
        return
      }
      const questions = Array.isArray(body.questions)
        ? body.questions
            .map((entry) => {
              if (!entry || typeof entry !== 'object') return null
              const row = entry as { id?: unknown; prompt?: unknown; answer?: unknown }
              if (typeof row.prompt !== 'string' || !row.prompt.trim()) return null
              return {
                id: typeof row.id === 'string' && row.id.trim() ? row.id : `unknown-${row.prompt.slice(0, 24)}`,
                prompt: row.prompt,
                answer: typeof row.answer === 'string' ? row.answer : null,
              }
            })
            .filter((entry): entry is { id: string; prompt: string; answer: string | null } => Boolean(entry))
        : undefined
      const event: AutomationEvent = {
        type: type as AutomationEvent['type'],
        runId: typeof body.runId === 'string' ? body.runId : undefined,
        itemId: typeof body.itemId === 'string' ? body.itemId : undefined,
        applicationId: typeof body.applicationId === 'string' ? body.applicationId : null,
        currentUrl: typeof body.currentUrl === 'string' ? body.currentUrl : null,
        provider: typeof body.provider === 'string' ? body.provider : undefined,
        reason: typeof body.reason === 'string' ? body.reason : null,
        questions,
        confirmationText: typeof body.confirmationText === 'string' ? body.confirmationText : null,
        confirmationNumber: typeof body.confirmationNumber === 'string' ? body.confirmationNumber : null,
      }
      const item = await applyAutomationEvent(userId, event, { html: typeof body.html === 'string' ? body.html : undefined, title: typeof body.title === 'string' ? body.title : undefined }, config)
      if (!item) {
        res.status(404).json({ success: false, error: 'Application was not found.' })
        return
      }
      res.json({ item })
    } catch (error) {
      sendError(res, error, 'Could not record the automation event.')
    }
  })
}
