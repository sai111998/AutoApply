import { describe, expect, it } from 'vitest'
import { classifyC2c, matchesJobTypeFilter } from './c2c'

describe('C2C classification', () => {
  it('classifies C2C as confirmed', () => {
    expect(classifyC2c({ description: 'C2C' }).status).toBe('confirmed')
  })

  it('classifies Corp-to-Corp as confirmed', () => {
    expect(classifyC2c({ title: 'Corp-to-Corp Java Engineer' }).status).toBe('confirmed')
  })

  it('classifies Corp to Corp as confirmed', () => {
    expect(classifyC2c({ description: 'This is a Corp to Corp engagement.' }).status).toBe('confirmed')
  })

  it('classifies corporation-to-corporation variants as confirmed', () => {
    expect(classifyC2c({ description: 'corporation-to-corporation' }).status).toBe('confirmed')
    expect(classifyC2c({ description: 'corp-to-corporation' }).status).toBe('confirmed')
    expect(classifyC2c({ description: 'corporation to corporation' }).status).toBe('confirmed')
  })

  it('classifies rate language as confirmed', () => {
    expect(classifyC2c({ description: 'Rate is $60/hr on C2C' }).status).toBe('confirmed')
  })

  it('classifies No C2C as not_allowed', () => {
    expect(classifyC2c({ description: 'No C2C' }).status).toBe('not_allowed')
  })

  it('classifies W2 only as not_allowed', () => {
    expect(classifyC2c({ description: 'W2 only' }).status).toBe('not_allowed')
  })

  it('does not treat a contract position as C2C', () => {
    expect(classifyC2c({ title: 'Contract position', employmentType: 'Contract' }).status).toBe('unknown')
  })

  it('does not classify 1099 as C2C', () => {
    expect(classifyC2c({ description: '1099 contract' }).status).toBe('unknown')
  })

  it('classifies mixed positive and negative evidence as not_allowed', () => {
    const result = classifyC2c({
      description: 'C2C welcome. W2 only. No third party vendors.',
    })
    expect(result.status).toBe('not_allowed')
    expect(result.evidence.length).toBeGreaterThan(1)
  })

  it('filters C2C to confirmed jobs only', () => {
    const confirmed = classifyC2c({ description: 'Corp to Corp' })
    const blocked = classifyC2c({ description: 'No C2C' })
    const unknown = classifyC2c({ description: 'Contract position' })
    expect(matchesJobTypeFilter({ description: 'Corp to Corp' }, confirmed, 'c2c')).toBe(true)
    expect(matchesJobTypeFilter({ description: 'No C2C' }, blocked, 'c2c')).toBe(false)
    expect(matchesJobTypeFilter({ description: 'Contract position' }, unknown, 'c2c')).toBe(false)
  })
})
