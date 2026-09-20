import { describe, expect, it } from 'vitest'
import { isAutoApplyReady, preflightApplication } from './preflight'

const applicationHtml = `
  <form>
    <label>First name</label><input name="first_name">
    <label>Email</label><input type="email" name="email">
    <label>Upload resume</label><input type="file">
    <button type="submit">Submit application</button>
  </form>
`

describe('application preflight', () => {
  it('supports a known ATS application form', () => {
    const result = preflightApplication({
      url: 'https://boards.greenhouse.io/acme/jobs/1',
      applicationUrl: 'https://boards.greenhouse.io/acme/jobs/1',
      html: applicationHtml,
      accessible: true,
      profile: { email: 'jordan@example.com', fullName: 'Jordan Hale' },
    })
    expect(result.capability).toBe('auto_apply_supported')
    expect(result.provider).toBe('greenhouse')
    expect(isAutoApplyReady(result)).toBe(true)
    expect(result.reasons.join(' ')).toMatch(/form|fields|Resume/i)
  })

  it('marks unsupported job boards and unknown hosts', () => {
    expect(preflightApplication({ url: 'https://www.indeed.com/viewjob?jk=1' }).capability).toBe('unsupported')
    expect(preflightApplication({ url: 'https://careers.unknown-corp.example/role' }).capability).toBe('unknown')
  })

  it('rejects an invalid or inaccessible URL', () => {
    expect(preflightApplication({ url: 'notaurl' }).capability).toBe('unsupported')
    expect(preflightApplication({ url: 'https://boards.greenhouse.io/acme/jobs/1', accessible: false }).blockers).toEqual(
      expect.arrayContaining(['Application URL was not accessible.']),
    )
  })

  it('pauses for login and CAPTCHA instead of continuing', () => {
    const login = preflightApplication({
      url: 'https://boards.greenhouse.io/acme/jobs/1',
      html: '<form>Sign in<input type="password"></form>',
    })
    expect(login.capability).toBe('blocked')
    expect(login.blockers.join(' ')).toMatch(/login/i)

    const captcha = preflightApplication({
      url: 'https://boards.greenhouse.io/acme/jobs/1',
      html: '<iframe src="https://www.google.com/recaptcha/api2/anchor"></iframe><div class="g-recaptcha"></div>',
    })
    expect(captcha.capability).toBe('blocked')
    expect(captcha.captcha).toBe(true)
    expect(captcha.captchaEvidence.length).toBeGreaterThan(0)
  })

  it('does not treat a missing form on an unknown host as supported', () => {
    const missing = preflightApplication({
      url: 'https://careers.unknown-corp.example/role',
      html: '<html><body><h1>Careers</h1></body></html>',
    })
    expect(missing.capability).not.toBe('auto_apply_supported')
    expect(missing.blockers.join(' ')).toMatch(/form|Apply/i)
  })
})
