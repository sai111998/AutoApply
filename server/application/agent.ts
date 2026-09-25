export { runApplicationAgent } from '../browser-worker/agent'
export type { AgentRunResult } from '../browser-worker/agent'
import { runApplicationAgent } from '../browser-worker/agent'
import type { AutoApplyProfile, AutoApplyQueueItem } from '../apply/types'
import type { BrowserPageLike } from '../browser-worker/types'

export async function processEmployerApplication(input: {
  item: AutoApplyQueueItem
  userId: string
  profile: AutoApplyProfile
  page: BrowserPageLike
  pageId: string
  contextId: string
  autoSubmit?: boolean
}) {
  return runApplicationAgent(input)
}
