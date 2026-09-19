import { describe, expect, it } from 'vitest'
import {
  applicationStatusFromQueue,
  applicationsVisibleOnApplicationsPage,
  buildAutoApplyWorkspaceRecords,
  findExistingAutoApplyApplication,
  usesTailoredResumeVersion,
  type AutoApplyApplicationSource,
} from './auto-apply-application'
import type { Application, Job, JobMatch, Resume, ResumeVersion } from '@/types/domain'

const USER = '3b9f0c2a-7d11-4c3a-9f12-8a1b2c3d4e5f'
const JOB_ID = '3b9f0c2a-7d11-4c3a-9f12-8a1b2c3d4e60'
const APP_ID = '3b9f0c2a-7d11-4c3a-9f12-8a1b2c3d4e61'
const VERSION_ID = '3b9f0c2a-7d11-4c3a-9f12-8a1b2c3d4e62'
const RESUME_ID = '3b9f0c2a-7d11-4c3a-9f12-8a1b2c3d4e63'
const MATCH_ID = '3b9f0c2a-7d11-4c3a-9f12-8a1b2c3d4e64'
const TAILORED_MATCH_ID = '3b9f0c2a-7d11-4c3a-9f12-8a1b2c3d4e65'

function item(overrides: Partial<AutoApplyApplicationSource> = {}): AutoApplyApplicationSource {
  return {
    id: 'queue-1',
    jobId: JOB_ID,
    identityKey: 'jpmorgan-lead-java',
    applicationId: APP_ID,
    resumeVersionId: RESUME_ID,
    resumeVersionName: 'Master',
    title: 'Lead Software Engineer-Full Stack Java with AI tools expertise',
    company: 'JPMorgan Chase',
    applicationUrl: 'https://jobs.example.com/jpmorgan',
    initialMatchScore: 86,
    finalMatchScore: 86,
    applicationStatus: 'ready',
    tailoredResumeText: null,
    createdAt: '2026-09-18T12:00:00.000Z',
    updatedAt: '2026-09-18T12:00:00.000Z',
    ...overrides,
  }
}

function resume(): Resume {
  return {
    id: RESUME_ID,
    userId: USER,
    fileName: 'master.pdf',
    fileType: 'application/pdf',
    versionLabel: 'Master Resume',
    isMaster: true,
    fileSize: 12,
    storagePath: null,
    parsedText: 'Java Spring Boot',
    createdAt: '2026-09-18T01:00:00.000Z',
  }
}

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: JOB_ID,
    userId: USER,
    title: 'Lead Software Engineer-Full Stack Java with AI tools expertise',
    company: 'JPMorgan Chase',
    location: 'Columbus, OH',
    jobUrl: 'https://jobs.example.com/jpmorgan',
    description: 'Java role',
    createdAt: '2026-09-18T12:00:00.000Z',
    identityKey: 'jpmorgan-lead-java',
    matchScore: 86,
    ...overrides,
  }
}

function application(overrides: Partial<Application> = {}): Application {
  return {
    id: APP_ID,
    userId: USER,
    jobId: JOB_ID,
    matchId: null,
    resumeId: RESUME_ID,
    selectedResumeVersionId: null,
    currentMatchId: null,
    currentMatchScore: 86,
    status: 'ready',
    dateAdded: '2026-09-18',
    dateApplied: null,
    nextAction: 'Ready to apply',
    notes: '',
    updatedAt: '2026-09-18T12:00:00.000Z',
    ...overrides,
  }
}

function match(overrides: Partial<JobMatch> = {}): JobMatch {
  return {
    id: MATCH_ID,
    userId: USER,
    jobId: JOB_ID,
    resumeId: RESUME_ID,
    parentMatchId: null,
    resumeVersionId: null,
    overallScore: 86,
    skillsMatched: [],
    skillsPartial: [],
    skillsMissing: [],
    experienceMatch: null,
    educationMatch: null,
    locationMatch: null,
    workAuthorizationNotes: null,
    strengths: [],
    concerns: [],
    recommendation: 'APPLY',
    analysisStatus: 'complete',
    analysisSource: 'api',
    provider: 'match-engine',
    errorMessage: null,
    summary: null,
    createdAt: '2026-09-18T12:00:00.000Z',
    analyzedAt: '2026-09-18T12:00:00.000Z',
    ...overrides,
  }
}

function version(overrides: Partial<ResumeVersion> = {}): ResumeVersion {
  return {
    id: VERSION_ID,
    userId: USER,
    sourceResumeId: RESUME_ID,
    jobId: JOB_ID,
    analysisId: null,
    versionName: 'Tailored v1 — Lead Software Engineer',
    resumeContent: {
      summary: 'Tailored Java resume',
      skills: ['Java'],
      experience: [],
      projects: [],
      education: [],
      certifications: [],
      changes: [],
      omissions: [],
      warnings: [],
      contact: { name: '', email: '', location: '' },
    },
    tailoringSummary: { skillsToEmphasize: [], relatedSkills: [], missingSkills: [], experienceToEmphasize: [] },
    changes: [],
    warnings: [],
    status: 'completed',
    createdBy: 'ai',
    isSelected: true,
    generationId: VERSION_ID,
    comparisonAnalysisId: TAILORED_MATCH_ID,
    originalContent: null,
    createdAt: '2026-09-18T12:00:00.000Z',
    updatedAt: '2026-09-18T12:00:00.000Z',
    ...overrides,
  }
}

describe('auto apply application sync', () => {
  it('creates an application record from Apply without marking it applied', () => {
    const built = buildAutoApplyWorkspaceRecords({
      item: item(),
      listedJob: {
        id: JOB_ID,
        title: item().title,
        company: 'JPMorgan Chase',
        location: 'Columbus, OH',
        jobUrl: 'https://jobs.example.com/jpmorgan',
        identityKey: 'jpmorgan-lead-java',
      },
      userId: USER,
      jobs: [],
      applications: [],
      matches: [],
      resumeVersions: [],
      masterResume: resume(),
      now: '2026-09-18T15:00:00.000Z',
    })

    expect(built.created).toBe(true)
    expect(built.application.id).toBe(APP_ID)
    expect(built.application.userId).toBe(USER)
    expect(built.application.jobId).toBe(JOB_ID)
    expect(built.application.status).toBe('ready')
    expect(built.application.dateApplied).toBeNull()
    expect(built.application.currentMatchScore).toBe(86)
    expect(built.application.selectedResumeVersionId).toBeNull()
    expect(built.job.company).toBe('JPMorgan Chase')
    expect(built.job.jobUrl).toBe('https://jobs.example.com/jpmorgan')
    expect(built.job.location).toBe('Columbus, OH')
    expect(built.resumeVersion).toBeNull()
    expect(applicationsVisibleOnApplicationsPage([built.application], [built.job])).toEqual([built.application])
  })

  it('updates an existing application instead of creating a duplicate', () => {
    const existing = application({ currentMatchScore: 70, notes: 'Keep notes' })
    const first = buildAutoApplyWorkspaceRecords({
      item: item({ finalMatchScore: 91, applicationStatus: 'ready' }),
      userId: USER,
      jobs: [job()],
      applications: [existing],
      matches: [],
      resumeVersions: [],
      masterResume: resume(),
      now: '2026-09-18T16:00:00.000Z',
    })
    const second = buildAutoApplyWorkspaceRecords({
      item: item({ finalMatchScore: 93, applicationStatus: 'ready_for_submission' }),
      userId: USER,
      jobs: [first.job],
      applications: [first.application],
      matches: [],
      resumeVersions: [],
      masterResume: resume(),
      now: '2026-09-18T16:05:00.000Z',
    })

    expect(first.created).toBe(false)
    expect(second.created).toBe(false)
    expect(first.application.id).toBe(APP_ID)
    expect(second.application.id).toBe(APP_ID)
    expect(second.application.currentMatchScore).toBe(93)
    expect(second.application.notes).toBe('Keep notes')
    expect(second.application.status).toBe('ready')
    expect(
      findExistingAutoApplyApplication([first.application, second.application], [first.job], item()),
    ).toMatchObject({ id: APP_ID })
  })

  it('finds the same application by job identity when the queue id is new', () => {
    const existing = application()
    const found = findExistingAutoApplyApplication(
      [existing],
      [job()],
      item({ applicationId: '3b9f0c2a-7d11-4c3a-9f12-8a1b2c3d4e99' }),
    )
    expect(found?.id).toBe(APP_ID)
  })

  it('references the tailored resume version and tailored match score', () => {
    const built = buildAutoApplyWorkspaceRecords({
      item: item({
        resumeVersionId: VERSION_ID,
        resumeVersionName: 'Tailored v1 — Lead Software Engineer',
        tailoredResumeText: 'Tailored Java resume',
        initialMatchScore: 86,
        finalMatchScore: 94,
      }),
      userId: USER,
      jobs: [],
      applications: [],
      matches: [
        match(),
        match({
          id: TAILORED_MATCH_ID,
          resumeVersionId: VERSION_ID,
          parentMatchId: MATCH_ID,
          overallScore: 94,
        }),
      ],
      resumeVersions: [version()],
      masterResume: resume(),
      now: '2026-09-18T15:00:00.000Z',
    })

    expect(usesTailoredResumeVersion(item({ resumeVersionId: VERSION_ID, resumeVersionName: 'Tailored v1' }), RESUME_ID)).toBe(true)
    expect(built.application.selectedResumeVersionId).toBe(VERSION_ID)
    expect(built.application.currentMatchId).toBe(TAILORED_MATCH_ID)
    expect(built.application.currentMatchScore).toBe(94)
    expect(built.application.matchId).toBe(MATCH_ID)
    expect(built.resumeVersion?.id).toBe(VERSION_ID)
    expect(built.resumeVersion?.sourceResumeId).toBe(RESUME_ID)
  })

  it('creates a tailored resume version from Auto Apply text without overwriting the master resume', () => {
    const master = resume()
    const built = buildAutoApplyWorkspaceRecords({
      item: item({
        resumeVersionId: VERSION_ID,
        resumeVersionName: 'Tailored v1 — Lead Software Engineer',
        tailoredResumeText: 'Emphasized existing Java and Spring Boot work.',
        initialMatchScore: 80,
        finalMatchScore: 88,
      }),
      userId: USER,
      jobs: [],
      applications: [],
      matches: [],
      resumeVersions: [],
      masterResume: master,
      now: '2026-09-18T15:00:00.000Z',
    })

    expect(built.resumeVersion?.id).toBe(VERSION_ID)
    expect(built.resumeVersion?.sourceResumeId).toBe(master.id)
    expect(built.resumeVersion?.resumeContent.summary).toContain('Java')
    expect(built.application.selectedResumeVersionId).toBe(VERSION_ID)
    expect(built.application.currentMatchScore).toBe(88)
    expect(built.application.currentMatchId).toBeNull()
    expect(master.parsedText).toBe('Java Spring Boot')
  })

  it('keeps status ready until the employer application is actually submitted', () => {
    expect(applicationStatusFromQueue('ready')).toBe('ready')
    expect(applicationStatusFromQueue('ready_for_submission')).toBe('ready')
    expect(applicationStatusFromQueue('needs_user_input')).toBe('ready')
    expect(applicationStatusFromQueue('needs_user_confirmation')).toBe('ready')
    expect(applicationStatusFromQueue('submitting')).toBe('ready')
    expect(applicationStatusFromQueue('captcha_required')).toBe('ready')
    expect(applicationStatusFromQueue('opening')).toBe('ready')
    expect(applicationStatusFromQueue('submitted')).toBe('applied')
    expect(applicationStatusFromQueue('ready', application({ status: 'applied' }))).toBe('applied')

    const submitted = buildAutoApplyWorkspaceRecords({
      item: item({ applicationStatus: 'submitted', finalMatchScore: 91 }),
      userId: USER,
      jobs: [job()],
      applications: [application()],
      matches: [],
      resumeVersions: [],
      masterResume: resume(),
      now: '2026-09-18T18:00:00.000Z',
    })
    expect(submitted.application.status).toBe('applied')
    expect(submitted.application.dateApplied).toBe('2026-09-18')
    expect(submitted.application.id).toBe(APP_ID)
  })

  it('keeps the application visible after the workspace snapshot is reused (refresh/navigation)', () => {
    const built = buildAutoApplyWorkspaceRecords({
      item: item(),
      listedJob: {
        id: JOB_ID,
        title: item().title,
        company: 'JPMorgan Chase',
        location: 'Columbus, OH',
        jobUrl: 'https://jobs.example.com/jpmorgan',
        identityKey: 'jpmorgan-lead-java',
      },
      userId: USER,
      jobs: [],
      applications: [],
      matches: [],
      resumeVersions: [],
      masterResume: resume(),
    })
    const refreshedJobs = [built.job]
    const refreshedApplications = [built.application]
    expect(applicationsVisibleOnApplicationsPage(refreshedApplications, refreshedJobs).map((row) => row.id)).toEqual([
      APP_ID,
    ])
    const afterNavigation = applicationsVisibleOnApplicationsPage(refreshedApplications, refreshedJobs)
    expect(afterNavigation).toHaveLength(1)
    expect(afterNavigation[0]?.jobId).toBe(JOB_ID)
  })
})
