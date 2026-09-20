import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { Express, Request, Response } from 'express'
import type { ServerConfig } from '../config'
import { HttpError } from '../types'
import { applyExtensionEvent, getExtensionSession, startExtensionSession } from './sessions'
import { getExtensionApplicationContext } from './context'

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
      requireUserId(req)
      res.json({ profile: null })
    } catch (error) {
      sendError(res, error, 'Could not load the profile.')
    }
  })

  app.get('/api/extension/resume', async (req: Request, res: Response) => {
    try {
      const userId = requireUserId(req)
      const context = await getExtensionApplicationContext(
        {
          userId,
          resumeVersionId: queryString(req.query.resumeVersionId) || undefined,
          applicationId: queryString(req.query.applicationId) || undefined,
          jobId: queryString(req.query.jobId) || undefined,
        },
        config,
      )
      res.json({
        resume: context.resume,
        available: false,
        reason: 'Resume file transfer is not enabled in this milestone.',
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
}
