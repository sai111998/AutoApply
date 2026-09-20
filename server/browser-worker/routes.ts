import type { Express, Request, Response } from 'express'
import { importPlaywright } from '../apply/health'
import { claimNextBrowserJob, notifyBrowserWorker } from './queue'
import { resolveUserIntervention } from './intervention'
import { syntheticEmployerHtml } from './synthetic'

export function registerBrowserWorkerRoutes(app: Express) {
  app.get('/browser-worker/synthetic/job', (_req, res) => {
    res.type('html').send(syntheticEmployerHtml('job'))
  })
  app.get('/browser-worker/synthetic/apply', (_req, res) => {
    res.type('html').send(syntheticEmployerHtml('apply'))
  })
  app.post('/browser-worker/synthetic/submit', (_req, res) => {
    res.type('html').send(syntheticEmployerHtml('confirm'))
  })
  app.get('/browser-worker/synthetic/submit', (_req, res) => {
    res.type('html').send(syntheticEmployerHtml('confirm'))
  })

  app.get('/api/browser-worker/health', async (_req: Request, res: Response) => {
    const playwright = await importPlaywright()
    res.json({ ok: Boolean(playwright), playwright: Boolean(playwright), browser: playwright ? 'chromium' : null })
  })

  app.get('/api/browser-worker/next', async (_req: Request, res: Response) => {
    const claimed = await claimNextBrowserJob()
    res.json({ item: claimed?.item ?? null, userId: claimed?.stored.run.userId ?? null })
  })

  app.post('/api/browser-worker/resume', (req: Request, res: Response) => {
    const itemId = typeof req.body?.itemId === 'string' ? req.body.itemId : ''
    const intervention = itemId ? resolveUserIntervention(itemId) : null
    notifyBrowserWorker()
    res.json({ ok: Boolean(intervention), intervention })
  })
}
