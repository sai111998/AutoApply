import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { getJobAnalysisClient } from '@/lib/ai/client'
import { createId, nextActionForStatus } from '@/lib/format'
import {
  applicationToRow,
  emptyWorkspace,
  jobToRow,
  mapApplication,
  mapJob,
  mapMatch,
  mapPreferences,
  mapProfile,
  mapResume,
  mapSkill,
  matchToRow,
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
  title: string
  company: string
  location: string
  jobUrl: string
  description: string
}

interface WorkspaceContextValue extends WorkspaceSnapshot {
  loading: boolean
  error: string | null
  masterResume: Resume | null
  saveProfile: (profile: Profile, skills: Skill[]) => Promise<void>
  uploadResume: (file: File, versionLabel: string) => Promise<void>
  setMasterResume: (resumeId: string) => Promise<void>
  analyzeJob: (input: AnalyzeJobInput) => Promise<string>
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
  const [error, setError] = useState<string | null>(null)

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
        const [
          profileRes,
          skillsRes,
          resumesRes,
          jobsRes,
          matchesRes,
          applicationsRes,
          preferencesRes,
        ] = await Promise.all([
          supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
          supabase.from('skills').select('*').eq('user_id', userId).order('name'),
          supabase.from('resumes').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
          supabase.from('jobs').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
          supabase.from('job_matches').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
          supabase.from('applications').select('*').eq('user_id', userId).order('date_added', { ascending: false }),
          supabase.from('user_preferences').select('*').eq('user_id', userId).maybeSingle(),
        ])

        const failures = [
          profileRes.error,
          skillsRes.error,
          resumesRes.error,
          jobsRes.error,
          matchesRes.error,
          applicationsRes.error,
          preferencesRes.error,
        ].filter(Boolean)

        if (failures.length) {
          throw new Error(failures[0]?.message ?? 'Failed to load workspace')
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
          jobs: (jobsRes.data ?? []).map(mapJob),
          matches: (matchesRes.data ?? []).map(mapMatch),
          applications: (applicationsRes.data ?? []).map(mapApplication),
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
      if (extension !== 'pdf' && extension !== 'docx') {
        throw new Error('Upload a PDF or DOCX resume.')
      }

      const resume: Resume = {
        id: createId(),
        userId: user.id,
        fileName: file.name,
        fileType: file.type || (extension === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
        versionLabel: versionLabel.trim() || file.name,
        isMaster: snapshot.resumes.length === 0,
        fileSize: file.size,
        storagePath: null,
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
      const now = new Date().toISOString()
      const master = snapshot.resumes.find((resume) => resume.isMaster) ?? null
      const job: Job = {
        id: createId(),
        userId: user.id,
        title: input.title.trim(),
        company: input.company.trim(),
        location: input.location.trim(),
        jobUrl: input.jobUrl.trim(),
        description: input.description.trim(),
        createdAt: now,
      }

      let match: JobMatch = {
        id: createId(),
        userId: user.id,
        jobId: job.id,
        resumeId: master?.id ?? null,
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
        createdAt: now,
        analyzedAt: null,
      }

      const application: Application = {
        id: createId(),
        userId: user.id,
        jobId: job.id,
        matchId: match.id,
        resumeId: master?.id ?? null,
        status: 'ready',
        dateAdded: now.slice(0, 10),
        dateApplied: null,
        nextAction: nextActionForStatus('ready'),
        notes: '',
        updatedAt: now,
      }

      const client = getJobAnalysisClient()
      const response = await client.analyze({
        job: {
          title: job.title,
          company: job.company,
          location: job.location,
          jobUrl: job.jobUrl,
          description: job.description,
        },
        candidate: {
          profile: snapshot.profile,
          skills: snapshot.skills,
          resume: master
            ? { id: master.id, versionLabel: master.versionLabel, fileName: master.fileName }
            : null,
        },
      })

      if (response.status === 'complete') {
        const result = response.result
        match = {
          ...match,
          overallScore: result.overallScore,
          skillsMatched: result.skillsMatched,
          skillsPartial: result.skillsPartial,
          skillsMissing: result.skillsMissing,
          experienceMatch: result.experienceMatch,
          educationMatch: result.educationMatch,
          locationMatch: result.locationMatch,
          workAuthorizationNotes: result.workAuthorization,
          strengths: result.strengths,
          concerns: result.concerns,
          recommendation: result.recommendation,
          analysisStatus: 'complete',
          analysisSource: 'api',
          provider: result.provider ?? 'external-api',
          analyzedAt: new Date().toISOString(),
        }
      } else if (response.status === 'queued') {
        match = { ...match, analysisStatus: 'queued', errorMessage: response.message }
      } else if (response.status === 'unavailable') {
        match = { ...match, analysisStatus: 'unavailable', errorMessage: response.message }
      } else {
        match = { ...match, analysisStatus: 'failed', errorMessage: response.message }
      }

      if (!isDemo && supabase) {
        const jobInsert = await supabase.from('jobs').insert(jobToRow(job))
        if (jobInsert.error) throw jobInsert.error
        const matchInsert = await supabase.from('job_matches').insert(matchToRow(match))
        if (matchInsert.error) throw matchInsert.error
        const appInsert = await supabase.from('applications').insert(applicationToRow(application))
        if (appInsert.error) throw appInsert.error
      }

      replace((current) => ({
        ...current,
        jobs: [job, ...current.jobs],
        matches: [match, ...current.matches],
        applications: [application, ...current.applications],
      }))

      return match.id
    },
    [isDemo, replace, snapshot.profile, snapshot.resumes, snapshot.skills, user],
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
      error,
      masterResume,
      saveProfile,
      uploadResume,
      setMasterResume,
      analyzeJob,
      updateApplication,
      savePreferences,
    }),
    [
      analyzeJob,
      error,
      loading,
      masterResume,
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
