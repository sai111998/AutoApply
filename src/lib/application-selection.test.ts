import { describe, expect, it } from 'vitest'
import {
  MASTER_RESUME_OPTION_ID,
  analysesForJob,
  applyResumeSelection,
  buildSelectableResumeOptions,
  createEditedResumeVersion,
  formatScoreDelta,
  listJobResumeVersions,
  masterResumeUnchanged,
  nextEditedVersionName,
  nextTailoredVersionName,
  onlyOneVersionSelected,
  pdfContentForSelection,
  resolveApplicationResumeDisplay,
  scoreChangeMessage,
} from './application-selection'
import { shouldAutoStartGeneration } from './tailor-session'
import { emptyTailoredContent } from './tailored-text'
import { applicationCoreRow, applicationToRow, mapApplication } from './mappers'
import { scoreChange } from './tailored-text'
import type { Application, JobMatch, Resume, ResumeVersion, TailoredResumeContent } from '@/types/domain'

function content(summary: string): TailoredResumeContent {
  return {
    ...emptyTailoredContent(),
    summary,
    skills: ['Java', 'Spring Boot'],
    contact: { name: 'Jordan Hale', email: 'jordan@example.com', location: 'Austin, TX' },
  }
}

function resume(): Resume {
  return {
    id: 'resume-1',
    userId: 'user-a',
    fileName: 'master.pdf',
    fileType: 'application/pdf',
    versionLabel: 'Master Resume',
    isMaster: true,
    fileSize: 12,
    storagePath: null,
    parsedText: 'Software Engineer with experience in Java development.',
    createdAt: '2026-08-24T01:00:00.000Z',
  }
}

function match(overrides: Partial<JobMatch> = {}): JobMatch {
  return {
    id: 'match-original',
    userId: 'user-a',
    jobId: 'job-1',
    resumeId: 'resume-1',
    parentMatchId: null,
    resumeVersionId: null,
    overallScore: 92,
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
    createdAt: '2026-08-24T01:00:00.000Z',
    analyzedAt: '2026-08-24T01:00:00.000Z',
    ...overrides,
  }
}

function version(overrides: Partial<ResumeVersion> = {}): ResumeVersion {
  return {
    id: 'ver-tailored',
    userId: 'user-a',
    sourceResumeId: 'resume-1',
    jobId: 'job-1',
    analysisId: 'match-original',
    versionName: 'Tailored — Senior Java Engineer',
    resumeContent: content('Tailored Java engineer'),
    tailoringSummary: { skillsToEmphasize: ['Java'], relatedSkills: [], missingSkills: [], experienceToEmphasize: [] },
    changes: [],
    warnings: [],
    status: 'completed',
    createdBy: 'ai',
    isSelected: false,
    generationId: 'gen-1',
    comparisonAnalysisId: 'match-tailored',
    originalContent: content('Original Java engineer'),
    createdAt: '2026-08-24T01:02:00.000Z',
    updatedAt: '2026-08-24T01:02:00.000Z',
    ...overrides,
  }
}

function application(overrides: Partial<Application> = {}): Application {
  return {
    id: 'app-1',
    userId: 'user-a',
    jobId: 'job-1',
    matchId: 'match-original',
    resumeId: 'resume-1',
    selectedResumeVersionId: null,
    currentMatchId: 'match-original',
    currentMatchScore: 92,
    status: 'ready',
    dateAdded: '2026-08-24',
    dateApplied: null,
    nextAction: 'Ready to apply',
    notes: '',
    updatedAt: '2026-08-24T01:00:00.000Z',
    ...overrides,
  }
}

function workspace(versions: ResumeVersion[], matches: JobMatch[], app = application()) {
  return {
    application: app,
    versions,
    matches,
    resumes: [resume()],
    original: matches.find((item) => item.id === 'match-original') ?? match(),
  }
}

describe('resume version selection and application sync', () => {
  const original = match()
  const tailoredMatch = match({
    id: 'match-tailored',
    parentMatchId: 'match-original',
    resumeVersionId: 'ver-tailored',
    overallScore: 88,
  })
  const higherMatch = match({
    id: 'match-higher',
    parentMatchId: 'match-original',
    resumeVersionId: 'ver-higher',
    overallScore: 96,
  })
  const editedMatch = match({
    id: 'match-edited',
    parentMatchId: 'match-original',
    resumeVersionId: 'ver-edited',
    overallScore: 94,
  })

  it('1. keeps the master resume available after tailoring', () => {
    const options = buildSelectableResumeOptions({
      masterResume: resume(),
      versions: [version()],
      matches: [original, tailoredMatch],
      sourceResumeId: 'resume-1',
      jobId: 'job-1',
      application: application(),
      originalMatch: original,
    })
    expect(options.some((item) => item.id === MASTER_RESUME_OPTION_ID)).toBe(true)
    expect(options.find((item) => item.id === MASTER_RESUME_OPTION_ID)?.matchScore).toBe(92)
    expect(masterResumeUnchanged(resume(), resume())).toBe(true)
  })

  it('2. keeps both versions when the tailored score is higher', () => {
    const tailored = version({
      id: 'ver-higher',
      comparisonAnalysisId: 'match-higher',
      versionName: 'Tailored — Senior Java Engineer',
    })
    const options = buildSelectableResumeOptions({
      masterResume: resume(),
      versions: [tailored],
      matches: [original, higherMatch],
      sourceResumeId: 'resume-1',
      jobId: 'job-1',
      application: application(),
      originalMatch: original,
    })
    expect(scoreChange(92, 96)?.delta).toBe(4)
    expect(options).toHaveLength(2)
    expect(options.map((item) => item.id)).toEqual([MASTER_RESUME_OPTION_ID, 'ver-higher'])
  })

  it('3. keeps both versions when the tailored score is lower', () => {
    const options = buildSelectableResumeOptions({
      masterResume: resume(),
      versions: [version()],
      matches: [original, tailoredMatch],
      sourceResumeId: 'resume-1',
      jobId: 'job-1',
      application: application(),
      originalMatch: original,
    })
    expect(scoreChange(92, 88)?.delta).toBe(-4)
    expect(options).toHaveLength(2)
  })

  it('4. treats an equal score as a valid comparison, not an error', () => {
    expect(scoreChange(92, 92)).toEqual({ previous: 92, updated: 92, delta: 0 })
    expect(scoreChangeMessage(0)).toBe('Match score is unchanged.')
    expect(formatScoreDelta(0)).toBe('0')
  })

  it('5. lets the user choose the master resume', () => {
    const state = workspace(
      [version({ isSelected: true, status: 'kept' })],
      [original, tailoredMatch],
      application({ selectedResumeVersionId: 'ver-tailored', currentMatchId: 'match-tailored', currentMatchScore: 88 }),
    )
    const next = applyResumeSelection({
      ...state,
      jobId: 'job-1',
      resumeVersionId: null,
      originalMatch: original,
    })
    expect(next.application.selectedResumeVersionId).toBeNull()
    expect(next.application.currentMatchScore).toBe(92)
    expect(next.application.matchId).toBe('match-original')
    expect(next.versions.every((item) => !item.isSelected)).toBe(true)
    expect(next.application.status).toBe('ready')
  })

  it('6. lets the user choose the tailored resume', () => {
    const next = applyResumeSelection({
      ...workspace([version()], [original, tailoredMatch]),
      jobId: 'job-1',
      resumeVersionId: 'ver-tailored',
      originalMatch: original,
    })
    expect(next.application.selectedResumeVersionId).toBe('ver-tailored')
    expect(next.application.currentMatchId).toBe('match-tailored')
    expect(next.application.currentMatchScore).toBe(88)
    expect(next.versions.find((item) => item.id === 'ver-tailored')?.isSelected).toBe(true)
  })

  it('7. lets the user choose an edited tailored resume', () => {
    const edited = version({
      id: 'ver-edited',
      createdBy: 'user',
      status: 'edited',
      versionName: 'Edited Tailored — Senior Java Engineer',
      comparisonAnalysisId: 'match-edited',
    })
    const next = applyResumeSelection({
      ...workspace([version(), edited], [original, tailoredMatch, editedMatch]),
      jobId: 'job-1',
      resumeVersionId: 'ver-edited',
      originalMatch: original,
    })
    expect(next.application.selectedResumeVersionId).toBe('ver-edited')
    expect(next.application.currentMatchScore).toBe(94)
    expect(next.application.status).not.toBe('applied')
  })

  it('8. selecting a version updates the application without deleting others', () => {
    const versions = [version(), version({ id: 'ver-2', versionName: 'Tailored v2 — Senior Java Engineer', isSelected: false })]
    const next = applyResumeSelection({
      ...workspace(versions, [original, tailoredMatch]),
      jobId: 'job-1',
      resumeVersionId: 'ver-tailored',
      originalMatch: original,
    })
    expect(next.versions).toHaveLength(2)
    expect(listJobResumeVersions(next.versions, 'resume-1', 'job-1')).toHaveLength(2)
    expect(next.application.updatedAt >= next.application.dateAdded).toBe(true)
  })

  it('9. Applications display uses the selected version and current score', () => {
    const display = resolveApplicationResumeDisplay({
      application: application({
        selectedResumeVersionId: 'ver-tailored',
        currentMatchId: 'match-tailored',
        currentMatchScore: 88,
      }),
      versions: [version({ isSelected: true, status: 'kept' })],
      matches: [original, tailoredMatch],
      resumes: [resume()],
    })
    expect(display.currentResumeLabel).toBe('Tailored — Senior Java Engineer')
    expect(display.currentMatchScore).toBe(88)
    expect(display.previousMatchScore).toBe(92)
    expect(display.usingMaster).toBe(false)
  })

  it('uses the selected version score even when the application still stores the original score', () => {
    const display = resolveApplicationResumeDisplay({
      application: application({
        selectedResumeVersionId: 'ver-tailored',
        currentMatchId: 'match-original',
        currentMatchScore: 30,
        matchId: 'match-original',
      }),
      versions: [
        version({
          isSelected: true,
          status: 'kept',
          comparisonAnalysisId: 'match-tailored',
        }),
      ],
      matches: [
        match({ id: 'match-original', overallScore: 30 }),
        match({
          id: 'match-tailored',
          parentMatchId: 'match-original',
          resumeVersionId: 'ver-tailored',
          overallScore: 36,
        }),
      ],
      resumes: [resume()],
    })
    expect(display.currentResumeLabel).toBe('Tailored — Senior Java Engineer')
    expect(display.currentMatchScore).toBe(36)
    expect(display.previousMatchScore).toBe(30)
    expect(display.currentMatchId).toBe('match-tailored')
  })

  it('uses is_selected to find the current score when application current_match_id is missing', () => {
    const display = resolveApplicationResumeDisplay({
      application: application({
        selectedResumeVersionId: null,
        currentMatchId: null,
        currentMatchScore: null,
      }),
      versions: [version({ isSelected: true, status: 'kept', comparisonAnalysisId: 'match-tailored' })],
      matches: [original, tailoredMatch],
      resumes: [resume()],
    })
    expect(display.currentMatchScore).toBe(88)
    expect(display.currentResumeLabel).toBe('Tailored — Senior Java Engineer')
  })

  it('10. previous analyses remain in history', () => {
    const history = analysesForJob([original, tailoredMatch, editedMatch], 'job-1')
    expect(history.map((item) => item.overallScore)).toEqual([92, 88, 94])
    expect(history[0]?.id).toBe('match-original')
    expect(history.some((item) => item.parentMatchId === 'match-original')).toBe(true)
  })

  it('11-13. selection is stored on the application so navigation, refresh, and re-login can reload it', () => {
    const next = applyResumeSelection({
      ...workspace([version()], [original, tailoredMatch]),
      jobId: 'job-1',
      resumeVersionId: 'ver-tailored',
      originalMatch: original,
    })
    const row = applicationToRow(next.application)
    expect(row.selected_resume_version_id).toBe('ver-tailored')
    expect(row.current_match_id).toBe('match-tailored')
    expect(row.current_match_score).toBe(88)
    expect(row.match_id).toBe('match-original')
    const mapped = mapApplication({
      ...row,
      next_action: row.next_action,
      notes: row.notes,
    })
    expect(resolveApplicationResumeDisplay({
      application: mapped,
      versions: next.versions,
      matches: [original, tailoredMatch],
      resumes: [resume()],
    }).currentMatchScore).toBe(88)
  })

  it('14. regenerate names a new version and does not auto-start when one already exists', () => {
    const existing = [version()]
    expect(nextTailoredVersionName(existing, 'Senior Java Engineer')).toBe('Tailored v2 — Senior Java Engineer')
    expect(shouldAutoStartGeneration(existing, 'resume-1', 'job-1', 'user-a')).toBe(false)
  })

  it('15. creating an edited copy does not mutate the master resume or previous tailored version', () => {
    const source = version()
    const masterBefore = resume()
    const edited = createEditedResumeVersion(source, content('Edited summary with Spring Boot'), 'Senior Java Engineer', [source])
    expect(edited.id).not.toBe(source.id)
    expect(edited.createdBy).toBe('user')
    expect(edited.status).toBe('edited')
    expect(edited.isSelected).toBe(false)
    expect(source.resumeContent.summary).toBe('Tailored Java engineer')
    expect(edited.resumeContent.summary).toBe('Edited summary with Spring Boot')
    expect(masterResumeUnchanged(masterBefore, resume())).toBe(true)
  })

  it('16. multiple versions can coexist', () => {
    const versions = [
      version(),
      version({ id: 'ver-2', versionName: 'Tailored v2 — Senior Java Engineer', createdAt: '2026-08-24T01:03:00.000Z' }),
      version({
        id: 'ver-edited',
        createdBy: 'user',
        status: 'edited',
        versionName: nextEditedVersionName([version()], 'Senior Java Engineer'),
      }),
    ]
    expect(listJobResumeVersions(versions, 'resume-1', 'job-1')).toHaveLength(3)
  })

  it('17. only one version is selected for a given job', () => {
    const next = applyResumeSelection({
      ...workspace(
        [version({ isSelected: true, status: 'kept' }), version({ id: 'ver-2', isSelected: true, status: 'kept' })],
        [original, tailoredMatch],
      ),
      jobId: 'job-1',
      resumeVersionId: 'ver-tailored',
      originalMatch: original,
    })
    expect(onlyOneVersionSelected(next.versions, 'job-1')).toBe(true)
    expect(next.versions.filter((item) => item.isSelected).map((item) => item.id)).toEqual(['ver-tailored'])
  })

  it('18. PDF downloads the currently selected version content', () => {
    const options = buildSelectableResumeOptions({
      masterResume: resume(),
      versions: [
        version({ isSelected: true, status: 'kept', resumeContent: content('Selected tailored text') }),
        version({ id: 'ver-2', resumeContent: content('Other version') }),
      ],
      matches: [original, tailoredMatch],
      sourceResumeId: 'resume-1',
      jobId: 'job-1',
      application: application({ selectedResumeVersionId: 'ver-tailored' }),
      originalMatch: original,
    })
    expect(pdfContentForSelection(options, content('fallback'))?.summary).toBe('Selected tailored text')
  })

  it('19. a user-edited resume gets a new analysis slot instead of overwriting the original', () => {
    const edited = createEditedResumeVersion(version(), content('Edited Java APIs'), 'Senior Java Engineer', [version()])
    const newAnalysis = match({
      id: 'match-edited-new',
      parentMatchId: 'match-original',
      resumeVersionId: edited.id,
      overallScore: 94,
    })
    expect(newAnalysis.id).not.toBe('match-original')
    expect(newAnalysis.resumeVersionId).toBe(edited.id)
    expect(edited.comparisonAnalysisId).toBeNull()
  })

  it('20. negative score changes are displayed as decreases, not errors', () => {
    expect(formatScoreDelta(-4)).toBe('-4')
    expect(formatScoreDelta(4)).toBe('+4')
    expect(scoreChangeMessage(-4)).toBe('Match score decreased by 4 points.')
    expect(scoreChangeMessage(4)).toBe('Match score increased by 4 points.')
    expect(scoreChange(92, 88)?.delta).toBe(-4)
  })

  it('does not mark the application as applied merely because a resume was selected', () => {
    const next = applyResumeSelection({
      ...workspace([version()], [original, tailoredMatch], application({ status: 'ready' })),
      jobId: 'job-1',
      resumeVersionId: 'ver-tailored',
      originalMatch: original,
    })
    expect(next.application.status).toBe('ready')
    expect(next.application.nextAction).toBe('Ready to apply')
    expect(next.application.dateApplied).toBeNull()
  })

  it('falls back to core application columns when the 005 migration is missing', () => {
    const row = applicationCoreRow(application({ selectedResumeVersionId: 'ver-tailored', currentMatchScore: 88 }))
    expect(row).not.toHaveProperty('selected_resume_version_id')
    expect(row).not.toHaveProperty('current_match_id')
    expect(row).not.toHaveProperty('current_match_score')
    expect(row.match_id).toBe('match-original')
  })
})
