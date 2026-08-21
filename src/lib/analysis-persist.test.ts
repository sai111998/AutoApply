import { describe, expect, it } from 'vitest'
import { isUuid, upsertById } from './analysis-persist'

describe('analysis persistence helpers', () => {
  it('accepts version-4 UUIDs and rejects other strings', () => {
    expect(isUuid('3b9f0c2a-7d11-4c3a-9f12-8a1b2c3d4e5f')).toBe(true)
    expect(isUuid('not-a-uuid')).toBe(false)
    expect(isUuid('')).toBe(false)
  })

  it('replaces an existing analysis by id instead of duplicating it', () => {
    const first = { id: 'a', title: 'One' }
    const updated = { id: 'a', title: 'Updated' }
    const second = { id: 'b', title: 'Two' }
    expect(upsertById([first], updated)).toEqual([updated])
    expect(upsertById([first], second)).toEqual([second, first])
  })
})
