import { describe, expect, it } from 'vitest'
import { userFacingPersistError } from './persist-errors'

describe('persist errors', () => {
  it('maps RLS failures to a keep-resume message', () => {
    expect(userFacingPersistError({ code: '42501', message: 'row-level security' }, 'fallback')).toMatch(
      /permission/i,
    )
  })

  it('maps missing-column failures to a schema message', () => {
    expect(
      userFacingPersistError({ code: 'PGRST204', message: "Could not find the 'is_selected' column of 'resume_versions'" }, 'fallback'),
    ).toMatch(/schema/i)
  })

  it('maps foreign-key failures to a job-link message', () => {
    expect(userFacingPersistError({ code: '23503', message: 'violates foreign key constraint' }, 'fallback')).toMatch(
      /linked to the saved job/i,
    )
  })

  it('uses the fallback when the error is not an Error instance', () => {
    expect(userFacingPersistError({ unexpected: true }, 'Could not keep the resume.')).toBe(
      'Could not keep the resume.',
    )
  })
})
