import type { ServerConfig } from '../config'
import { listAutoApplyRuns } from '../apply/engine'
import type { AutoApplyQueueItem } from '../apply/types'
import { getExtensionSession, listExtensionSessions, startExtensionSession } from './sessions'
import type { ExtensionApplicationContext } from '../../extension/src/shared/types'

function itemMatches(item: AutoApplyQueueItem, query: { applicationId?: string; jobId?: string }): boolean {
  if (query.applicationId && item.applicationId === query.applicationId) return true
  if (query.jobId && item.jobId === query.jobId) return true
  return false
}

export async function getExtensionApplicationContext(
  input: {
    userId: string
    applicationId?: string
    jobId?: string
    resumeVersionId?: string
    applicationSessionId?: string
  },
  config?: ServerConfig,
): Promise<ExtensionApplicationContext> {
  const runs = await listAutoApplyRuns(input.userId, {}, config)
  const items = runs.flatMap((entry) => entry.items)
  const item = items.find((row) => itemMatches(row, input)) ?? null
  const session =
    (input.applicationSessionId ? getExtensionSession(input.applicationSessionId, input.userId) : null) ??
    listExtensionSessions(input.userId).find((row) => row.jobId === (item?.jobId ?? input.jobId) || row.applicationId === (item?.applicationId ?? input.applicationId)) ??
    null

  return {
    userId: input.userId,
    job: item
      ? {
          id: item.jobId,
          title: item.title,
          company: item.company,
          applicationUrl: item.applicationUrl,
        }
      : null,
    application: item?.applicationId ? { id: item.applicationId, status: item.applicationStatus } : null,
    resume: {
      versionId: item?.resumeVersionId ?? input.resumeVersionId ?? null,
      name: item?.resumeVersionName ?? 'Master',
    },
    profile: null,
    questions: item?.questions.map((question) => ({ id: question.id, prompt: question.prompt, answer: question.answer })) ?? [],
    session,
  }
}

export function enqueueExtensionSessionFromQueueItem(userId: string, item: AutoApplyQueueItem) {
  return startExtensionSession({
    userId,
    jobId: item.jobId,
    applicationId: item.applicationId,
    resumeVersionId: item.resumeVersionId,
    currentUrl: item.applicationUrl,
  })
}
