import { describe, expect, it } from 'vitest'
import { compactVersionName, nextEditedVersionName, nextTailoredVersionName, shortRoleLabel } from './resume-names'

describe('resume version naming', () => {
  it('keeps the master name short', () => {
    expect(compactVersionName('Master Resume')).toBe('Master')
    expect(compactVersionName('Master')).toBe('Master')
  })

  it('builds a concise tailored name from a long job title', () => {
    expect(shortRoleLabel('Senior Java Software Engineer')).toBe('Java Engineer')
    expect(nextTailoredVersionName([], 'Senior Java Software Engineer')).toBe('Tailored — Java Engineer')
    expect(nextTailoredVersionName([], 'AI Engineer')).toBe('Tailored — AI Engineer')
  })

  it('does not keep company names or generated-version phrases in the version title', () => {
    expect(
      compactVersionName(
        'Tailored Resume — Senior Java Software Engineer — Company Name — Generated Version',
        'Senior Java Software Engineer',
      ),
    ).toBe('Tailored — Java Engineer')
    expect(compactVersionName('Tailored — Java Engineer').length).toBeLessThan(28)
    expect(
      compactVersionName(
        'Edited Tailored Resume — Senior Java Software Engineer — Company Name — Generated Version',
        'Senior Java Software Engineer',
      ),
    ).toBe('Edited — Java Engineer')
  })

  it('increments tailored and edited names without repeating Tailored in edited copies', () => {
    const existing = [{ createdBy: 'ai', status: 'completed' }]
    expect(nextTailoredVersionName(existing, 'Senior Java Software Engineer')).toBe('Tailored v2 — Java Engineer')
    expect(nextEditedVersionName([], 'Senior Java Software Engineer')).toBe('Edited — Java Engineer')
    expect(nextEditedVersionName([{ createdBy: 'user', status: 'edited' }], 'AI Engineer')).toBe('Edited v2 — AI Engineer')
  })
})
