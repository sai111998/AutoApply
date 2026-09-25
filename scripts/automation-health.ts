import { buildAutomationHealthPayload } from '../server/automation/status'

const health = await buildAutomationHealthPayload({ probe: true })
console.log(JSON.stringify(health, null, 2))
if (!health.browser.available) process.exitCode = 1
