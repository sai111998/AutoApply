import { describe, expect, it } from 'vitest'
import { chromiumLaunchOptions, importPlaywright } from '../apply/health'
import { isHeadlessBrowser } from './profile'

describe('browser worker health', () => {
  it('launches Chromium headless, opens example.com, verifies the title, and closes', async () => {
    expect(isHeadlessBrowser({})).toBe(true)
    expect(isHeadlessBrowser({ JOBPILOT_BROWSER_HEADLESS: '0' })).toBe(false)
    const playwright = await importPlaywright()
    expect(playwright).toBeTruthy()
    const browser = await playwright!.chromium.launch(chromiumLaunchOptions())
    try {
      const page = await browser.newPage()
      await page.goto('https://example.com', { waitUntil: 'domcontentloaded', timeout: 25_000 })
      const title = (await page.title?.()) ?? ''
      expect(title).toMatch(/example/i)
      await page.close?.()
    } finally {
      await browser.close()
    }
  }, 45_000)
})
