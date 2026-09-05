import { describe, expect, it } from 'vitest'
import {
  applySelectAll,
  bulkDeleteBody,
  bulkDeleteTitle,
  checkboxSelectionState,
  deletedApplicationsMessage,
  pruneSelection,
  toggleId,
} from './application-bulk'

describe('application bulk selection', () => {
  const visible = ['a', 'b', 'c']

  it('selects one application', () => {
    expect(toggleId([], 'a')).toEqual(['a'])
  })

  it('selects multiple applications', () => {
    expect(toggleId(toggleId(['a'], 'b'), 'c')).toEqual(['a', 'b', 'c'])
  })

  it('selects all visible applications', () => {
    expect(applySelectAll(visible, false)).toEqual(visible)
    expect(checkboxSelectionState(visible, visible)).toBe('all')
  })

  it('unselects all', () => {
    expect(applySelectAll(visible, true)).toEqual([])
    expect(checkboxSelectionState([], visible)).toBe('none')
  })

  it('uses an indeterminate state when some visible rows are selected', () => {
    expect(checkboxSelectionState(['a', 'b'], visible)).toBe('some')
  })

  it('does not keep hidden ids in the visible selection', () => {
    expect(pruneSelection(['a', 'hidden'], visible)).toEqual(['a'])
  })

  it('writes confirmation copy for one or many applications', () => {
    expect(bulkDeleteTitle(1)).toBe('Delete 1 application?')
    expect(bulkDeleteTitle(3)).toBe('Delete 3 applications?')
    expect(bulkDeleteBody(3)).toMatch(/application records/)
    expect(bulkDeleteBody(3)).not.toMatch(/resume|job record|match history/i)
    expect(deletedApplicationsMessage(1)).toBe('Application deleted.')
    expect(deletedApplicationsMessage(3)).toBe('3 applications deleted.')
  })
})
