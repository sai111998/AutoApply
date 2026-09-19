import { afterEach, describe, expect, it } from 'vitest'
import { PlaywrightApplyBrowser } from './browser'
import {
  chromiumLaunchOptions,
  detectAutomationRuntime,
  getAutomationHealth,
  probeChromium,
  resetAutomationHealthCache,
  serverlessAutomationReason,
  userFacingBrowserError,
  type PlaywrightLike,
} from './health'
import { inspectApplicationUrl } from './validate'
import { inspectApplicationPage } from './detect'

function fakePlaywright(options: {
  title?: string
  launchError?: string
  gotoError?: string
  closed?: { value: boolean }
}): PlaywrightLike {
  return {
    chromium: {
      async launch() {
        if (options.launchError) throw new Error(options.launchError)
        return {
          async close() {
            if (options.closed) options.closed.value = true
          },
          async newPage() {
            return {
              async goto() {
                if (options.gotoError) throw new Error(options.gotoError)
              },
              async title() {
                return options.title ?? 'Example Domain'
              },
              async close() {
                return undefined
              },
            }
          },
        }
      },
    },
  }
}

afterEach(() => {
  resetAutomationHealthCache()
})

describe('automation health', () => {
  it('reports serverless runtimes as unsupported without launching a browser', async () => {
    expect(detectAutomationRuntime({ VERCEL: '1' })).toBe('serverless')
    expect(detectAutomationRuntime({ VERCEL_ENV: 'production' })).toBe('serverless')
    const health = await getAutomationHealth({
      runtime: 'serverless',
      loadPlaywright: async () => {
        throw new Error('should not load playwright')
      },
    })
    expect(health.available).toBe(false)
    expect(health.playwright).toBe(false)
    expect(health.browser).toBeNull()
    expect(health.reason).toBe(serverlessAutomationReason())
  })

  it('reports Playwright as unavailable when the module cannot be imported', async () => {
    const health = await getAutomationHealth({
      runtime: 'node-server',
      loadPlaywright: async () => null,
    })
    expect(health).toMatchObject({
      available: false,
      playwright: false,
      browser: null,
      reason: 'Playwright is not installed. Run npm install && npm run playwright:install, then restart npm run dev.',
    })
  })

  it('reports a missing Chromium executable without exposing a filesystem path', async () => {
    const health = await getAutomationHealth({
      runtime: 'node-server',
      loadPlaywright: async () =>
        fakePlaywright({
          launchError: "browserType.launch: Executable doesn't exist at /home/secret/.cache/ms-playwright/chromium",
        }),
    })
    expect(health.available).toBe(false)
    expect(health.playwright).toBe(true)
    expect(health.reason).toBe('Chromium executable not found')
    expect(health.reason).not.toMatch(/home\/secret/)
    expect(userFacingBrowserError(new Error("Executable doesn't exist at /tmp/chromium"))).toBe(
      'Chromium executable not found',
    )
  })

  it('proves a successful Chromium launch, navigation, and cleanup', async () => {
    const closed = { value: false }
    const playwright = fakePlaywright({ title: 'Example Domain', closed })
    const probed = await probeChromium(playwright)
    expect(probed.ok).toBe(true)
    expect(probed.title).toBe('Example Domain')
    expect(probed.closed).toBe(true)
    const health = await getAutomationHealth({
      runtime: 'node-server',
      loadPlaywright: async () => playwright,
    })
    expect(health).toEqual({
      available: true,
      playwright: true,
      browser: 'chromium',
      runtime: 'node-server',
    })
  })

  it('uses sandbox-safe Chromium args in restricted environments', () => {
    expect(chromiumLaunchOptions({ CI: '1' }).args).toContain('--no-sandbox')
    expect(chromiumLaunchOptions({ PLAYWRIGHT_NO_SANDBOX: '1' }).headless).toBe(true)
  })

  it('validates application URLs before automation', () => {
    expect(inspectApplicationUrl('').ok).toBe(false)
    expect(inspectApplicationUrl('notaurl').ok).toBe(false)
    expect(inspectApplicationUrl('https://jobs.example.com/apply').ok).toBe(true)
  })
})

describe('browser launch failures do not mark submitted', () => {
  it('returns needs_user_input, CAPTCHA, and MFA without submitted', async () => {
    expect(inspectApplicationPage('<div class="g-recaptcha" data-sitekey="x"></div>').status).toBe('captcha_required')
    expect(inspectApplicationPage('<p>Enter the authenticator app code</p>').status).toBe('mfa_required')
    const browser = new PlaywrightApplyBrowser({
      health: async () => ({ available: false, reason: 'Chromium executable not found' }),
    })
    const prepared = await browser.prepare({
      url: 'https://jobs.example.com/apply',
      resumeText: 'Java',
      profile: {
        fullName: 'Jordan Hale',
        email: 'jordan@example.com',
        location: 'Austin, TX',
        yearsOfExperience: 8,
        workAuthorization: 'us_citizen',
        sponsorshipRequired: false,
        preferredWorkArrangement: 'remote',
        targetSalaryMin: null,
        targetSalaryMax: null,
      },
    })
    expect(prepared.status).toBe('automation_blocked')
    expect(prepared.status).not.toBe('submitted')
    expect(prepared.failureReason).toBe('Chromium executable not found')
  })
})
