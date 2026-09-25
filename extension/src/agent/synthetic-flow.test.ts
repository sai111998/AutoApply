import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { fillSelectorsFor, isFinalSubmitText, isLegitimateNextText } from './fill'
import { profileFillValues } from './answers'
import { confirmationDetected } from './orchestrate'
import { applicationDetector } from '../detection/application-detector'

const syntheticPath = path.resolve(process.cwd(), 'extension/test-pages/synthetic-application.html')
const jobPath = path.resolve(process.cwd(), 'extension/test-pages/job-details.html')

describe('synthetic application flow', () => {
  it('fills, uploads, advances steps, and stops at review without submitting', async () => {
    const playwright = await import('playwright')
    const browser = await playwright.chromium.launch({ headless: true, args: ['--no-sandbox'] })
    try {
      const page = await browser.newPage()
      await page.goto(`file://${jobPath}`)
      const jobDetection = applicationDetector({
        html: await page.content(),
        url: page.url(),
        title: await page.title(),
      })
      expect(jobDetection.isJobDetailsPage).toBe(true)
      expect(jobDetection.applyActions.join(' ')).toMatch(/apply now/i)
      await page.getByRole('button', { name: 'Apply Now' }).click()
      await page.waitForURL(/synthetic-application|application\.html/)

      const values = profileFillValues({
        fullName: 'Jordan Hale',
        email: 'jordan.hale@example.com',
        location: 'Austin, TX',
        yearsOfExperience: 6,
        workAuthorization: 'us_citizen',
        sponsorshipRequired: false,
        linkedin: 'https://linkedin.com/in/jordanhale',
      })
      for (const step of fillSelectorsFor(values)) {
        const locator = page.locator(step.selector)
        if ((await locator.count()) === 0) continue
        if (!(await locator.first().isVisible())) continue
        const tag = await locator.first().evaluate((node) => ('tagName' in node ? String(node.tagName) : ''))
        if (tag === 'SELECT') await locator.first().selectOption(step.value)
        else await locator.first().fill(step.value)
      }
      const resumeBytes = Buffer.from('Jordan Hale\nJava Spring Boot')
      await page.setInputFiles('#resume', {
        name: 'resume.txt',
        mimeType: 'text/plain',
        buffer: resumeBytes,
      })
      expect(await page.locator('#first-name').inputValue()).toBe('Jordan')
      expect(await page.locator('#email').inputValue()).toBe('jordan.hale@example.com')
      await page.getByRole('button', { name: 'Next' }).click()
      expect(await page.locator('#step-2').isVisible()).toBe(true)
      for (const step of fillSelectorsFor(values)) {
        const locator = page.locator(step.selector)
        if ((await locator.count()) === 0) continue
        if (!(await locator.first().isVisible())) continue
        const tag = await locator.first().evaluate((node) => ('tagName' in node ? String(node.tagName) : ''))
        if (tag === 'SELECT') await locator.first().selectOption(step.value)
        else await locator.first().fill(step.value)
      }
      expect(await page.locator('#linkedin').inputValue()).toContain('linkedin.com')
      expect(await page.locator('#work-auth').inputValue()).toBe('Yes')
      await page.getByRole('button', { name: 'Continue' }).click()
      expect(await page.locator('#step-3').isVisible()).toBe(true)
      expect(await page.getByRole('button', { name: 'Submit Application' }).isVisible()).toBe(true)
      expect(isFinalSubmitText('Submit Application')).toBe(true)
      expect(isLegitimateNextText('Submit Application')).toBe(false)
      const html = await page.content()
      expect(applicationDetector({ html, url: page.url(), title: await page.title() }).isApplicationPage).toBe(true)
      expect(confirmationDetected(html, await page.title()).detected).toBe(false)
      expect(await page.locator('#first-name').inputValue()).toBe('Jordan')
    } finally {
      await browser.close()
    }
  })

  it('keeps the synthetic form from treating Next as a final submit', async () => {
    const html = await readFile(syntheticPath, 'utf8')
    expect(html).toMatch(/preventDefault/)
    expect(html).toMatch(/Submit Application/)
    expect(html).not.toMatch(/chrome\.tabs/)
  })
})
