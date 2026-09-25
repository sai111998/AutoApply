import { createApp } from './app'
import { startV2Worker } from './autoapply-v2/worker'
import { startEmbeddedWorker } from './browser-worker'
import { retireLegacyAutoApplyRuns, startAgentScheduler } from './agent'
import { getAutomationHealth } from './apply/health'
import { describeSupabaseServer } from './application/supabase-access'
import { getServerConfig } from './config'
import { hasBuiltInWebSocket } from './supabase-client'

const config = getServerConfig()
const app = createApp({ config })

app.listen(config.port, '0.0.0.0', () => {
  console.log(`JobPilot API listening on http://127.0.0.1:${config.port}`)
  console.log(`LLM configured: ${Boolean(config.llmApiKey)}`)
  console.log(`Supabase: ${JSON.stringify(describeSupabaseServer(config))}`)
  if (!hasBuiltInWebSocket()) {
    console.warn(
      `Node.js ${process.version} has no built-in WebSocket. Sign-in checks, profile reads, and resume reads use a compatible Supabase client; other server-side Supabase reads and writes need Node.js 22 or newer.`,
    )
  }
  void getAutomationHealth({ probe: false }).then((health) => {
    console.log(`Browser automation: ${health.available ? 'chromium ready' : health.reason ?? 'unavailable'}`)
  })
  void retireLegacyAutoApplyRuns(config).then((retired) => {
    if (retired) console.log(`Auto Apply: cancelled ${retired} stale legacy run(s)`)
  })
  if (process.env.VITEST !== 'true' && process.env.JOBPILOT_EMBED_AGENT !== '0') {
    startAgentScheduler()
    console.log('Auto Apply agent: scheduler started in the API process')
  }
  if (process.env.VITEST !== 'true' && process.env.JOBPILOT_EMBED_V2_WORKER !== '0') {
    startV2Worker()
    console.log('Auto Apply V2: background worker started (single-item queue)')
  }
  if (process.env.JOBPILOT_EMBED_WORKER !== '0') {
    void startEmbeddedWorker().then((worker) => {
      if (worker) console.log('Browser worker: processing Auto Apply queue with Playwright Chromium')
    })
  }
})
