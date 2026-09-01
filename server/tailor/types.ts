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

export interface TailoredContact {
  name: string
  email: string
  location: string
}

export interface TailoredResume {
  summary: string
  skills: string[]
  experience: TailoredExperience[]
  projects: TailoredProject[]
  education: TailoredEducation[]
  certifications: string[]
  changes: TailorChange[]
  omissions: string[]
  warnings: string[]
  contact: TailoredContact
}

export interface JdCoverage {
  requiredSupported: number
  requiredTotal: number
  preferredSupported: number
  preferredTotal: number
  overallSupported: number
  overallTotal: number
}

export interface TailoringPlan {
  skillsToEmphasize: string[]
  relatedSkills: string[]
  missingSkills: string[]
  experienceToEmphasize: string[]
  coverage?: JdCoverage
  roleType?: string
  targetRole?: string
}

export interface SourceRole {
  company: string
  title: string
  dates: string
  bullets: string[]
}

export interface SourceFacts {
  text: string
  skills: string[]
  employers: string[]
  titles: string[]
  certifications: string[]
  projects: string[]
  education: TailoredEducation[]
  roles: SourceRole[]
  dates: string[]
  numbers: string[]
}

export interface ValidationResult {
  ok: boolean
  errors: string[]
  qualityScore?: number
  coverageScore?: number
  factualValidation?: boolean
  warnings?: string[]
}

export interface TailorMatchSignals {
  matched?: string[]
  partial?: string[]
  missing?: string[]
  strengths?: string[]
  experienceThemes?: string[]
}

export interface TailorRequestBody {
  resumeText: string
  jobDescription: string
  userId?: string
  resumeId?: string
  jobId?: string
  matchId?: string
  candidateName?: string
  candidateEmail?: string
  candidateLocation?: string
  resumeProfile?: unknown
  jobProfile?: unknown
  matchReport?: unknown
  matchSignals?: TailorMatchSignals
}

export interface TailorResponseBody {
  status: 'complete' | 'invalid' | 'failed'
  plan: TailoringPlan
  original: TailoredResume
  tailored: TailoredResume | null
  validation: ValidationResult
  message?: string
}
