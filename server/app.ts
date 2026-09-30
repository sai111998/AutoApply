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
import { HttpError } from './types'
import { listLiveJobs } from './jobs/list'
import { rememberLiveJobs } from './jobs/live-store'
import { parseLiveJobsRequest } from './jobs/parse'

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

  app.get('/api/jobs', async (req: Request, res: Response) => {
    try {
      const request = parseLiveJobsRequest(req.query)
      const result = await listLiveJobs(options.config, request)
      rememberLiveJobs(result.jobs)
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
      const result = await listLiveJobs(options.config, request)
      rememberLiveJobs(result.jobs)
      res.json(result)
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500
      const message = error instanceof Error ? error.message : 'Live job source temporarily unavailable.'
      res.status(status).json({
        error: /key|secret|service.role/i.test(message) ? 'Live job source temporarily unavailable.' : message,
      })
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
