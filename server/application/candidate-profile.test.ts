import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseAutoApplyStart } from '../apply/parse'
import { mapSyntheticApplicationFields, candidateFromStoredProfile } from '../agent/eligibility'
import { resetAgentForTests } from '../agent'
import { applicationQuestionMapper } from './mapper'
import { buildCandidateApplicationProfile } from './profile'
import {
  fetchSupabaseProfileRow,
  getApplicationProfileAvailability,
  getCandidateApplicationProfile,
  getCandidateApplicationProfileAsync,
  hydrateCandidateStoreFromSupabase,
  isApplicationProfileComplete,
  normalizeStoredCandidate,
  splitCandidateName,
} from './candidate-profile'
import { getCandidateProfile, resetCandidateStoreForTests, saveCandidateProfile } from './candidate-store'
import type { AutoApplyProfile } from '../apply/types'

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

beforeEach(() => {
  resetAgentForTests()
  resetCandidateStoreForTests()
})

afterEach(() => {
  resetAgentForTests()
  resetCandidateStoreForTests()
})

describe('canonical candidate profile service', () => {
  it('retrieves the stored profile for the authenticated user id', () => {
    saveCandidateProfile({ userId: 'user-1', profile: canonicalFixture, resumeText: 'resume', resumeVersionId: 'resume-1' })
    expect(getCandidateProfile('user-1')?.profile.fullName).toBe('Alex Rivera')
    const canonical = getCandidateApplicationProfile('user-1')
    expect(canonical?.userId).toBe('user-1')
    expect(canonical?.firstName).toBe('Alex')
    expect(canonical?.lastName).toBe('Rivera')
    expect(canonical?.email).toBe('alex.rivera@example.com')
    expect(canonical?.phone).toBe('5125550100')
  })

  it('returns null for unknown users, blank ids, and user id mismatches', () => {
    saveCandidateProfile({ userId: 'user-1', profile: canonicalFixture, resumeText: 'resume', resumeVersionId: 'resume-1' })
    expect(getCandidateApplicationProfile('user-2')).toBeNull()
    expect(getCandidateApplicationProfile('')).toBeNull()
    expect(getCandidateApplicationProfile('   ')).toBeNull()
  })

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
      sponsorship_required: false,
    })
    expect(normalized.firstName).toBe('Alex')
    expect(normalized.lastName).toBe('Rivera')
    expect(normalized.phone).toBe('5125550100')
    expect(normalized.zip).toBe('78701')
    expect(normalized.workAuthorization).toBe('us_citizen')
    expect(splitCandidateName('  Alex   Rivera  ')).toEqual({ firstName: 'Alex', lastName: 'Rivera' })
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

  it('fills every synthetic employer field when the canonical profile is complete', () => {
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

  it('reports exactly which required synthetic fields are missing', () => {
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

  it('delivers all four identity fields from the canonical fixture to the application agent', () => {
    saveCandidateProfile({ userId: 'user-1', profile: canonicalFixture, resumeText: 'resume', resumeVersionId: 'resume-1' })
    const canonical = getCandidateApplicationProfile('user-1')
    const availability = {
      firstName: canonical?.firstName ? 'available' : 'missing',
      lastName: canonical?.lastName ? 'available' : 'missing',
      email: canonical?.email ? 'available' : 'missing',
      phone: canonical?.phone ? 'available' : 'missing',
    }
    expect(availability).toEqual({ firstName: 'available', lastName: 'available', email: 'available', phone: 'available' })

    const stored = getCandidateProfile('user-1')
    const agentView = buildCandidateApplicationProfile({
      userId: 'user-1',
      profile: stored!.profile,
      resumeText: stored!.resumeText,
      resumeVersionId: stored!.resumeVersionId,
    })
    expect(agentView.identity.firstName).toBe('Alex')
    expect(agentView.identity.lastName).toBe('Rivera')
    expect(agentView.contact.email).toBe('alex.rivera@example.com')
    expect(agentView.contact.phone).toBe('5125550100')
  })
})

describe('canonical profile Supabase source', () => {
  it('normalizes a public.profiles row including phone and split names', () => {
    const normalized = normalizeStoredCandidate({
      id: '11111111-1111-4111-8111-111111111111',
      full_name: 'Alex Rivera',
      email: 'alex.rivera@example.com',
      phone: '5125550100',
      location: 'Austin, TX',
      work_authorization: 'us_citizen',
      sponsorship_required: false,
    })
    expect(normalized.firstName).toBe('Alex')
    expect(normalized.lastName).toBe('Rivera')
    expect(normalized.email).toBe('alex.rivera@example.com')
    expect(normalized.phone).toBe('5125550100')
    expect(normalized.workAuthorization).toBe('us_citizen')
  })

  it('falls back to the stored profile when Supabase is unavailable', async () => {
    saveCandidateProfile({ userId: 'user-1', profile: canonicalFixture, resumeText: 'resume', resumeVersionId: 'resume-1' })
    expect(await fetchSupabaseProfileRow('user-1', undefined)).toBeNull()
    expect(await fetchSupabaseProfileRow('not-a-uuid', { supabaseUrl: 'https://x', supabaseServiceRoleKey: 'y' } as never)).toBeNull()
    expect(await hydrateCandidateStoreFromSupabase('user-1', undefined)).toBe(false)
    const canonical = await getCandidateApplicationProfileAsync('user-1', undefined)
    expect(canonical?.lastName).toBe('Rivera')
    expect(canonical?.phone).toBe('5125550100')
    expect(await getCandidateApplicationProfileAsync('unknown-user', undefined)).toBeNull()
  })
})

describe('application profile completeness', () => {
  it('requires firstName, lastName, email, and phone', () => {
    saveCandidateProfile({ userId: 'user-1', profile: canonicalFixture, resumeText: 'resume', resumeVersionId: 'resume-1' })
    expect(isApplicationProfileComplete(getCandidateApplicationProfile('user-1'))).toEqual({
      complete: true,
      missingFields: [],
    })
    expect(isApplicationProfileComplete(null)).toEqual({
      complete: false,
      missingFields: ['firstName', 'lastName', 'email', 'phone'],
    })
  })

  it('reports exactly the missing fields without values', () => {
    saveCandidateProfile({
      userId: 'user-1',
      profile: { ...canonicalFixture, fullName: 'Madonna', phone: null },
      resumeText: 'resume',
      resumeVersionId: 'resume-1',
    })
    expect(isApplicationProfileComplete(getCandidateApplicationProfile('user-1'))).toEqual({
      complete: false,
      missingFields: ['lastName', 'phone'],
    })
    expect(getApplicationProfileAvailability(getCandidateApplicationProfile('user-1'))).toEqual({
      firstName: true,
      lastName: false,
      email: true,
      phone: false,
      address: true,
      city: true,
      state: true,
      zip: true,
      country: true,
      linkedin: true,
      github: false,
    })
  })
})
