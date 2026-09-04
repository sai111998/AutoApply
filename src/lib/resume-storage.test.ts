import { describe, expect, it } from 'vitest'
import {
  createResumeSignedUrl,
  downloadResumeObject,
  isOwnedResumePath,
  isValidResumeStoragePath,
  resolveResumePreview,
  resumeFileKind,
  resumeStoragePath,
  userFacingStorageError,
} from './resume-storage'
import type { Resume } from '@/types/domain'

function resume(overrides: Partial<Resume> = {}): Resume {
  return {
    id: 'resume-1',
    userId: 'user-a',
    fileName: 'master.pdf',
    fileType: 'application/pdf',
    versionLabel: 'Master',
    isMaster: true,
    fileSize: 12,
    storagePath: 'user-a/resume-1/master.pdf',
    parsedText: 'Software Engineer with Java experience.',
    createdAt: '2026-09-04T01:00:00.000Z',
    ...overrides,
  }
}

describe('resume storage helpers', () => {
  it('builds and validates owned storage paths', () => {
    expect(resumeStoragePath('user-a', 'resume-1', 'master.pdf')).toBe('user-a/resume-1/master.pdf')
    expect(isValidResumeStoragePath('user-a/resume-1/master.pdf')).toBe(true)
    expect(isValidResumeStoragePath('../secret')).toBe(false)
    expect(isValidResumeStoragePath('')).toBe(false)
    expect(isOwnedResumePath('user-a/resume-1/master.pdf', 'user-a')).toBe(true)
    expect(isOwnedResumePath('user-b/resume-1/master.pdf', 'user-a')).toBe(false)
  })

  it('classifies pdf, text, and docx files', () => {
    expect(resumeFileKind('cv.pdf', 'application/pdf')).toBe('pdf')
    expect(resumeFileKind('notes.txt', 'text/plain')).toBe('text')
    expect(resumeFileKind('cv.docx')).toBe('docx')
  })

  it('creates a signed URL for an owned private object', async () => {
    const client = {
      storage: {
        from: (bucket: string) => ({
          createSignedUrl: async (path: string, expires: number) => {
            expect(bucket).toBe('resumes')
            expect(path).toBe('user-a/resume-1/master.pdf')
            expect(expires).toBeGreaterThan(0)
            return { data: { signedUrl: 'https://example.supabase.co/storage/v1/object/sign/resumes/file' }, error: null }
          },
        }),
      },
    }
    await expect(createResumeSignedUrl(client as never, 'user-a/resume-1/master.pdf', 'user-a')).resolves.toMatch(
      /\/object\/sign\//,
    )
  })

  it('rejects invalid paths and another user\'s object before calling storage', async () => {
    const client = {
      storage: {
        from: () => ({
          createSignedUrl: async () => {
            throw new Error('should not be called')
          },
        }),
      },
    }
    await expect(createResumeSignedUrl(client as never, 'bad', 'user-a')).rejects.toThrow(/invalid storage path/)
    await expect(createResumeSignedUrl(client as never, 'user-b/resume-1/x.pdf', 'user-a')).rejects.toThrow(
      /permission/,
    )
  })

  it('maps missing objects and unauthorized storage errors', () => {
    expect(userFacingStorageError({ message: 'Object not found', statusCode: '404' })).toMatch(/not found/)
    expect(userFacingStorageError({ message: 'Unauthorized', statusCode: '403' })).toMatch(/permission/)
    expect(userFacingStorageError({ message: 'Bucket not found' })).toMatch(/storage is not available/)
  })

  it('downloads an owned object and fails closed when storage errors', async () => {
    const ok = {
      storage: {
        from: () => ({
          download: async () => ({ data: new Blob(['pdf-bytes']), error: null }),
        }),
      },
    }
    const blob = await downloadResumeObject(ok as never, 'user-a/resume-1/master.pdf', 'user-a')
    expect(await blob.text()).toBe('pdf-bytes')

    const missing = {
      storage: {
        from: () => ({
          download: async () => ({ data: null, error: { message: 'Object not found', statusCode: '404' } }),
        }),
      },
    }
    await expect(downloadResumeObject(missing as never, 'user-a/resume-1/master.pdf', 'user-a')).rejects.toThrow(/not found/)
  })

  it('previews a stored PDF through a signed URL and keeps the master accessible', async () => {
    const client = {
      storage: {
        from: () => ({
          createSignedUrl: async () => ({ data: { signedUrl: 'https://example.test/signed.pdf' }, error: null }),
        }),
      },
    }
    const preview = await resolveResumePreview({
      client: client as never,
      userId: 'user-a',
      resume: resume(),
      isDemo: false,
    })
    expect(preview.kind).toBe('pdf')
    expect(preview.signedUrl).toBe('https://example.test/signed.pdf')
    expect(preview.canDownload).toBe(true)
    expect(preview.error).toBeNull()
  })

  it('previews a tailored/source text resume in demo without calling storage', async () => {
    const preview = await resolveResumePreview({
      client: null,
      userId: 'user-a',
      resume: resume({ storagePath: null, fileName: 'master.txt', fileType: 'text/plain' }),
      isDemo: true,
    })
    expect(preview.text).toMatch(/Java/)
    expect(preview.error).toBeNull()
  })

  it('does not open another user\'s resume', async () => {
    const preview = await resolveResumePreview({
      client: null,
      userId: 'user-a',
      resume: resume({ userId: 'user-b' }),
      isDemo: false,
    })
    expect(preview.error).toMatch(/permission/)
    expect(preview.signedUrl).toBeNull()
  })
})
