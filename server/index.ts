import { createApp } from './app'
import { getServerConfig } from './config'

const config = getServerConfig()
const app = createApp({ config })

app.listen(config.port, '0.0.0.0', () => {
  console.log(`JobPilot API listening on http://127.0.0.1:${config.port}`)
  console.log(`LLM configured: ${Boolean(config.llmApiKey)}`)
})
