import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('job analysis API routing', () => {
  const client = readFileSync(path.resolve(process.cwd(), 'src/lib/ai/client.ts'), 'utf8')
  const app = readFileSync(path.resolve(process.cwd(), 'server/app.ts'), 'utf8')
  const vercel = readFileSync(path.resolve(process.cwd(), 'vercel.json'), 'utf8')
  const vite = readFileSync(path.resolve(process.cwd(), 'vite.config.ts'), 'utf8')
  const handler = readFileSync(path.resolve(process.cwd(), 'api/[...path].ts'), 'utf8')

  it('uses the same live jobs catalog path on the client and Express app', () => {
    expect(client).toMatch(/fetch\(apiUrl\(`\/api\/jobs\?/)
    expect(client).toMatch(/fetch\(apiUrl\('\/api\/jobs'\)/)
    expect(app).toMatch(/app\.get\('\/api\/jobs'/)
    expect(app).toMatch(/app\.post\('\/api\/jobs'/)
    expect(app).toMatch(/app\.post\('\/api\/jobs\/preview'/)
    expect(client).toMatch(/\/api\/jobs\/preview/)
    expect(client).toMatch(/normalizeAutoApplyResult/)
    expect(client).toMatch(/\/api\/jobs\/auto-apply\/start/)
    expect(app).toMatch(/app\.post\('\/api\/jobs\/auto-apply\/start'/)
    expect(client).toMatch(/\/api\/automation\/health/)
    expect(app).toMatch(/app\.get\('\/api\/automation\/health'/)
    expect(client).not.toMatch(/api\.jobopportunitiesapi\.org/)
  })

  it('uses the same analyze path on the client and Express app', () => {
    expect(client).toMatch(/fetch\(apiUrl\('\/api\/jobs\/analyze'\)/)
    expect(client).toMatch(/method: 'POST'/)
    expect(app).toMatch(/app\.post\('\/api\/jobs\/analyze'/)
    expect(client).not.toMatch(/127\.0\.0\.1:8787/)
    expect(client).not.toMatch(/localhost:8787/)
  })

  it('keeps local Vite /api proxy to the Express server', () => {
    expect(vite).toMatch(/proxy:\s*\{/)
    expect(vite).toMatch(/['"]\/api['"]/)
    expect(vite).toMatch(/127\.0\.0\.1:8787/)
  })

  it('does not SPA-rewrite /api routes on Vercel and mounts the Express app', () => {
    expect(vercel).toMatch(/\(\?!api\/\.\*\)/)
    expect(handler).toMatch(/createVercelHandler/)
    expect(handler).toMatch(/bodyParser:\s*false/)
  })

  it('defaults API calls to the same origin so production does not call local Express', () => {
    expect(client).toMatch(/import\.meta\.env\.VITE_API_BASE_URL/)
    expect(client).toMatch(/const base = import\.meta\.env\.VITE_API_BASE_URL\?\.trim\(\)\.replace\(\/\\\/\$\/, ''\) \?\? ''/)
  })
})
