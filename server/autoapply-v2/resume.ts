import { getCandidateProfile } from '../application/candidate-store'
import { V2Error } from './errors'
import type { V2Resume } from './types'

export async function loadV2Resume(userId: string): Promise<V2Resume> {
  const record = getCandidateProfile(userId)
  const text = record?.resumeText?.trim() ?? ''
  const versionId = record?.resumeVersionId?.trim() ?? ''
  if (!record || !versionId || !text) {
    throw new V2Error('RESUME_NOT_FOUND', 'No completed default resume found for this user.', 422)
  }
  const resume: V2Resume = {
    versionId,
    versionName: 'Default',
    fileName: 'resume.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(record.resumeText ?? ''),
    text: record.resumeText ?? '',
  }
  console.log(`[V2] RESUME_LOADED versionId=${versionId} chars=${text.length} userId=${userId}`)
  return resume
}
