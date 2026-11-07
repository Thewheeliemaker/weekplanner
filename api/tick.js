import { createClient } from '@supabase/supabase-js'
import { tokensEqual } from './_lib/auth.js'
import { runReminders } from './_lib/reminders.js'
import { runDigest } from './_lib/digest.js'

// Called every 5 minutes by Supabase pg_cron (see migration 010). Sends due reminders and,
// once the configured digest time has passed, the morning digest (claimed once per day).
export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET
  if (!secret) return res.status(500).json({ error: 'CRON_SECRET not configured' })
  const auth = req.headers.authorization || ''
  if (!tokensEqual(auth, 'Bearer ' + secret)) return res.status(401).json({ error: 'Unauthorized' })

  const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  const result = {}
  try { result.reminders = await runReminders(supabase) } catch (e) { result.reminders = { error: e.message } }
  try { result.digest = (await runDigest(supabase)).body } catch (e) { result.digest = { error: e.message } }
  res.status(200).json(result)
}
