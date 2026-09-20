import { createApp } from './app'
import { startEmbeddedWorker } from './browser-worker'
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
  void startEmbeddedWorker().then((worker) => {
    if (worker) console.log('Browser worker: processing Auto Apply queue with Playwright Chromium')
  })
})
