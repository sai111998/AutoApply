import { createVercelHandler } from '../server/vercel-api'

// Mount the existing Express app. Vercel must not parse the body so Express
// json()/raw() handlers still see POST /api/jobs/analyze and resume uploads.
export const config = {
  api: {
    bodyParser: false,
  },
  maxDuration: 60,
}

export default createVercelHandler()
