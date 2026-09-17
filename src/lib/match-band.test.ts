import { describe, expect, it } from 'vitest'
import { matchBand, matchBandLabel } from './match-band'

describe('live job match bands', () => {
  it('labels truthful bands without changing the score', () => {
    expect(matchBand(100)).toBe('strong')
    expect(matchBand(85)).toBe('strong')
    expect(matchBand(84)).toBe('good')
    expect(matchBand(70)).toBe('good')
    expect(matchBand(69)).toBe('partial')
    expect(matchBand(50)).toBe('partial')
    expect(matchBand(49)).toBe('low')
    expect(matchBand(0)).toBe('low')
    expect(matchBand(null)).toBe('pending')
    expect(matchBandLabel(82)).toBe('Good Match')
    expect(matchBandLabel(62)).toBe('Partial Match')
  })
})
