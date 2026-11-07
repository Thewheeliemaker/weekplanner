import { createClient } from '@supabase/supabase-js'
import { checkPassword } from './_lib/auth.js'
import { runDigest } from './_lib/digest.js'

export default async function handler(req, res) {
  if (req.method === 'POST') {
    const { password } = req.body || {}
    if (!checkPassword(password)) return res.status(401).json({ error: 'Unauthorized' })
  } else if (req.method === 'GET') {
    const cronSecret = process.env.CRON_SECRET
    if (cronSecret) {
      const auth = req.headers.authorization
      if (auth !== `Bearer ${cronSecret}`) return res.status(401).json({ error: 'Unauthorized' })
    }
  } else {
    return res.status(405).json({ error: 'GET or POST only' })
  }

  const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  const force = req.method === 'POST' && req.body?.test === true
  const { status, body } = await runDigest(supabase, { force })
  res.status(status).json(body)
}
