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
