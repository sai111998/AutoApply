import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { analyzeJobRequest, extractResumeTextRequest } from '@/lib/ai/client'
import { mapApiResultToMatchFields } from '@/lib/ai/map-response'
import {
  deleteAnalysisRecords,
  fetchAnalysisHistory,
  fetchJobApplicationBundle,
  persistAnalysisRecords,
  persistApplicationSelection,
  persistMatchRecord,
  upsertById,
} from '@/lib/analysis-persist'
import { deleteResumeVersionRecord, deselectAllResumeVersionsForJob, deselectOtherResumeVersions, fetchResumeVersions, persistResumeVersion } from '@/lib/resume-versions'
import { tailoredResumeToText } from '@/lib/tailored-text'
import { jobProfileFromMatch, resumeProfileFromTailored } from '@/lib/evidence-profiles'
import {
  applyResumeSelection,
  originalMatchForJob,
} from '@/lib/application-selection'
import { mergeResumeVersion, normalizeResumeVersion } from '@/lib/tailor-session'
import { createId, nextActionForStatus, titleFromJobDescription } from '@/lib/format'
import {
  emptyWorkspace,
  mapPreferences,
  mapProfile,
  mapResume,
  mapSkill,
  preferencesToRow,
  profileToRow,
  resumeToRow,
  skillToRow,
} from '@/lib/mappers'
import { userFacingPersistError } from '@/lib/persist-errors'
import { supabase } from '@/lib/supabase'
import { createSampleWorkspace } from '@/data/sample'
import type {
  Application,
  ApplicationStatus,
  Job,
  JobMatch,
  Profile,
  Resume,
  Skill,
  ResumeVersion,
  UserPreferences,
  WorkspaceSnapshot,
} from '@/types/domain'
import { useAuth } from './AuthContext'

const DEMO_WORKSPACE_KEY = 'jobpilot.workspace'

interface AnalyzeJobInput {
  description: string
  resumeId: string
}

interface WorkspaceContextValue extends WorkspaceSnapshot {
  loading: boolean
  historyLoading: boolean
  error: string | null
  historyError: string | null
  masterResume: Resume | null
  saveProfile: (profile: Profile, skills: Skill[]) => Promise<void>
  uploadResume: (file: File, versionLabel: string) => Promise<void>
  setMasterResume: (resumeId: string) => Promise<void>
  hydrateResumeText: (resumeId: string) => Promise<string>
  analyzeJob: (input: AnalyzeJobInput) => Promise<string>
  refreshAnalyses: () => Promise<void>
  deleteAnalysis: (matchId: string) => Promise<void>
  updateApplication: (id: string, patch: Partial<Pick<Application, 'status' | 'notes' | 'dateApplied'>>) => Promise<void>
  savePreferences: (preferences: UserPreferences) => Promise<void>
  saveResumeVersion: (version: ResumeVersion) => Promise<void>
  renameResumeVersion: (id: string, versionName: string) => Promise<void>
  deleteResumeVersion: (id: string) => Promise<void>
  selectResumeVersion: (id: string) => Promise<ResumeVersion>
  selectResumeForJob: (input: { jobId: string; resumeVersionId: string | null }) => Promise<Application>
  analyzeTailoredVersion: (
    versionId: string,
    parentMatchId: string,
    options?: { select?: boolean; version?: ResumeVersion },
  ) => Promise<JobMatch>
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

function persistDemo(snapshot: WorkspaceSnapshot) {
  sessionStorage.setItem(DEMO_WORKSPACE_KEY, JSON.stringify(snapshot))
}

function mergeById<T extends { id: string }>(current: T[] | undefined, extras: T[]): T[] {
  const existing = current ?? []
  const ids = new Set(existing.map((item) => item.id))
  return [...existing, ...extras.filter((item) => !ids.has(item.id))]
}

function readDemo(): WorkspaceSnapshot {
  const fresh = createSampleWorkspace()
  const raw = sessionStorage.getItem(DEMO_WORKSPACE_KEY)
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as WorkspaceSnapshot
      const merged: WorkspaceSnapshot = {
        ...parsed,
        resumeVersions: (parsed.resumeVersions ?? []).map(normalizeResumeVersion),
        applications: (parsed.applications ?? []).map((application) => ({
          ...application,
          selectedResumeVersionId: application.selectedResumeVersionId ?? null,
          currentMatchId: application.currentMatchId ?? application.matchId,
          currentMatchScore: application.currentMatchScore ?? null,
        })),
        resumes: mergeById(parsed.resumes, fresh.resumes),
        jobs: mergeById(parsed.jobs, fresh.jobs),
        matches: mergeById(parsed.matches, fresh.matches),
      }
      persistDemo(merged)
      return merged
    } catch {
      sessionStorage.removeItem(DEMO_WORKSPACE_KEY)
    }
  }
  persistDemo(fresh)
  return fresh
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user, isDemo, loading: authLoading } = useAuth()
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot>(emptyWorkspace('anon', ''))
  const [loading, setLoading] = useState(true)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const analyzeLock = useRef(false)
  const snapshotRef = useRef(snapshot)
  snapshotRef.current = snapshot

  const replace = useCallback(
    (updater: (current: WorkspaceSnapshot) => WorkspaceSnapshot) => {
      setSnapshot((current) => {
        const next = updater(current)
        snapshotRef.current = next
        if (isDemo) persistDemo(next)
        return next
      })
    },
    [isDemo],
  )

  const refreshAnalyses = useCallback(async () => {
    if (!user || isDemo || !supabase) return
    setHistoryLoading(true)
    setHistoryError(null)
    try {
      const history = await fetchAnalysisHistory(supabase, user.id)
      if (history.error) {
        setHistoryError(history.error)
        return
      }
      replace((current) => ({
        ...current,
        jobs: history.jobs,
        matches: history.matches,
        applications: history.applications,
      }))
    } catch (refreshError) {
      setHistoryError(refreshError instanceof Error ? refreshError.message : 'Could not load analysis history')
    } finally {
      setHistoryLoading(false)
    }
  }, [isDemo, replace, user])

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (authLoading) return
      if (!user) {
        setSnapshot(emptyWorkspace('anon', ''))
        setLoading(false)
        return
      }

      const userId = user.id
      const alreadyHydrated = snapshotRef.current.profile.id === userId
      if (!alreadyHydrated) setLoading(true)
      setError(null)
      setHistoryError(null)

      if (isDemo) {
        setSnapshot(readDemo())
        setLoading(false)
        return
      }

      if (!supabase) {
        setError('Supabase is not configured.')
        setLoading(false)
        return
      }

      try {
        const [profileRes, skillsRes, resumesRes, preferencesRes] = await Promise.all([
          supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
          supabase.from('skills').select('*').eq('user_id', userId).order('name'),
          supabase.from('resumes').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
          supabase.from('user_preferences').select('*').eq('user_id', userId).maybeSingle(),
        ])

        const failures = [profileRes.error, skillsRes.error, resumesRes.error, preferencesRes.error].filter(Boolean)
        if (failures.length) {
          throw new Error(failures[0]?.message ?? 'Failed to load workspace')
        }

        const history = await fetchAnalysisHistory(supabase, userId)
        if (history.error) setHistoryError(history.error)
        const versions = await fetchResumeVersions(supabase, userId)
        if (versions.error) {
          setHistoryError(`resume versions: ${versions.error}`)
        }

        let base = emptyWorkspace(userId, user.email, user.fullName ?? '')
        if (profileRes.data) base = { ...base, profile: mapProfile(profileRes.data, user.email) }
        else {
          await supabase.from('profiles').upsert(profileToRow(base.profile))
        }

        if (preferencesRes.data) base = { ...base, preferences: mapPreferences(preferencesRes.data) }
        else {
          await supabase.from('user_preferences').upsert(preferencesToRow(base.preferences))
        }

        const next: WorkspaceSnapshot = {
          ...base,
          skills: (skillsRes.data ?? []).map(mapSkill),
          resumes: (resumesRes.data ?? []).map(mapResume),
          jobs: history.jobs,
          matches: history.matches,
          applications: history.applications,
          resumeVersions: versions.versions,
        }

        if (!cancelled) setSnapshot(next)
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Could not load workspace')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [authLoading, isDemo, user?.id])

  const saveProfile = useCallback(
    async (profile: Profile, skills: Skill[]) => {
      const updatedProfile = { ...profile, updatedAt: new Date().toISOString() }
      replace((current) => ({ ...current, profile: updatedProfile, skills }))
      if (isDemo || !supabase || !user) return
      const { error: profileError } = await supabase.from('profiles').upsert(profileToRow(updatedProfile))
      if (profileError) throw profileError
      const { error: deleteError } = await supabase.from('skills').delete().eq('user_id', user.id)
      if (deleteError) throw deleteError
      if (skills.length) {
        const { error: insertError } = await supabase.from('skills').insert(skills.map(skillToRow))
        if (insertError) throw insertError
      }
    },
    [isDemo, replace, user],
  )

  const uploadResume = useCallback(
    async (file: File, versionLabel: string) => {
      if (!user) throw new Error('Not signed in')
      const extension = file.name.split('.').pop()?.toLowerCase()
      if (extension !== 'pdf' && extension !== 'docx' && extension !== 'txt') {
        throw new Error('Upload a PDF, DOCX, or TXT resume.')
      }

      const resume: Resume = {
        id: createId(),
        userId: user.id,
        fileName: file.name,
        fileType:
          file.type ||
          (extension === 'pdf'
            ? 'application/pdf'
            : extension === 'txt'
              ? 'text/plain'
              : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
        versionLabel: versionLabel.trim() || file.name,
        isMaster: snapshot.resumes.length === 0,
        fileSize: file.size,
        storagePath: null,
        parsedText: await extractResumeTextRequest(file),
        createdAt: new Date().toISOString(),
      }

      if (!isDemo && supabase) {
        const path = `${user.id}/${resume.id}/${file.name}`
        const { error: uploadError } = await supabase.storage.from('resumes').upload(path, file)
        if (uploadError) throw uploadError
        resume.storagePath = path
        if (resume.isMaster) {
          await supabase.from('resumes').update({ is_master: false }).eq('user_id', user.id)
        }
        const { error: insertError } = await supabase.from('resumes').insert(resumeToRow(resume))
        if (insertError) throw insertError
      }

      replace((current) => ({
        ...current,
        resumes: [
          resume,
          ...current.resumes.map((item) => (resume.isMaster ? { ...item, isMaster: false } : item)),
        ],
      }))
    },
    [isDemo, replace, snapshot.resumes.length, user],
  )

  const hydrateResumeText = useCallback(
    async (resumeId: string) => {
      const current = snapshotRef.current.resumes.find((resume) => resume.id === resumeId) ?? null
      if (!current) throw new Error('Select a stored resume before analyzing.')
      if (current.parsedText.trim()) return current.parsedText

      if (!current.storagePath || isDemo || !supabase) {
        throw new Error('The selected resume has no extracted text. Re-upload the PDF or a .txt resume from Master Resume.')
      }

      const downloaded = await supabase.storage.from('resumes').download(current.storagePath)
      if (downloaded.error || !downloaded.data) {
        throw new Error(downloaded.error?.message ?? 'Could not download the stored resume to extract text.')
      }

      const file = new File([downloaded.data], current.fileName, {
        type: current.fileType || downloaded.data.type || 'application/octet-stream',
      })
      const parsedText = await extractResumeTextRequest(file)

      replace((state) => ({
        ...state,
        resumes: state.resumes.map((resume) => (resume.id === resumeId ? { ...resume, parsedText } : resume)),
      }))

      if (user) {
        const { error: updateError } = await supabase
          .from('resumes')
          .update({ parsed_text: parsedText })
          .eq('id', resumeId)
          .eq('user_id', user.id)
        if (updateError) throw updateError
      }

      return parsedText
    },
    [isDemo, replace, user],
  )

  const setMasterResume = useCallback(
    async (resumeId: string) => {
      replace((current) => ({
        ...current,
        resumes: current.resumes.map((resume) => ({ ...resume, isMaster: resume.id === resumeId })),
      }))
      if (isDemo || !supabase || !user) return
      const { error: clearError } = await supabase.from('resumes').update({ is_master: false }).eq('user_id', user.id)
      if (clearError) throw clearError
      const { error: setError } = await supabase.from('resumes').update({ is_master: true }).eq('id', resumeId)
      if (setError) throw setError
    },
    [isDemo, replace, user],
  )

  const analyzeJob = useCallback(
    async (input: AnalyzeJobInput) => {
      if (!user) throw new Error('Not signed in')
      if (analyzeLock.current) throw new Error('An analysis is already running.')
      const jobDescription = input.description.trim()
      const selected = snapshot.resumes.find((resume) => resume.id === input.resumeId) ?? null
      if (!jobDescription) throw new Error('Paste a job description to analyze.')
      if (!selected) throw new Error('Select a stored resume before analyzing.')
      const resumeText = (selected.parsedText.trim() || (await hydrateResumeText(selected.id))).trim()
      if (!resumeText) {
        throw new Error('The selected resume has no extracted text. Re-upload the PDF or a .txt resume from Master Resume.')
      }

      analyzeLock.current = true
      try {
        const now = new Date().toISOString()

        const job: Job = {
          id: createId(),
          userId: user.id,
          title: titleFromJobDescription(jobDescription),
          company: 'Unknown company',
          location: '',
          jobUrl: '',
          description: jobDescription,
          createdAt: now,
        }

        let match: JobMatch = {
          id: createId(),
          userId: user.id,
          jobId: job.id,
          resumeId: selected.id,
          overallScore: null,
          skillsMatched: [],
          skillsPartial: [],
          skillsMissing: [],
          experienceMatch: null,
          educationMatch: null,
          locationMatch: null,
          workAuthorizationNotes: null,
          strengths: [],
          concerns: [],
          recommendation: null,
          analysisStatus: 'queued',
          analysisSource: 'api',
          provider: null,
          errorMessage: null,
          summary: null,
          createdAt: now,
          analyzedAt: null,
        }

        const application: Application = {
          id: createId(),
          userId: user.id,
          jobId: job.id,
          matchId: match.id,
          resumeId: selected.id,
          selectedResumeVersionId: null,
          currentMatchId: match.id,
          currentMatchScore: match.overallScore,
          status: 'ready',
          dateAdded: now.slice(0, 10),
          dateApplied: null,
          nextAction: nextActionForStatus('ready'),
          notes: '',
          updatedAt: now,
        }

        const response = await analyzeJobRequest({
          jobDescription,
          resumeText,
          userId: isDemo ? undefined : user.id,
          resumeId: selected.id,
          jobId: job.id,
          matchId: match.id,
          applicationId: application.id,
          title: job.title,
          company: job.company,
          location: job.location,
          jobUrl: job.jobUrl,
        })

        if (response.status === 'complete') {
          match = {
            ...match,
            ...mapApiResultToMatchFields(response.result),
          }
        } else {
          match = {
            ...match,
            analysisStatus: 'failed',
            errorMessage: response.message,
          }
        }

        application.currentMatchId = match.id
        application.currentMatchScore = match.overallScore

        replace((current) => ({
          ...current,
          jobs: upsertById(current.jobs, job),
          matches: upsertById(current.matches, match),
          applications: upsertById(current.applications, application),
        }))

        if (!isDemo && supabase) {
          try {
            await persistAnalysisRecords(supabase, { job, match, application })
            await refreshAnalyses()
          } catch (persistError) {
            const message =
              persistError instanceof Error ? persistError.message : 'Analysis completed but could not be saved.'
            setHistoryError(message)
            throw new Error(message)
          }
        }

        if (match.analysisStatus !== 'complete') {
          throw new Error(match.errorMessage || 'Analysis did not complete. Your draft is still saved in this browser.')
        }

        return match.id
      } finally {
        analyzeLock.current = false
      }
    },
    [hydrateResumeText, isDemo, refreshAnalyses, replace, snapshot.resumes, user],
  )

  const deleteAnalysis = useCallback(
    async (matchId: string) => {
      const current = snapshotRef.current
      const match = current.matches.find((item) => item.id === matchId)
      if (!match) return
      const application =
        current.applications.find((item) => item.matchId === matchId) ??
        current.applications.find((item) => item.jobId === match.jobId) ??
        null

      if (!isDemo && supabase && user) {
        await deleteAnalysisRecords(supabase, user.id, {
          matchId,
          jobId: match.jobId,
          applicationId: application?.id ?? null,
        })
        await refreshAnalyses()
        return
      }

      replace((state) => {
        const remainingMatches = state.matches.filter((item) => item.id !== matchId)
        const remainingApplications = state.applications.filter((item) => item.matchId !== matchId)
        const jobStillUsed = remainingMatches.some((item) => item.jobId === match.jobId)
        return {
          ...state,
          matches: remainingMatches,
          applications: remainingApplications,
          jobs: jobStillUsed ? state.jobs : state.jobs.filter((job) => job.id !== match.jobId),
        }
      })
    },
    [isDemo, refreshAnalyses, replace, user],
  )

  const updateApplication = useCallback(
    async (id: string, patch: Partial<Pick<Application, 'status' | 'notes' | 'dateApplied'>>) => {
      const now = new Date().toISOString()
      let nextStatus: ApplicationStatus | undefined
      replace((current) => ({
        ...current,
        applications: current.applications.map((application) => {
          if (application.id !== id) return application
          nextStatus = patch.status ?? application.status
          const status = nextStatus
          return {
            ...application,
            ...patch,
            status,
            nextAction: nextActionForStatus(status),
            dateApplied:
              patch.dateApplied ??
              (status === 'applied' && !application.dateApplied ? now.slice(0, 10) : application.dateApplied),
            updatedAt: now,
          }
        }),
      }))

      if (isDemo || !supabase) return
      const { error: updateError } = await supabase
        .from('applications')
        .update({
          status: patch.status,
          notes: patch.notes,
          date_applied: patch.dateApplied,
          next_action: nextStatus ? nextActionForStatus(nextStatus) : undefined,
          updated_at: now,
        })
        .eq('id', id)
      if (updateError) throw updateError
    },
    [isDemo, replace],
  )

  const savePreferences = useCallback(
    async (preferences: UserPreferences) => {
      const next = { ...preferences, updatedAt: new Date().toISOString() }
      replace((current) => ({ ...current, preferences: next }))
      if (isDemo || !supabase) return
      const { error: prefsError } = await supabase.from('user_preferences').upsert(preferencesToRow(next))
      if (prefsError) throw prefsError
    },
    [isDemo, replace],
  )

  const saveResumeVersion = useCallback(
    async (version: ResumeVersion) => {
      replace((current) => ({
        ...current,
        resumeVersions: mergeResumeVersion(current.resumeVersions ?? [], version),
      }))
      if (isDemo || !supabase) return
      if (version.status === 'generating') return
      await persistResumeVersion(supabase, version)
    },
    [isDemo, replace],
  )

  const renameResumeVersion = useCallback(
    async (id: string, versionName: string) => {
      const now = new Date().toISOString()
      replace((current) => ({
        ...current,
        resumeVersions: (current.resumeVersions ?? []).map((item) =>
          item.id === id ? { ...item, versionName, updatedAt: now } : item,
        ),
      }))
      if (isDemo || !supabase) return
      const { error: updateError } = await supabase
        .from('resume_versions')
        .update({ version_name: versionName, updated_at: now })
        .eq('id', id)
      if (updateError) throw updateError
    },
    [isDemo, replace],
  )

  const deleteResumeVersion = useCallback(
    async (id: string) => {
      replace((current) => ({
        ...current,
        resumeVersions: (current.resumeVersions ?? []).filter((item) => item.id !== id),
      }))
      if (isDemo || !supabase || !user) return
      await deleteResumeVersionRecord(supabase, user.id, id)
    },
    [isDemo, replace, user],
  )

  const selectResumeForJob = useCallback(
    async (input: { jobId: string; resumeVersionId: string | null }) => {
      const current = snapshotRef.current
      const original = originalMatchForJob(
        current.matches,
        input.jobId,
        current.applications.find((item) => item.jobId === input.jobId) ?? null,
      )
      const now = new Date().toISOString()
      const application =
        current.applications.find((item) => item.jobId === input.jobId) ??
        ({
          id: createId(),
          userId: user?.id ?? original?.userId ?? '',
          jobId: input.jobId,
          matchId: original?.id ?? null,
          resumeId: original?.resumeId ?? null,
          selectedResumeVersionId: null,
          currentMatchId: original?.id ?? null,
          currentMatchScore: original?.overallScore ?? null,
          status: 'ready',
          dateAdded: now.slice(0, 10),
          dateApplied: null,
          nextAction: nextActionForStatus('ready'),
          notes: '',
          updatedAt: now,
        } satisfies Application)
      if (input.resumeVersionId) {
        const version = (current.resumeVersions ?? []).find((item) => item.id === input.resumeVersionId)
        if (!version) throw new Error('That tailored version was not found.')
      }
      const applied = applyResumeSelection({
        application,
        versions: current.resumeVersions ?? [],
        matches: current.matches,
        jobId: input.jobId,
        resumeVersionId: input.resumeVersionId,
        originalMatch: original,
      })

      replace((state) => ({
        ...state,
        applications: upsertById(state.applications, applied.application),
        resumeVersions: applied.versions,
      }))

      if (!isDemo && supabase && user) {
        const selected = input.resumeVersionId
          ? applied.versions.find((item) => item.id === input.resumeVersionId)
          : null
        if (selected) {
          await persistResumeVersion(supabase, selected)
          await deselectOtherResumeVersions(supabase, selected)
        } else {
          await deselectAllResumeVersionsForJob(supabase, user.id, input.jobId)
        }
        await persistApplicationSelection(supabase, applied.application)
        const persisted = await fetchJobApplicationBundle(supabase, user.id, input.jobId)
        if (!persisted.error) {
          replace((state) => ({
            ...state,
            applications: persisted.application
              ? upsertById(state.applications, persisted.application)
              : state.applications,
            matches: persisted.matches.reduce((items, match) => upsertById(items, match), state.matches),
            resumeVersions: persisted.versions.length
              ? [
                  ...persisted.versions,
                  ...(state.resumeVersions ?? []).filter((item) => item.jobId !== input.jobId),
                ]
              : state.resumeVersions,
          }))
        }
      }

      return snapshotRef.current.applications.find((item) => item.id === applied.application.id) ?? applied.application
    },
    [isDemo, replace, user],
  )

  const selectResumeVersion = useCallback(
    async (id: string) => {
      const version = (snapshotRef.current.resumeVersions ?? []).find((item) => item.id === id)
      if (!version) throw new Error('That tailored version was not found.')
      if (!version.jobId) throw new Error('This version is not linked to a job.')
      await selectResumeForJob({ jobId: version.jobId, resumeVersionId: version.id })
      const selected = (snapshotRef.current.resumeVersions ?? []).find((item) => item.id === id)
      if (!selected) throw new Error('That tailored version was not found.')
      return selected
    },
    [selectResumeForJob],
  )

  const analyzeTailoredVersion = useCallback(
    async (
      versionId: string,
      parentMatchId: string,
      options?: { select?: boolean; version?: ResumeVersion },
    ) => {
      if (!user) throw new Error('Not signed in')
      const current = snapshotRef.current
      const version =
        options?.version ?? (current.resumeVersions ?? []).find((item) => item.id === versionId)
      const parent = current.matches.find((item) => item.id === parentMatchId)
      const job = parent ? current.jobs.find((item) => item.id === parent.jobId) : undefined
      if (!version || !parent || !job) throw new Error('Could not re-analyze this tailored resume.')
      const resumeText = tailoredResumeToText(version.resumeContent)
      if (!resumeText.trim()) throw new Error('The tailored resume is empty.')

      const now = new Date().toISOString()
      let match: JobMatch = {
        id: createId(),
        userId: user.id,
        jobId: job.id,
        resumeId: version.sourceResumeId,
        parentMatchId: parent.id,
        resumeVersionId: version.id,
        overallScore: null,
        skillsMatched: [],
        skillsPartial: [],
        skillsMissing: [],
        experienceMatch: null,
        educationMatch: null,
        locationMatch: null,
        workAuthorizationNotes: null,
        strengths: [],
        concerns: [],
        recommendation: null,
        analysisStatus: 'queued',
        analysisSource: 'api',
        provider: null,
        errorMessage: null,
        summary: null,
        createdAt: now,
        analyzedAt: null,
      }

      const response = await analyzeJobRequest({
        jobDescription: job.description,
        resumeText,
        userId: isDemo ? undefined : user.id,
        resumeId: version.sourceResumeId,
        jobId: job.id,
        matchId: match.id,
        title: job.title,
        company: job.company,
        location: job.location,
        jobUrl: job.jobUrl,
        resumeProfile: resumeProfileFromTailored(version.resumeContent),
        jobProfile: jobProfileFromMatch(parent, job),
        persistResults: false,
      })

      if (response.status === 'complete') {
        match = { ...match, ...mapApiResultToMatchFields(response.result) }
      } else {
        match = {
          ...match,
          analysisStatus: 'failed',
          errorMessage: response.message,
        }
      }

      const select = Boolean(options?.select)
      const updatedVersion: ResumeVersion = {
        ...version,
        comparisonAnalysisId: match.id,
        updatedAt: now,
      }

      replace((state) => ({
        ...state,
        matches: upsertById(state.matches, match),
        resumeVersions: upsertById(state.resumeVersions ?? [], updatedVersion),
      }))

      if (!isDemo && supabase) {
        try {
          await persistResumeVersion(supabase, updatedVersion)
          await persistMatchRecord(supabase, match)
        } catch (error) {
          throw new Error(userFacingPersistError(error, 'Could not save the updated match analysis.'))
        }
      }

      if (match.analysisStatus !== 'complete') {
        throw new Error(match.errorMessage || 'The updated match analysis did not complete.')
      }

      if (select && job.id) {
        await selectResumeForJob({ jobId: job.id, resumeVersionId: updatedVersion.id })
      }

      return match
    },
    [isDemo, replace, selectResumeForJob, user],
  )

  const masterResume = snapshot.resumes.find((resume) => resume.isMaster) ?? null

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      ...snapshot,
      loading,
      historyLoading,
      error,
      historyError,
      masterResume,
      saveProfile,
      uploadResume,
      setMasterResume,
      hydrateResumeText,
      analyzeJob,
      refreshAnalyses,
      deleteAnalysis,
      updateApplication,
      savePreferences,
      saveResumeVersion,
      renameResumeVersion,
      deleteResumeVersion,
      selectResumeVersion,
      selectResumeForJob,
      analyzeTailoredVersion,
    }),
    [
      analyzeJob,
      analyzeTailoredVersion,
      deleteAnalysis,
      deleteResumeVersion,
      error,
      historyError,
      historyLoading,
      hydrateResumeText,
      loading,
      masterResume,
      refreshAnalyses,
      renameResumeVersion,
      savePreferences,
      saveResumeVersion,
      saveProfile,
      selectResumeVersion,
      selectResumeForJob,
      setMasterResume,
      snapshot,
      updateApplication,
      uploadResume,
    ],
  )

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error('useWorkspace must be used within WorkspaceProvider')
  return ctx
}
