import { describe, expect, it } from 'vitest'
import { expandSearchQueries, queryTokensMatch } from './query-expand'
import { matchesProviderQuery } from './providers/boards'

describe('role query expansion', () => {
  it('keeps an empty query unrestricted', () => {
    expect(expandSearchQueries('')).toEqual([''])
    expect(queryTokensMatch({ title: 'Anything', company: 'Acme' }, '')).toBe(true)
  })

  it('expands Full Stack Java titles without requiring an exact title', () => {
    const queries = expandSearchQueries('Full Stack Java Developer')
    expect(queries).toContain('Full Stack Java Developer')
    expect(queries).toContain('Java Software Engineer')
    expect(
      queryTokensMatch(
        { title: 'Java Full Stack Developer', company: 'Acme', description: 'Java Spring' },
        'Full Stack Java Developer',
      ),
    ).toBe(true)
    expect(
      queryTokensMatch(
        { title: 'Java Software Engineer', company: 'Acme', description: 'Java backend services' },
        'Java Software Engineer',
      ),
    ).toBe(true)
  })

  it('does not treat unrelated jobs as a match for a Java full stack query', () => {
    expect(
      queryTokensMatch(
        { title: 'Dermatologist', company: 'Crossover Health', description: 'Clinic' },
        'Full Stack Java Developer',
      ),
    ).toBe(false)
  })
})

describe('provider query filters', () => {
  it('does not require every soft title token when a synonym is present', () => {
    expect(
      matchesProviderQuery(
        { title: 'Java Full Stack Engineer', company: 'Acme', description: 'Java React' },
        { q: 'Full Stack Java Developer' },
      ),
    ).toBe(true)
  })
})
