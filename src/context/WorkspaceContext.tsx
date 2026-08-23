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
import { analyzeJobRequest } from '@/lib/ai/client'
import { mapApiResultToMatchFields } from '@/lib/ai/map-response'
import {
  deleteAnalysisRecords,
  fetchAnalysisHistory,
  persistAnalysisRecords,
  upsertById,
} from '@/lib/analysis-persist'
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
  analyzeJob: (input: AnalyzeJobInput) => Promise<string>
  refreshAnalyses: () => Promise<void>
  deleteAnalysis: (matchId: string) => Promise<void>
  updateApplication: (id: string, patch: Partial<Pick<Application, 'status' | 'notes' | 'dateApplied'>>) => Promise<void>
  savePreferences: (preferences: UserPreferences) => Promise<void>
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

function persistDemo(snapshot: WorkspaceSnapshot) {
  sessionStorage.setItem(DEMO_WORKSPACE_KEY, JSON.stringify(snapshot))
}

function readDemo(): WorkspaceSnapshot {
  const raw = sessionStorage.getItem(DEMO_WORKSPACE_KEY)
  if (raw) {
    try {
      return JSON.parse(raw) as WorkspaceSnapshot
    } catch {
      sessionStorage.removeItem(DEMO_WORKSPACE_KEY)
    }
  }
  const snapshot = createSampleWorkspace()
  persistDemo(snapshot)
  return snapshot
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

      setLoading(true)
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
        const userId = user.id
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
  }, [authLoading, isDemo, user])

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
        parsedText: extension === 'txt' ? await file.text() : '',
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
      const resumeText = selected?.parsedText.trim() ?? ''
      if (!jobDescription) throw new Error('Paste a job description to analyze.')
      if (!selected) throw new Error('Select a stored resume before analyzing.')
      if (!resumeText) {
        throw new Error('The selected resume has no extracted text. Upload a text resume or set parsed text on Master Resume.')
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
    [isDemo, refreshAnalyses, replace, snapshot.resumes, user],
  )

  const deleteAnalysis = useCallback(
    async (matchId: string) => {
      const current = snapshotRef.current
      const match = current.matches.find((item) => item.id === matchId)
      if (!match) return
      const application = current.applications.find((item) => item.matchId === matchId) ?? null

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
      analyzeJob,
      refreshAnalyses,
      deleteAnalysis,
      updateApplication,
      savePreferences,
    }),
    [
      analyzeJob,
      deleteAnalysis,
      error,
      historyError,
      historyLoading,
      loading,
      masterResume,
      refreshAnalyses,
      savePreferences,
      saveProfile,
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
