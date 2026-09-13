export type JobProviderName = 'crucive' | 'jooble' | 'usajobs' | string
export type ProviderConnectionLabel = 'Live Demo' | 'Connected' | 'Not configured' | 'Disabled'

export type RemoteFilter = 'any' | 'remote' | 'onsite' | 'hybrid'
export type EmploymentFilter = 'any' | 'full-time' | 'part-time' | 'contract' | 'temporary' | 'internship'

export interface NormalizedJob {
  id: string
  provider: JobProviderName
  providerJobId: string | null
  title: string
  company: string
  location: string | null
  remote: boolean | null
  workArrangement: string | null
  employmentType: string | null
  description: string | null
  jobUrl: string | null
  postedAt: string | null
  salaryMin: number | null
  salaryMax: number | null
  salaryCurrency: string | null
  source: string
  discoveredAt: string
  lastVerifiedAt: string
  identityKey: string
  rawMetadata: Record<string, unknown>
  liveDemoProvider: boolean
}

export interface ProviderSearchParams {
  keywords: string
  location: string
  remote: RemoteFilter
  employmentType: EmploymentFilter
  datePostedDays: number
  page: number
  pageSize: number
  radiusKm?: number | null
}

export interface ProviderWarning {
  provider: JobProviderName
  code:
    | 'missing_key'
    | 'disabled'
    | 'unauthorized'
    | 'rate_limited'
    | 'timeout'
    | 'unavailable'
    | 'malformed'
    | 'empty'
  message: string
}

export interface ProviderSearchResult {
  provider: JobProviderName
  jobs: NormalizedJob[]
  total: number | null
  page: number
  pageSize: number
  hasMore: boolean
  warning?: ProviderWarning
}

export interface ProviderStatus {
  name: JobProviderName
  label: string
  enabled: boolean
  available: boolean
  connectionLabel: ProviderConnectionLabel
}

export interface DiscoverRequest {
  roles: string[]
  location: string
  remote: RemoteFilter
  employmentType: EmploymentFilter
  experienceLevel: string
  keywords: string[]
  datePostedDays: number
  page: number
  pageSize: number
  minMatchScore: number | null
  providers: JobProviderName[]
  resumeText?: string
  userId?: string
  persist?: boolean
}

export interface DiscoveredJob extends NormalizedJob {
  matchScore: number | null
  matchedSkills: string[]
  demo: boolean
}

export interface DiscoverResponse {
  jobs: DiscoveredJob[]
  page: number
  pageSize: number
  total: number
  providers: ProviderStatus[]
  warnings: ProviderWarning[]
  hasMore: boolean
  demo: boolean
}

export function defaultConnectionLabel(
  enabled: boolean,
  available: boolean,
  usingDemoKey = false,
): ProviderConnectionLabel {
  if (!enabled) return 'Disabled'
  if (!available) return 'Not configured'
  if (usingDemoKey) return 'Live Demo'
  return 'Connected'
}

export interface JobProvider {
  providerName(): JobProviderName
  label(): string
  isEnabled(): boolean
  isAvailable(): boolean
  usesDemoKey?(): boolean
  connectionLabel(): ProviderConnectionLabel
  search(params: ProviderSearchParams): Promise<ProviderSearchResult>
  getJob?(jobId: string): Promise<NormalizedJob | null>
}
