export { startCampaign, tickCampaign, pauseCampaign, resumeCampaign, cancelCampaign, resumeIntervention } from './agent'
export { startAgentScheduler, stopAgentScheduler, tickActiveCampaigns, resetAgentSchedulerForTests } from './scheduler'
export { resetAgentStateForTests, getCampaign, listCampaigns } from './state'
export { resetAgentEventsForTests, listAgentEvents } from './events'
export { isEligibleForAutoApply, meetsMatchThreshold, campaignJobEligible } from './eligibility'
export { agentIntervalMs, campaignMaxJobs, DEFAULT_AGENT_INTERVAL_MS } from './policy'
export { AgentError } from './errors'

import { resetAgentEventsForTests } from './events'
import { resetAgentSchedulerForTests } from './scheduler'
import { resetAgentStateForTests } from './state'

export function resetAgentForTests() {
  resetAgentStateForTests()
  resetAgentEventsForTests()
  resetAgentSchedulerForTests()
}
