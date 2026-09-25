import { mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export function browserProfileDirectory(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.JOBPILOT_BROWSER_PROFILE_DIR?.trim()
  if (configured) return path.resolve(configured)
  return path.join(os.tmpdir(), 'jobpilot-browser-profile')
}

export function ensureBrowserProfileDirectory(env: NodeJS.ProcessEnv = process.env): string {
  const directory = browserProfileDirectory(env)
  mkdirSync(directory, { recursive: true })
  return directory
}

export function isHeadlessBrowser(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.JOBPILOT_BROWSER_HEADLESS?.trim().toLowerCase()
  if (raw === '0' || raw === 'false' || raw === 'off') return false
  return true
}

export function allowUnattendedSubmit(url: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.JOBPILOT_AUTO_SUBMIT === '1') return true
  try {
    const parsed = new URL(url)
    const local = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost'
    return local && (/\/browser-worker\/synthetic\//.test(parsed.pathname) || /\/test-employer/.test(parsed.pathname) || /\/extension\/test\//.test(parsed.pathname))
  } catch {
    return false
  }
}

export function shouldUnattendedSubmit(url: string, autoSubmit?: boolean, env: NodeJS.ProcessEnv = process.env): boolean {
  return autoSubmit === true || allowUnattendedSubmit(url, env)
}
