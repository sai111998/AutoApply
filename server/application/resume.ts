import type { AutoApplyQueueItem } from '../apply/types'

export interface SelectedResumeUpload {
  versionId: string | null
  fileName: string
  mimeType: 'text/plain'
  buffer: Buffer
  text: string
  masterUnchanged: boolean
}

export function selectedResumeForUpload(
  item: Pick<AutoApplyQueueItem, 'resumeVersionId' | 'resumeVersionName' | 'tailoredResumeText' | 'masterResumeUnchanged'>,
  masterText = '',
): SelectedResumeUpload | null {
  const text = item.tailoredResumeText?.trim() || ''
  if (!text) return null
  return {
    versionId: item.resumeVersionId,
    fileName: `${sanitizeResumeFileName(item.resumeVersionName || 'resume')}.txt`,
    mimeType: 'text/plain',
    buffer: Buffer.from(text),
    text,
    masterUnchanged: item.masterResumeUnchanged !== false && text !== masterText ? item.masterResumeUnchanged : true,
  }
}

export function assertMasterResumeUnchanged(before: string, after: string): boolean {
  return before === after
}

export function sanitizeResumeFileName(name: string): string {
  return name.replace(/[^\w. -]+/g, '').trim().slice(0, 80) || 'resume'
}
