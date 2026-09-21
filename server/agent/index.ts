export { startCampaign, tickCampaign, pauseCampaign, resumeCampaign, cancelCampaign, resumeIntervention } from './agent'
export { startAgentScheduler, stopAgentScheduler, tickActiveCampaigns, resetAgentSchedulerForTests } from './scheduler'
export { resetAgentStateForTests, getCampaign, listCampaigns } from './state'
export { resetAgentEventsForTests, listAgentEvents } from './events'
export { isEligibleForAutoApply, meetsMatchThreshold, campaignJobEligible } from './eligibility'
export { agentIntervalMs, campaignMaxJobs, dailyApplyCount, remainingDailySlots, utcDayKey, DEFAULT_AGENT_INTERVAL_MS } from './policy'
export { discoverCampaignJobs } from './discovery'
export { evaluateJobEligibility, ELIGIBILITY_STAGES } from './pipeline'

import { resetAgentEventsForTests } from './events'
import { resetAgentSchedulerForTests } from './scheduler'
import { resetAgentStateForTests } from './state'
import { resetAnswerLibraryForTests } from '../application/answers'
import { resetCapabilityCacheForTests } from '../apply/capability-cache'

export function resetAgentForTests() {
  resetAgentStateForTests()
  resetAgentEventsForTests()
  resetAgentSchedulerForTests()
  resetAnswerLibraryForTests()
  resetCapabilityCacheForTests()
}
