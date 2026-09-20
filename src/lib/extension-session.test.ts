import { describe, expect, it } from 'vitest'
import { handshakeExtensionSession, jobpilotBackendOrigin, rememberExtensionSession } from './extension-session'

describe('extension session handshake', () => {
  it('uses the JobPilot page origin so the extension talks to the same API as Auto Apply', () => {
    expect(jobpilotBackendOrigin('http://localhost:5173/')).toBe('http://localhost:5173')
    expect(jobpilotBackendOrigin('http://127.0.0.1:5173')).toBe('http://127.0.0.1:5173')
    expect(jobpilotBackendOrigin('')).toBe('http://127.0.0.1:8787')
  })

  it('does not throw when the extension bridge is not in a browser document', async () => {
    expect(() => rememberExtensionSession({ userId: 'user-1' })).not.toThrow()
    await expect(handshakeExtensionSession({ userId: 'user-1' }, 0)).resolves.toBeUndefined()
  })
})
