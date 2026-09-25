import { chromium } from 'playwright'
import { liveCapabilityPreflight } from '../server/apply/live-capability'
import { detectAtsAdapter } from '../server/browser-worker/providers'

const url =
  process.argv[2] ||
  'https://calibercollision.wd1.myworkdayjobs.com/caliber/job/Culpeper-VA/Auto-Shop-Helper_R0225018'

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  page.setDefaultTimeout(16_000)
  try {
    console.info('[SmokeTest] Browser started')
    const decision = await liveCapabilityPreflight({
      jobId: 'smoke-1',
      title: 'Auto Shop Helper',
      company: 'calibercollision',
      applicationUrl: url,
      page,
    })
    const finalUrl = page.url()
    const title = await page.title()
    const html = await page.content()
    const adapter = detectAtsAdapter({ url: finalUrl, html })
    console.info('[SmokeTest] Employer page opened', { hostname: new URL(finalUrl).hostname, pageTitle: title })
    console.info('[SmokeTest] Provider detected', { applicationProvider: adapter.id, preflightProvider: decision.provider })
    console.info(
      JSON.stringify(
        {
          initialUrl: url,
          finalUrl,
          pageTitle: title,
          hostname: new URL(finalUrl).hostname,
          provider: adapter.id,
          preflightProvider: decision.provider,
          pageType: decision.pageType,
          applicationDetected: decision.applicationDetected,
          applyActionAvailable: decision.applyActionAvailable,
          blocked: adapter.detectBlockingState(html),
          captcha: decision.pageType === 'CAPTCHA_PAGE',
          login: decision.pageType === 'LOGIN_PAGE',
          mfa: decision.pageType === 'MFA_PAGE',
          detectedFields: decision.detectedFields,
          detectedButtons: decision.detectedButtons,
          reason: decision.reason,
        },
        null,
        2,
      ),
    )
  } finally {
    await browser.close()
  }
}

void main().catch((error) => {
  console.error('[SmokeTest] BROWSER_FAIL', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
