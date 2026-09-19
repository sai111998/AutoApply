import { getAutomationHealth, publicAutomationHealth } from '../server/apply/health'

const health = publicAutomationHealth(await getAutomationHealth({ probe: true }))
console.log(JSON.stringify(health, null, 2))
if (!health.available) process.exitCode = 1
