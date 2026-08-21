import type {
  Application,
  Job,
  JobMatch,
  Profile,
  Resume,
  Skill,
  UserPreferences,
  WorkspaceSnapshot,
} from '@/types/domain'

type ProfileRow = {
  id: string
  full_name: string | null
  email: string | null
  location: string | null
  target_job_titles: string[] | null
  years_of_experience: number | null
  work_authorization: Profile['workAuthorization'] | null
  sponsorship_required: boolean | null
  preferred_work_arrangement: Profile['preferredWorkArrangement'] | null
  target_salary_min: number | null
  target_salary_max: number | null
  updated_at: string
}

type SkillRow = {
  id: string
  user_id: string
  name: string
  proficiency: Skill['proficiency']
  years_experience: number | null
}

type ResumeRow = {
  id: string
  user_id: string
  file_name: string
  file_type: string | null
  version_label: string
  is_master: boolean
  file_size: number | null
  storage_path: string | null
  parsed_text: string | null
  created_at: string
}

type JobRow = {
  id: string
  user_id: string
  title: string
  company: string
  location: string | null
  job_url: string | null
  description: string
  created_at: string
}

type MatchRow = {
  id: string
  user_id: string
  job_id: string
  resume_id: string | null
  overall_score: number | null
  skills_matched: JobMatch['skillsMatched']
  skills_partial: JobMatch['skillsPartial']
  skills_missing: JobMatch['skillsMissing']
  experience_match: JobMatch['experienceMatch']
  education_match: JobMatch['educationMatch']
  location_match: JobMatch['locationMatch']
  work_authorization_notes: string | null
  strengths: string[] | null
  concerns: string[] | null
  recommendation: JobMatch['recommendation']
  analysis_status: JobMatch['analysisStatus']
  analysis_source: JobMatch['analysisSource']
  provider: string | null
  error_message: string | null
  created_at: string
  analyzed_at: string | null
  summary: string | null
}

type ApplicationRow = {
  id: string
  user_id: string
  job_id: string
  match_id: string | null
  resume_id: string | null
  status: Application['status']
  date_added: string
  date_applied: string | null
  next_action: string | null
  notes: string | null
  updated_at: string
}

type PreferencesRow = {
  user_id: string
  ai_model_preference: string | null
  include_cover_letter: boolean | null
  min_match_score: number | null
  target_roles: string[] | null
  target_locations: string[] | null
  preferred_work_arrangements: UserPreferences['preferredWorkArrangements'] | null
  notify_on_strong_match: boolean | null
  updated_at: string
}

export function mapProfile(row: ProfileRow, fallbackEmail: string): Profile {
  return {
    id: row.id,
    fullName: row.full_name ?? '',
    email: row.email ?? fallbackEmail,
    location: row.location ?? '',
    targetJobTitles: row.target_job_titles ?? [],
    yearsOfExperience: row.years_of_experience ?? 0,
    workAuthorization: row.work_authorization ?? 'other',
    sponsorshipRequired: row.sponsorship_required ?? false,
    preferredWorkArrangement: row.preferred_work_arrangement ?? 'flexible',
    targetSalaryMin: row.target_salary_min ?? 0,
    targetSalaryMax: row.target_salary_max ?? 0,
    updatedAt: row.updated_at,
  }
}

export function profileToRow(profile: Profile) {
  return {
    id: profile.id,
    full_name: profile.fullName,
    email: profile.email,
    location: profile.location,
    target_job_titles: profile.targetJobTitles,
    years_of_experience: profile.yearsOfExperience,
    work_authorization: profile.workAuthorization,
    sponsorship_required: profile.sponsorshipRequired,
    preferred_work_arrangement: profile.preferredWorkArrangement,
    target_salary_min: profile.targetSalaryMin,
    target_salary_max: profile.targetSalaryMax,
    updated_at: profile.updatedAt,
  }
}

export function mapSkill(row: SkillRow): Skill {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    proficiency: row.proficiency,
    yearsExperience: row.years_experience ?? 0,
  }
}

export function skillToRow(skill: Skill) {
  return {
    id: skill.id,
    user_id: skill.userId,
    name: skill.name,
    proficiency: skill.proficiency,
    years_experience: skill.yearsExperience,
  }
}

export function mapResume(row: ResumeRow): Resume {
  return {
    id: row.id,
    userId: row.user_id,
    fileName: row.file_name,
    fileType: row.file_type ?? '',
    versionLabel: row.version_label,
    isMaster: row.is_master,
    fileSize: row.file_size ?? 0,
    storagePath: row.storage_path,
    parsedText: row.parsed_text ?? '',
    createdAt: row.created_at,
  }
}

export function resumeToRow(resume: Resume) {
  return {
    id: resume.id,
    user_id: resume.userId,
    file_name: resume.fileName,
    file_type: resume.fileType,
    version_label: resume.versionLabel,
    is_master: resume.isMaster,
    file_size: resume.fileSize,
    storage_path: resume.storagePath,
    parsed_text: resume.parsedText,
    created_at: resume.createdAt,
  }
}

export function mapJob(row: JobRow): Job {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    company: row.company,
    location: row.location ?? '',
    jobUrl: row.job_url ?? '',
    description: row.description,
    createdAt: row.created_at,
  }
}

export function jobToRow(job: Job) {
  return {
    id: job.id,
    user_id: job.userId,
    title: job.title,
    company: job.company,
    location: job.location,
    job_url: job.jobUrl,
    description: job.description,
    created_at: job.createdAt,
  }
}

export function mapMatch(row: MatchRow): JobMatch {
  return {
    id: row.id,
    userId: row.user_id,
    jobId: row.job_id,
    resumeId: row.resume_id,
    overallScore: row.overall_score,
    skillsMatched: row.skills_matched ?? [],
    skillsPartial: row.skills_partial ?? [],
    skillsMissing: row.skills_missing ?? [],
    experienceMatch: row.experience_match,
    educationMatch: row.education_match,
    locationMatch: row.location_match,
    workAuthorizationNotes: row.work_authorization_notes,
    strengths: row.strengths ?? [],
    concerns: row.concerns ?? [],
    recommendation: row.recommendation,
    analysisStatus: row.analysis_status,
    analysisSource: row.analysis_source,
    provider: row.provider,
    errorMessage: row.error_message,
    summary: row.summary ?? null,
    createdAt: row.created_at,
    analyzedAt: row.analyzed_at,
  }
}

export function matchToRow(match: JobMatch) {
  return {
    id: match.id,
    user_id: match.userId,
    job_id: match.jobId,
    resume_id: match.resumeId,
    overall_score: match.overallScore,
    skills_matched: match.skillsMatched,
    skills_partial: match.skillsPartial,
    skills_missing: match.skillsMissing,
    experience_match: match.experienceMatch,
    education_match: match.educationMatch,
    location_match: match.locationMatch,
    work_authorization_notes: match.workAuthorizationNotes,
    strengths: match.strengths,
    concerns: match.concerns,
    recommendation: match.recommendation,
    analysis_status: match.analysisStatus,
    analysis_source: match.analysisSource,
    provider: match.provider,
    error_message: match.errorMessage,
    created_at: match.createdAt,
    analyzed_at: match.analyzedAt,
    summary: match.summary,
  }
}

export function mapApplication(row: ApplicationRow): Application {
  return {
    id: row.id,
    userId: row.user_id,
    jobId: row.job_id,
    matchId: row.match_id,
    resumeId: row.resume_id,
    status: row.status,
    dateAdded: row.date_added,
    dateApplied: row.date_applied,
    nextAction: row.next_action ?? '',
    notes: row.notes ?? '',
    updatedAt: row.updated_at,
  }
}

export function applicationToRow(application: Application) {
  return {
    id: application.id,
    user_id: application.userId,
    job_id: application.jobId,
    match_id: application.matchId,
    resume_id: application.resumeId,
    status: application.status,
    date_added: application.dateAdded,
    date_applied: application.dateApplied,
    next_action: application.nextAction,
    notes: application.notes,
    updated_at: application.updatedAt,
  }
}

export function mapPreferences(row: PreferencesRow): UserPreferences {
  return {
    userId: row.user_id,
    aiModelPreference: row.ai_model_preference ?? 'Use the server default',
    includeCoverLetter: row.include_cover_letter ?? true,
    minMatchScore: row.min_match_score ?? 70,
    targetRoles: row.target_roles ?? [],
    targetLocations: row.target_locations ?? [],
    preferredWorkArrangements: row.preferred_work_arrangements ?? ['hybrid'],
    notifyOnStrongMatch: row.notify_on_strong_match ?? true,
    updatedAt: row.updated_at,
  }
}

export function preferencesToRow(preferences: UserPreferences) {
  return {
    user_id: preferences.userId,
    ai_model_preference: preferences.aiModelPreference,
    include_cover_letter: preferences.includeCoverLetter,
    min_match_score: preferences.minMatchScore,
    target_roles: preferences.targetRoles,
    target_locations: preferences.targetLocations,
    preferred_work_arrangements: preferences.preferredWorkArrangements,
    notify_on_strong_match: preferences.notifyOnStrongMatch,
    updated_at: preferences.updatedAt,
  }
}

export function emptyWorkspace(userId: string, email: string, fullName = ''): WorkspaceSnapshot {
  const now = new Date().toISOString()
  return {
    profile: {
      id: userId,
      fullName,
      email,
      location: '',
      targetJobTitles: [],
      yearsOfExperience: 0,
      workAuthorization: 'other',
      sponsorshipRequired: false,
      preferredWorkArrangement: 'flexible',
      targetSalaryMin: 0,
      targetSalaryMax: 0,
      updatedAt: now,
    },
    skills: [],
    resumes: [],
    jobs: [],
    matches: [],
    applications: [],
    preferences: {
      userId,
      aiModelPreference: 'Use the server default',
      includeCoverLetter: true,
      minMatchScore: 70,
      targetRoles: [],
      targetLocations: [],
      preferredWorkArrangements: ['hybrid', 'remote'],
      notifyOnStrongMatch: true,
      updatedAt: now,
    },
  }
}
