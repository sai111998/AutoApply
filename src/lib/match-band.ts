export type MatchBand = 'strong' | 'good' | 'partial' | 'low' | 'pending'

export function matchBand(score: number | null | undefined): MatchBand {
  if (score == null) return 'pending'
  if (score >= 85) return 'strong'
  if (score >= 70) return 'good'
  if (score >= 50) return 'partial'
  return 'low'
}

export function matchBandLabel(score: number | null | undefined): string {
  switch (matchBand(score)) {
    case 'strong':
      return 'Strong Match'
    case 'good':
      return 'Good Match'
    case 'partial':
      return 'Partial Match'
    case 'low':
      return 'Low Match'
    default:
      return 'Score unavailable'
  }
}

export function matchBandTone(score: number | null | undefined): 'strong' | 'review' | 'skip' | 'pending' {
  const band = matchBand(score)
  if (band === 'strong' || band === 'good') return 'strong'
  if (band === 'partial') return 'review'
  if (band === 'low') return 'skip'
  return 'pending'
}
