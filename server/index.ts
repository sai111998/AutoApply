import { createApp } from './app'
import { startEmbeddedWorker } from './browser-worker'
import { startAgentScheduler } from './agent'
import { getAutomationHealth } from './apply/health'
import { getServerConfig } from './config'

const config = getServerConfig()
const app = createApp({ config })

app.listen(config.port, '0.0.0.0', () => {
  console.log(`JobPilot API listening on http://127.0.0.1:${config.port}`)
  console.log(`LLM configured: ${Boolean(config.llmApiKey)}`)
  void getAutomationHealth({ probe: false }).then((health) => {
    console.log(`Browser automation: ${health.available ? 'chromium ready' : health.reason ?? 'unavailable'}`)
  })
  if (process.env.VITEST !== 'true' && process.env.JOBPILOT_EMBED_AGENT !== '0') {
    startAgentScheduler()
    console.log('Auto Apply agent: scheduler started in the API process')
  }
  if (process.env.JOBPILOT_EMBED_WORKER !== '0') {
    void startEmbeddedWorker().then((worker) => {
      if (worker) console.log('Browser worker: processing Auto Apply queue with Playwright Chromium')
    })
  }
})
