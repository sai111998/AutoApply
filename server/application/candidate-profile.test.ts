import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseAutoApplyStart } from '../apply/parse'
import { mapSyntheticApplicationFields, candidateFromStoredProfile } from '../agent/eligibility'
import { resetAgentForTests } from '../agent'
import { getServerConfig } from '../config'
import {
  FAKE_ANON_KEY,
  FAKE_SUPABASE_URL,
  fakeSessionToken,
  installFakeSupabase,
  uninstallFakeSupabase,
} from '../testing/fake-supabase'
import { applicationQuestionMapper } from './mapper'
import { buildCandidateApplicationProfile } from './profile'
import {
  fetchSupabaseProfileRow,
  getApplicationProfileAvailability,
  getCandidateApplicationProfile,
  hydrateCandidateStoreFromSupabase,
  isApplicationProfileComplete,
  normalizeStoredCandidate,
  splitCandidateName,
} from './candidate-profile'
import { getCandidateProfile, resetCandidateStoreForTests, saveCandidateProfile } from './candidate-store'
import type { AutoApplyProfile } from '../apply/types'

const USER_ID = '11111111-1111-4111-8111-111111111111'

const access = (accessToken?: string) => ({ config: getServerConfig(), accessToken: accessToken ?? null })

const canonicalFixture: AutoApplyProfile = {
  fullName: 'Alex Rivera',
  email: 'alex.rivera@example.com',
  location: 'Austin, TX',
  yearsOfExperience: 6,
  workAuthorization: 'us_citizen',
  sponsorshipRequired: false,
  preferredWorkArrangement: 'hybrid',
  targetSalaryMin: null,
  targetSalaryMax: null,
  phone: '5125550100',
  linkedin: 'https://linkedin.com/in/alexrivera',
  address: '123 Main St',
  city: 'Austin',
  state: 'TX',
  zip: '78701',
  country: 'United States',
}

function profilesRow(overrides: Record<string, unknown> = {}) {
  return {
    id: USER_ID,
    full_name: 'Alex Rivera',
    first_name: 'Alex',
    last_name: 'Rivera',
    email: 'alex.rivera@example.com',
    phone: '5125550100',
    location: 'Austin, TX',
    work_authorization: 'us_citizen',
    sponsorship_required: false,
    ...overrides,
  }
}

beforeEach(() => {
  resetAgentForTests()
  resetCandidateStoreForTests()
})

afterEach(() => {
  uninstallFakeSupabase()
  resetAgentForTests()
  resetCandidateStoreForTests()
})

describe('canonical application profile (public.profiles)', () => {
  it('reads first_name, last_name, email, and phone for profiles.id = auth user id', async () => {
    installFakeSupabase({ profiles: [profilesRow()] })
    const profile = await getCandidateApplicationProfile(USER_ID, access())
    expect(profile).toMatchObject({
      userId: USER_ID,
      firstName: 'Alex',
      lastName: 'Rivera',
      email: 'alex.rivera@example.com',
      phone: '5125550100',
      workAuthorization: 'us_citizen',
      sponsorship: false,
    })
    expect(isApplicationProfileComplete(profile)).toEqual({ complete: true, missingFields: [] })
  })

  it('prefers the first_name and last_name columns over full_name', async () => {
    installFakeSupabase({ profiles: [profilesRow({ full_name: 'Alexander Rivera-Lopez', first_name: 'Alex', last_name: 'Rivera' })] })
    const profile = await getCandidateApplicationProfile(USER_ID, access())
    expect(profile).toMatchObject({ firstName: 'Alex', lastName: 'Rivera' })
  })

  it('derives first and last name from a two-word full_name when the columns are empty', async () => {
    installFakeSupabase({ profiles: [profilesRow({ first_name: null, last_name: '', full_name: 'Alex Rivera' })] })
    const profile = await getCandidateApplicationProfile(USER_ID, access())
    expect(profile).toMatchObject({ firstName: 'Alex', lastName: 'Rivera' })
  })

  it('leaves last name missing for a one-word full_name and never invents one', async () => {
    installFakeSupabase({ profiles: [profilesRow({ first_name: null, last_name: null, full_name: 'Alex' })] })
    const profile = await getCandidateApplicationProfile(USER_ID, access())
    expect(profile).toMatchObject({ firstName: 'Alex', lastName: '' })
    expect(isApplicationProfileComplete(profile)).toEqual({ complete: false, missingFields: ['lastName'] })
  })

  it('takes phone only from the phone column', async () => {
    installFakeSupabase({
      profiles: [profilesRow({ phone: null })],
      resumes: [{ id: 'resume-1', user_id: USER_ID, parsed_text: 'Alex Rivera · 512-555-0100 · alex@example.com' }],
    })
    const profile = await getCandidateApplicationProfile(USER_ID, access())
    expect(profile?.phone).toBe('')
    expect(isApplicationProfileComplete(profile)).toEqual({ complete: false, missingFields: ['phone'] })
  })

  it('reads rows from databases that predate the application profile columns', async () => {
    const legacyRow = Object.fromEntries(
      Object.entries(profilesRow()).filter(([key]) => !['first_name', 'last_name', 'phone'].includes(key)),
    )
    installFakeSupabase({ profiles: [legacyRow] })
    const profile = await getCandidateApplicationProfile(USER_ID, access())
    expect(profile).toMatchObject({ firstName: 'Alex', lastName: 'Rivera', email: 'alex.rivera@example.com', phone: '' })
  })

  it('distinguishes a missing row, a non-UUID id, a missing server config, and a failed query', async () => {
    installFakeSupabase({ profiles: [profilesRow()] })
    await expect(getCandidateApplicationProfile('22222222-2222-4222-8222-222222222222', access())).rejects.toMatchObject({
      code: 'PROFILE_NOT_FOUND',
    })
    await expect(getCandidateApplicationProfile('not-a-uuid', access())).rejects.toMatchObject({ code: 'PROFILE_AUTH_REQUIRED' })
    await expect(
      fetchSupabaseProfileRow(USER_ID, { config: { ...getServerConfig(), supabaseUrl: '' } }),
    ).rejects.toMatchObject({ code: 'PROFILE_DATABASE_ERROR' })
    uninstallFakeSupabase()
    installFakeSupabase({ profiles: [profilesRow()], failures: { profiles: 500 } })
    await expect(getCandidateApplicationProfile(USER_ID, access())).rejects.toMatchObject({
      code: 'PROFILE_DATABASE_ERROR',
      message: expect.stringContaining('XX000'),
    })
  })

  it('reads the profile as the signed-in user when the server has no service-role key', async () => {
    const { reads } = installFakeSupabase({ profiles: [profilesRow()] }, { serviceRoleKey: null })
    const token = fakeSessionToken(USER_ID)
    await expect(getCandidateApplicationProfile(USER_ID, access())).rejects.toMatchObject({ code: 'PROFILE_DATABASE_ERROR' })
    const profile = await getCandidateApplicationProfile(USER_ID, access(token))
    expect(profile).toMatchObject({ firstName: 'Alex', lastName: 'Rivera', phone: '5125550100' })
    expect(reads.at(-1)).toMatchObject({ path: '/rest/v1/profiles', authorization: `Bearer ${token}`, apikey: FAKE_ANON_KEY })
  })

  it('reports availability booleans without values', async () => {
    installFakeSupabase({ profiles: [profilesRow({ last_name: null, full_name: 'Alex', phone: null })] })
    const profile = await getCandidateApplicationProfile(USER_ID, access())
    expect(getApplicationProfileAvailability(profile)).toMatchObject({
      firstName: true,
      lastName: false,
      email: true,
      phone: false,
    })
    expect(isApplicationProfileComplete(null)).toEqual({
      complete: false,
      missingFields: ['firstName', 'lastName', 'email', 'phone'],
    })
  })

  it('selects every column so a missing phone column cannot hide the name', async () => {
    installFakeSupabase({ profiles: [profilesRow()] })
    await getCandidateApplicationProfile(USER_ID, access())
    const calls = (globalThis.fetch as unknown as { mock: { calls: Array<[RequestInfo | URL]> } }).mock.calls
    const urls = calls.map(([input]) => (input instanceof Request ? input.url : String(input)))
    expect(urls.some((url) => url.startsWith(`${FAKE_SUPABASE_URL}/rest/v1/profiles`) && url.includes('select=*'))).toBe(true)
  })

  it('hydrates the legacy runtime store from the profiles row', async () => {
    saveCandidateProfile({
      userId: USER_ID,
      profile: { ...canonicalFixture, fullName: 'Alex', phone: null },
      resumeText: 'resume',
      resumeVersionId: 'resume-1',
    })
    installFakeSupabase({ profiles: [profilesRow()] })
    expect(await hydrateCandidateStoreFromSupabase(USER_ID, access())).toBe(true)
    expect(getCandidateProfile(USER_ID)).toMatchObject({
      profile: { fullName: 'Alex Rivera', phone: '5125550100' },
      resumeText: 'resume',
      resumeVersionId: 'resume-1',
    })
  })
})

describe('profile normalization', () => {
  it('maps lastName, phone, email, and firstName without inventing values', () => {
    const full = normalizeStoredCandidate(canonicalFixture as unknown as Record<string, unknown>)
    expect(full.firstName).toBe('Alex')
    expect(full.lastName).toBe('Rivera')
    expect(full.email).toBe('alex.rivera@example.com')
    expect(full.phone).toBe('5125550100')
    expect(full.city).toBe('Austin')
    expect(full.zip).toBe('78701')

    const singleToken = normalizeStoredCandidate({ fullName: 'Madonna', email: 'm@example.com' })
    expect(singleToken.firstName).toBe('Madonna')
    expect(singleToken.lastName).toBe('')
    expect(singleToken.phone).toBe('')
    expect(singleToken.email).toBe('m@example.com')

    const empty = normalizeStoredCandidate(null)
    expect(empty.firstName).toBe('')
    expect(empty.lastName).toBe('')
    expect(empty.email).toBe('')
    expect(empty.phone).toBe('')
  })

  it('normalizes snake_case database naming into the canonical representation', () => {
    const normalized = normalizeStoredCandidate({
      full_name: 'Alex Rivera',
      first_name: 'Alex',
      last_name: 'Rivera',
      phone_number: '5125550100',
      zip_code: '78701',
      work_authorization: 'us_citizen',
      sponsorship_required: true,
    })
    expect(normalized.firstName).toBe('Alex')
    expect(normalized.lastName).toBe('Rivera')
    expect(normalized.phone).toBe('5125550100')
    expect(normalized.zip).toBe('78701')
    expect(normalized.workAuthorization).toBe('us_citizen')
    expect(normalized.sponsorship).toBe(true)
    expect(splitCandidateName('  Alex   Rivera  ')).toEqual({ firstName: 'Alex', lastName: 'Rivera' })
  })

  it('composes fullName from first and last name when full_name is empty', () => {
    expect(normalizeStoredCandidate({ first_name: 'Alex', last_name: 'Rivera' }).fullName).toBe('Alex Rivera')
  })

  it('preserves extended contact fields through the Auto Apply start parser', () => {
    const parsed = parseAutoApplyStart({
      userId: 'user-1',
      resumeText: 'resume',
      profile: { ...canonicalFixture },
      config: { maxJobs: 1 },
    })
    expect(parsed.profile.phone).toBe('5125550100')
    expect(parsed.profile.city).toBe('Austin')
    expect(parsed.profile.linkedin).toBe('https://linkedin.com/in/alexrivera')
  })

  it('maps Last Name, Phone, First Name, and Email application questions to the candidate', () => {
    const candidate = buildCandidateApplicationProfile({ userId: 'user-1', profile: canonicalFixture, resumeText: 'resume' })
    expect(applicationQuestionMapper('What is your last name?', candidate).answer).toBe('Rivera')
    expect(applicationQuestionMapper('What is your first name?', candidate).answer).toBe('Alex')
    expect(applicationQuestionMapper('What is your email address?', candidate).answer).toBe('alex.rivera@example.com')
    expect(applicationQuestionMapper('What is your phone number?', candidate).answer).toBe('5125550100')
    expect(applicationQuestionMapper('What is your favorite color?', candidate).answer).toBeNull()
  })

  it('fills every legacy synthetic employer field when the profile is complete', () => {
    const built = candidateFromStoredProfile({
      userId: 'user-1',
      profile: canonicalFixture,
      resumeText: 'resume',
      resumeVersionId: 'resume-1',
    })
    const mapped = mapSyntheticApplicationFields(built)
    expect(mapped.missing).toEqual([])
    expect(Object.fromEntries(mapped.mapped.map((field) => [field.id, field.value]))).toMatchObject({
      first_name: 'Alex',
      last_name: 'Rivera',
      email: 'alex.rivera@example.com',
      phone: '5125550100',
    })
  })

  it('reports exactly which required legacy synthetic fields are missing', () => {
    const built = candidateFromStoredProfile({
      userId: 'user-1',
      profile: { ...canonicalFixture, fullName: 'Madonna', phone: null },
      resumeText: 'resume',
      resumeVersionId: 'resume-1',
    })
    const mapped = mapSyntheticApplicationFields(built)
    expect(mapped.missing).toContain('last_name')
    expect(mapped.missing).toContain('phone')
    expect(mapped.missing).not.toContain('first_name')
    expect(mapped.missing).not.toContain('email')
  })
})
