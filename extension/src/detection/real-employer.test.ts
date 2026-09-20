import { describe, expect, it } from 'vitest'
import { applicationDetector } from './application-detector'
import { detectApplicationProvider } from '../providers'
import { isLegitimateApplyText } from '../agent/fill'
import { nextAgentAction } from '../agent/orchestrate'

const BOARD_URL = 'https://job-boards.greenhouse.io/gitlab'

describe('real employer page detection', () => {
  it('opens a Greenhouse employer board, detects the ATS, and finds an Apply action', async () => {
    const playwright = await import('playwright')
    const browser = await playwright.chromium.launch({ headless: true, args: ['--no-sandbox'] })
    try {
      const page = await browser.newPage()
      const response = await page.goto(BOARD_URL, { waitUntil: 'domcontentloaded', timeout: 25_000 })
      expect(response?.ok()).toBe(true)
      const boardHtml = await page.content()
      expect(detectApplicationProvider({ url: page.url(), html: boardHtml }).id).toBe('greenhouse')
      const jobLink = page.locator('a[href*="/jobs/"], a[href*="job_app"]').first()
      if (await jobLink.count()) {
        await jobLink.click()
        await page.waitForLoadState('domcontentloaded')
      }
      const html = await page.content()
      const url = page.url()
      const title = await page.title()
      const provider = detectApplicationProvider({ url, html })
      const detection = applicationDetector({ html, url, title })
      expect(provider.id).toBe('greenhouse')
      const applyFound =
        detection.applyActions.some((label) => isLegitimateApplyText(label)) ||
        detection.isApplicationPage ||
        /apply/i.test(`${title} ${html}`)
      expect(applyFound).toBe(true)
      if (detection.challenges.captcha || detection.challenges.mfa || detection.challenges.login) {
        expect(nextAgentAction(detection, html).type).toBe('pause')
      }
    } finally {
      await browser.close()
    }
  }, 45_000)
})
