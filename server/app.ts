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
import { discoverJobs } from './jobs/discover'
import { listLiveJobs } from './jobs/list'
import { previewLiveJobTailor } from './jobs/preview'
import type { FetchLike } from './jobs/http'
import { parseDiscoverRequest, parseLiveJobPreviewRequest, parseLiveJobsRequest, parseNormalizedJob } from './jobs/parse'
import { createJobProviders, fetchProviderJob, providerStatuses } from './jobs/provider'
import { persistSavedJob } from './jobs/store'
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
  fetchImpl?: FetchLike
}

export function createApp(options: AppOptions): Express {
  const app = express()
  const llm = options.llm ?? createLlmClient(options.config)
  const persist = options.persist ?? persistAnalysis

  app.use(cors())
  app.use(express.json({ limit: '2mb' }))

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      llmConfigured: Boolean(options.config.llmApiKey),
      databaseConfigured: Boolean(options.config.supabaseUrl && options.config.supabaseServiceRoleKey),
      jobProviders: providerStatuses(createJobProviders(options.config, options.fetchImpl)),
    })
  })

  app.get('/api/jobs', async (req: Request, res: Response) => {
    try {
      const request = parseLiveJobsRequest(req.query)
      const result = await listLiveJobs(options.config, request, options.fetchImpl)
      res.json(result)
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500
      const message = error instanceof Error ? error.message : 'Live job source temporarily unavailable.'
      res.status(status).json({
        error: /key|secret|service.role/i.test(message) ? 'Live job source temporarily unavailable.' : message,
      })
    }
  })

  app.post('/api/jobs', async (req: Request, res: Response) => {
    try {
      const request = parseLiveJobsRequest(req.query, req.body)
      const result = await listLiveJobs(options.config, request, options.fetchImpl)
      res.json(result)
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500
      const message = error instanceof Error ? error.message : 'Live job source temporarily unavailable.'
      res.status(status).json({
        error: /key|secret|service.role/i.test(message) ? 'Live job source temporarily unavailable.' : message,
      })
    }
  })

  app.post('/api/jobs/preview', async (req: Request, res: Response) => {
    try {
      const request = parseLiveJobPreviewRequest(req.body)
      res.json(previewLiveJobTailor(request))
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500
      const message = error instanceof Error ? error.message : 'Could not preview the tailored resume match.'
      res.status(status).json({
        error: /key|secret|service.role/i.test(message) ? 'Could not preview the tailored resume match.' : message,
      })
    }
  })

  app.post('/api/jobs/discover', async (req: Request, res: Response) => {
    try {
      const request = parseDiscoverRequest(req.body)
      const result = await discoverJobs(options.config, request, options.fetchImpl)
      res.json(result)
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500
      const message = error instanceof Error ? error.message : 'Job discovery failed.'
      res.status(status).json({ error: /key|secret|service.role/i.test(message) ? 'Job discovery failed.' : message })
    }
  })

  app.post('/api/jobs/save', async (req: Request, res: Response) => {
    try {
      const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {}
      const userId = typeof body.userId === 'string' ? body.userId.trim() : ''
      if (!userId) throw new HttpError(400, 'userId is required to save a job.')
      const job = parseNormalizedJob(body.job)
      const result = await persistSavedJob(options.config, userId, job)
      res.json({ ok: true, jobId: result.jobId, applicationCreated: false })
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500
      const message = error instanceof Error ? error.message : 'Could not save the job.'
      res.status(status).json({ error: /key|secret|service.role/i.test(message) ? 'Could not save the job.' : message })
    }
  })

  app.get('/api/jobs/live/:provider/:jobId', async (req: Request, res: Response) => {
    try {
      const provider = typeof req.params.provider === 'string' ? req.params.provider : ''
      const jobId = typeof req.params.jobId === 'string' ? req.params.jobId : ''
      if (!provider || !jobId) throw new HttpError(400, 'provider and jobId are required.')
      const job = await fetchProviderJob(options.config, provider, jobId, options.fetchImpl)
      if (!job) {
        res.status(404).json({ error: 'Live job source temporarily unavailable.' })
        return
      }
      res.json(job)
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500
      const message = error instanceof Error ? error.message : 'Live job source temporarily unavailable.'
      res.status(status).json({ error: /key|secret|service.role/i.test(message) ? 'Live job source temporarily unavailable.' : message })
    }
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

  app.post('/api/resumes/tailor', async (req: Request, res: Response) => {
    const started = Date.now()
    try {
      const request = parseTailorRequest(req.body)
      console.info('[tailor] request', {
        resumeId: request.resumeId ?? null,
        jobId: request.jobId ?? null,
        matchId: request.matchId ?? null,
        resumeChars: request.resumeText.length,
        jobChars: request.jobDescription.length,
        llmConfigured: Boolean(options.config.llmApiKey),
      })
      const result = await tailorResume(llm, request)
      console.info('[tailor] response', {
        status: result.status,
        durationMs: Date.now() - started,
        hasTailored: Boolean(result.tailored),
      })
      res.status(result.status === 'complete' ? 200 : 422).json(result)
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500
      const message = error instanceof Error ? error.message : 'Resume tailoring failed.'
      console.info('[tailor] error', {
        status,
        durationMs: Date.now() - started,
        code: error instanceof HttpError ? error.status : 'error',
      })
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
    const started = Date.now()
    console.info('[analyze] request', { method: 'POST', path: '/api/jobs/analyze' })
    try {
      const request = parseAnalyzeRequest(req.body)
      const { result, persist: persistResult } = await analyzeJobDescription(
        options.config,
        llm,
        request,
        persist,
      )
      console.info('[analyze] response', { status: 200, durationMs: Date.now() - started })
      res.json(toResponseBody(result, persistResult))
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500
      const message = error instanceof Error ? error.message : 'Unexpected error'
      console.info('[analyze] response', { status, durationMs: Date.now() - started })
      res.status(status).json({ error: message })
    }
  })

  app.use((req: Request, res: Response) => {
    console.info('[api] unmatched', { method: req.method, path: req.path, status: 404 })
    res.status(404).json({ error: `No API route for ${req.method} ${req.path}` })
  })

  return app
}
