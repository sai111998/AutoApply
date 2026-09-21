import {
  detectSubmissionConfirmation,
  isFinalSubmitLabel,
  type SubmissionConfirmation,
} from '../apply/confirm'
import {
  buildConfirmedApplicationRecord,
  persistConfirmedSubmission,
  shouldPersistConfirmedApplication,
  type ConfirmedApplicationRecord,
} from '../apply/confirmed'
import type { AutoApplyQueueItem } from '../apply/types'

export { detectSubmissionConfirmation, isFinalSubmitLabel }
export { buildConfirmedApplicationRecord, persistConfirmedSubmission, shouldPersistConfirmedApplication }
export type { ConfirmedApplicationRecord, SubmissionConfirmation }

export function canInsertApplicationHistory(
  item: Pick<AutoApplyQueueItem, 'applicationStatus'>,
  confirmation?: SubmissionConfirmation | null,
): boolean {
  if (item.applicationStatus !== 'submitted') return false
  if (confirmation && !(confirmation.success && confirmation.confirmed)) return false
  return shouldPersistConfirmedApplication(item)
}
