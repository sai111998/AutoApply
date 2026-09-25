import { describe, expect, it, vi } from 'vitest'
import { persistProfileRow } from './profile-save'
import type { Profile } from '@/types/domain'

const profile: Profile = {
  id: '11111111-1111-4111-8111-111111111111',
  fullName: 'Jordan Hale',
  email: 'jordan.hale@example.com',
  phone: '5125550100',
  location: 'Austin, TX',
  targetJobTitles: [],
  yearsOfExperience: 6,
  workAuthorization: 'us_citizen',
  sponsorshipRequired: false,
  preferredWorkArrangement: 'hybrid',
  targetSalaryMin: 0,
  targetSalaryMax: 0,
  updatedAt: '2026-09-25T00:00:00.000Z',
}

function clientReturning(...errors: Array<{ code?: string; message: string } | null>) {
  const rows: Record<string, unknown>[] = []
  const upsert = vi.fn(async (row: Record<string, unknown>) => {
    rows.push(row)
    return { error: errors.shift() ?? null }
  })
  return { client: { from: () => ({ upsert }) }, rows }
}

describe('persistProfileRow', () => {
  it('stores phone on the profiles row', async () => {
    const { client, rows } = clientReturning(null)
    const result = await persistProfileRow(client as never, profile)
    expect(result).toEqual({ error: null, phoneStored: true })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ full_name: 'Jordan Hale', phone: '5125550100' })
  })

  it('still saves the name when the database has no phone column', async () => {
    const { client, rows } = clientReturning({
      code: 'PGRST204',
      message: "Could not find the 'phone' column of 'profiles' in the schema cache",
    })
    const result = await persistProfileRow(client as never, profile)
    expect(result).toEqual({ error: null, phoneStored: false })
    expect(rows).toHaveLength(2)
    expect(rows[1]).toMatchObject({ full_name: 'Jordan Hale', email: 'jordan.hale@example.com' })
    expect(rows[1]).not.toHaveProperty('phone')
  })

  it('returns other errors without retrying', async () => {
    const { client, rows } = clientReturning({ code: '42501', message: 'new row violates row-level security policy' })
    const result = await persistProfileRow(client as never, profile)
    expect(result.error).toMatchObject({ code: '42501' })
    expect(result.phoneStored).toBe(false)
    expect(rows).toHaveLength(1)
  })
})
