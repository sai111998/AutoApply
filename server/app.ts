import express, { type Express, type Request, type Response } from 'express'
import cors from 'cors'
import type { ServerConfig } from './config'
import { createLlmClient, type LlmClient } from './services/llm'
import { persistAnalysis } from './services/persist'
import {
  analyzeJobDescription,
  parseAnalyzeRequest,
  toResponseBody,
  type PersistFn,
} from './services/analysis'
import { extractResumeText } from './services/resume-text'
import { parseTailorRequest } from './services/tailor-request'
import { tailorResume, validateSubmittedResume } from './tailor/engine'
import { parseTailoredResume } from './tailor/parse'
import { renderResumePdf } from './tailor/pdf'
import { HttpError } from './types'

export interface AppOptions {
  config: ServerConfig
  llm?: LlmClient
  persist?: PersistFn
}

export function createApp(options: AppOptions): Express {
  const app = express()
  const llm = options.llm ?? createLlmClient(options.config)
  const persist = options.persist ?? persistAnalysis

  app.use(cors())
  app.use(express.json({ limit: '1mb' }))

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      llmConfigured: Boolean(options.config.llmApiKey),
      databaseConfigured: Boolean(options.config.supabaseUrl && options.config.supabaseServiceRoleKey),
    })
  })

  app.post(
    '/api/resumes/extract',
    express.raw({ type: () => true, limit: '12mb' }),
    async (req: Request, res: Response) => {
      try {
        const fileName = typeof req.headers['x-file-name'] === 'string' ? req.headers['x-file-name'] : ''
        const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body ?? [])
        const text = await extractResumeText(fileName, buffer)
        res.json({ text })
      } catch (error) {
        const status = error instanceof HttpError ? error.status : 500
        const message = error instanceof Error ? error.message : 'Unexpected error'
        res.status(status).json({ error: message })
      }
    },
  )

  app.post('/api/resumes/tailor', express.json({ limit: '2mb' }), async (req: Request, res: Response) => {
    try {
      const request = parseTailorRequest(req.body)
      const result = await tailorResume(llm, request)
      res.status(result.status === 'complete' ? 200 : 422).json(result)
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500
      const message = error instanceof Error ? error.message : 'Resume tailoring failed.'
      res.status(status).json({
        status: 'failed',
        plan: { skillsToEmphasize: [], relatedSkills: [], missingSkills: [], experienceToEmphasize: [] },
        original: {
          summary: '',
          skills: [],
          experience: [],
          projects: [],
          education: [],
          certifications: [],
          changes: [],
          omissions: [],
          warnings: [],
          contact: { name: '', email: '', location: '' },
        },
        tailored: null,
        validation: { ok: false, errors: [] },
        error: /key|secret|service.role|stack/i.test(message) ? 'Resume tailoring failed.' : message,
      })
    }
  })

  app.post('/api/resumes/validate-tailor', express.json({ limit: '2mb' }), async (req: Request, res: Response) => {
    try {
      const request = parseTailorRequest(req.body)
      const contact = {
        name: request.candidateName?.trim() || '',
        email: request.candidateEmail?.trim() || '',
        location: request.candidateLocation?.trim() || '',
      }
      const tailored = parseTailoredResume((req.body as { tailored?: unknown }).tailored, contact)
      const result = validateSubmittedResume(request, tailored)
      res.status(result.validation.ok ? 200 : 422).json({
        status: result.validation.ok ? 'complete' : 'invalid',
        ...result,
        message: result.validation.ok ? undefined : 'Some generated content could not be verified against your master resume. Please review and regenerate.',
      })
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 400
      const message = error instanceof Error ? error.message : 'Could not validate the tailored resume.'
      res.status(status).json({ error: /key|secret|service.role/i.test(message) ? 'Could not validate the tailored resume.' : message })
    }
  })

  app.post('/api/resumes/pdf', express.json({ limit: '2mb' }), async (req: Request, res: Response) => {
    try {
      const body = req.body as { tailored?: unknown; contact?: { name?: string; email?: string; location?: string } }
      const contact = {
        name: body.contact?.name?.trim() || '',
        email: body.contact?.email?.trim() || '',
        location: body.contact?.location?.trim() || '',
      }
      const tailored = parseTailoredResume(body.tailored ?? body, contact)
      const pdf = await renderResumePdf(tailored)
      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader('Content-Disposition', `attachment; filename="${(tailored.contact.name || 'resume').replace(/[^\w.-]+/g, '_')}.pdf"`)
      res.send(pdf)
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 400
      const message = error instanceof Error ? error.message : 'Could not generate the PDF.'
      res.status(status).json({ error: /key|secret|service.role/i.test(message) ? 'Could not generate the PDF.' : message })
    }
  })

  app.post('/api/jobs/analyze', async (req: Request, res: Response) => {
    try {
      const request = parseAnalyzeRequest(req.body)
      const { result, persist: persistResult } = await analyzeJobDescription(
        options.config,
        llm,
        request,
        persist,
      )
      res.json(toResponseBody(result, persistResult))
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500
      const message = error instanceof Error ? error.message : 'Unexpected error'
      res.status(status).json({ error: message })
    }
  })

  return app
}
