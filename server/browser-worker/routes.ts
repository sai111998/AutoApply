import type { Express, Request, Response } from 'express'
import { resumeIntervention } from '../agent'
import { importPlaywright } from '../apply/health'
import { claimNextBrowserJob } from './queue'
import { syntheticEmployerHtml } from './synthetic'

export function registerBrowserWorkerRoutes(app: Express) {
  function sendSynthetic(res: Response, kind: 'job' | 'apply' | 'confirm', base: string) {
    res.type('html').send(syntheticEmployerHtml(kind, base))
  }

  app.get('/browser-worker/synthetic/job', (_req, res) => sendSynthetic(res, 'job', '/browser-worker/synthetic'))
  app.get('/browser-worker/synthetic/apply', (_req, res) => sendSynthetic(res, 'apply', '/browser-worker/synthetic'))
  app.post('/browser-worker/synthetic/submit', (_req, res) => sendSynthetic(res, 'confirm', '/browser-worker/synthetic'))
  app.get('/browser-worker/synthetic/submit', (_req, res) => sendSynthetic(res, 'confirm', '/browser-worker/synthetic'))

  app.get('/test-employer', (_req, res) => sendSynthetic(res, 'job', '/test-employer'))
  app.get('/test-employer/apply', (_req, res) => sendSynthetic(res, 'apply', '/test-employer'))
  app.post('/test-employer/submit', (_req, res) => sendSynthetic(res, 'confirm', '/test-employer'))
  app.get('/test-employer/submit', (_req, res) => sendSynthetic(res, 'confirm', '/test-employer'))

  app.get('/api/browser-worker/health', async (_req: Request, res: Response) => {
    const playwright = await importPlaywright()
    res.json({ ok: Boolean(playwright), playwright: Boolean(playwright), browser: playwright ? 'chromium' : null })
  })

  app.get('/api/browser-worker/next', async (_req: Request, res: Response) => {
    const claimed = await claimNextBrowserJob()
    res.json({ item: claimed?.item ?? null, userId: claimed?.stored.run.userId ?? null })
  })

  app.post('/api/browser-worker/resume', async (req: Request, res: Response) => {
    const itemId = typeof req.body?.itemId === 'string' ? req.body.itemId : ''
    const result = itemId ? await resumeIntervention(itemId) : { intervention: null, item: null }
    res.json({ ok: Boolean(result.intervention || result.item), intervention: result.intervention, item: result.item })
  })
}
