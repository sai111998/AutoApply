export type WorkArrangement = 'remote' | 'hybrid' | 'onsite' | 'flexible'

export type WorkAuthorization =
  | 'us_citizen'
  | 'us_permanent_resident'
  | 'work_visa'
  | 'needs_sponsorship'
  | 'other'

export type SkillProficiency = 'beginner' | 'intermediate' | 'advanced' | 'expert'

export type ApplicationStatus =
  | 'ready'
  | 'applied'
  | 'interview'
  | 'offer'
  | 'rejected'
  | 'withdrawn'

export type Recommendation = 'APPLY' | 'REVIEW' | 'SKIP'
export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW'

export type AnalysisStatus = 'pending' | 'queued' | 'complete' | 'failed' | 'unavailable'

export type AnalysisSource = 'sample' | 'api'

export interface Profile {
  id: string
  fullName: string
  email: string
  location: string
  targetJobTitles: string[]
  yearsOfExperience: number
  workAuthorization: WorkAuthorization
  sponsorshipRequired: boolean
  preferredWorkArrangement: WorkArrangement
  targetSalaryMin: number
  targetSalaryMax: number
  updatedAt: string
}

export interface Skill {
  id: string
  userId: string
  name: string
  proficiency: SkillProficiency
  yearsExperience: number
}

export interface Resume {
  id: string
  userId: string
  fileName: string
  fileType: string
  versionLabel: string
  isMaster: boolean
  fileSize: number
  storagePath: string | null
  parsedText: string
  createdAt: string
}

export interface Job {
  id: string
  userId: string
  title: string
  company: string
  location: string
  jobUrl: string
  description: string
  createdAt: string
}

export interface SkillSignal {
  name: string
  note?: string
  source?: 'required' | 'preferred'
  evidence?: string
}

export interface DimensionMatch {
  score: number | null
  matched?: boolean | null
  summary: string
}

export interface JobMatch {
  id: string
  userId: string
  jobId: string
  resumeId: string | null
  overallScore: number | null
  skillsMatched: SkillSignal[]
  skillsPartial: SkillSignal[]
  skillsMissing: SkillSignal[]
  experienceMatch: DimensionMatch | null
  educationMatch: DimensionMatch | null
  locationMatch: DimensionMatch | null
  workAuthorizationNotes: string | null
  strengths: string[]
  concerns: string[]
  recommendation: Recommendation | null
  analysisStatus: AnalysisStatus
  analysisSource: AnalysisSource
  provider: string | null
  errorMessage: string | null
  summary: string | null
  createdAt: string
  analyzedAt: string | null
  confidence?: Confidence | null
  report?: import('@/lib/ai/types').MatchReport | null
}

export interface Application {
  id: string
  userId: string
  jobId: string
  matchId: string | null
  resumeId: string | null
  status: ApplicationStatus
  dateAdded: string
  dateApplied: string | null
  nextAction: string
  notes: string
  updatedAt: string
}

export interface UserPreferences {
  userId: string
  aiModelPreference: string
  includeCoverLetter: boolean
  minMatchScore: number
  targetRoles: string[]
  targetLocations: string[]
  preferredWorkArrangements: WorkArrangement[]
  notifyOnStrongMatch: boolean
  updatedAt: string
}

export type TailorChangeKind = 'emphasis' | 'rewritten' | 'reordered' | 'omitted'

export interface TailorChange {
  kind: TailorChangeKind
  label: string
  before?: string
  after?: string
}

export interface TailoredExperience {
  company: string
  title: string
  dates: string
  bullets: string[]
}

export interface TailoredProject {
  name: string
  bullets: string[]
}

export interface TailoredEducation {
  degree: string
  field: string
  details: string
}

export interface TailoredResumeContent {
  summary: string
  skills: string[]
  experience: TailoredExperience[]
  projects: TailoredProject[]
  education: TailoredEducation[]
  certifications: string[]
  changes: TailorChange[]
  omissions: string[]
  warnings: string[]
  contact: { name: string; email: string; location: string }
}

export interface TailoringPlan {
  skillsToEmphasize: string[]
  relatedSkills: string[]
  missingSkills: string[]
  experienceToEmphasize: string[]
}

export interface ResumeVersion {
  id: string
  userId: string
  sourceResumeId: string
  jobId: string | null
  analysisId: string | null
  versionName: string
  resumeContent: TailoredResumeContent
  tailoringSummary: TailoringPlan
  changes: TailorChange[]
  warnings: string[]
  createdAt: string
  updatedAt: string
}

export interface WorkspaceSnapshot {
  profile: Profile
  skills: Skill[]
  resumes: Resume[]
  jobs: Job[]
  matches: JobMatch[]
  applications: Application[]
  preferences: UserPreferences
  resumeVersions: ResumeVersion[]
}

export const WORK_AUTHORIZATION_LABELS: Record<WorkAuthorization, string> = {
  us_citizen: 'U.S. citizen',
  us_permanent_resident: 'U.S. permanent resident',
  work_visa: 'Has work visa',
  needs_sponsorship: 'Requires sponsorship',
  other: 'Other',
}

export const WORK_ARRANGEMENT_LABELS: Record<WorkArrangement, string> = {
  remote: 'Remote',
  hybrid: 'Hybrid',
  onsite: 'On-site',
  flexible: 'Flexible',
}

export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  ready: 'Ready',
  applied: 'Applied',
  interview: 'Interview',
  offer: 'Offer',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
}

export const PROFICIENCY_LABELS: Record<SkillProficiency, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
  expert: 'Expert',
}
