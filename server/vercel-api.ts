import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Express } from 'express'
import { createApp } from './app'
import { getServerConfig } from './config'

export function restoreApiPath(url: string | undefined): string {
  const raw = url && url.length ? url : '/'
  const queryIndex = raw.indexOf('?')
  const pathOnly = queryIndex === -1 ? raw : raw.slice(0, queryIndex)
  const query = queryIndex === -1 ? '' : raw.slice(queryIndex)
  if (pathOnly === '/api' || pathOnly.startsWith('/api/')) return raw
  const suffix = pathOnly.startsWith('/') ? pathOnly : `/${pathOnly}`
  if (suffix === '/') return `/api${query}`
  return `/api${suffix}${query}`
}

export function createExpressVercelHandler(app: Express) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    req.url = restoreApiPath(req.url)
    app(req as never, res as never)
  }
}

export function createVercelHandler() {
  return createExpressVercelHandler(createApp({ config: getServerConfig() }))
}
