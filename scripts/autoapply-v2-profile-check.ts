/* Dev-only: exercise GET /api/autoapply-v2/profile-check. Prints availability booleans only, never values. */
import request from 'supertest'
import { createApp } from '../server/app'
import { saveCandidateProfile } from '../server/application/candidate-store'
import { getServerConfig } from '../server/config'

const USER_ID = process.argv[2] ?? 'v2-profile-check-user'

async function main() {
  const app = createApp({ config: getServerConfig() })
  const empty = await request(app).get('/api/autoapply-v2/profile-check').query({ userId: USER_ID })
  console.log(`[V2-PROFILE-CHECK] user present=false status=${empty.status}`)
  console.log(JSON.stringify(empty.body))

  saveCandidateProfile({
    userId: USER_ID,
    profile: {
      fullName: 'Ada Lovelace',
      email: 'ada@example.com',
      phone: '555-0100',
      location: 'Austin, TX',
      yearsOfExperience: 8,
      workAuthorization: 'US Citizen',
      sponsorshipRequired: false,
      preferredWorkArrangement: 'Remote',
      targetSalaryMin: null,
      targetSalaryMax: null,
    },
    resumeText: 'resume',
    resumeVersionId: 'resume-v1',
  })
  const filled = await request(app).get('/api/autoapply-v2/profile-check').query({ userId: USER_ID })
  console.log(`[V2-PROFILE-CHECK] user present=true status=${filled.status}`)
  console.log(JSON.stringify(filled.body))
}

main().catch((error) => {
  console.error('[V2-PROFILE-CHECK] fatal', error)
  process.exit(1)
})
