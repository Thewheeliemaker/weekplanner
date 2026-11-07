import { createClient } from '@supabase/supabase-js'
import { checkPassword, calendarToken } from './_lib/auth.js'

const MAX_FAILURES = 10
const WINDOW_MS = 15 * 60 * 1000

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  if (!process.env.APP_PASSWORD) return res.status(500).json({ error: 'APP_PASSWORD not configured' })

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabase = serviceKey ? createClient(process.env.VITE_SUPABASE_URL, serviceKey) : null

  // Brute-force protection: max 10 failed attempts per 15 minutes (app-wide)
  if (supabase) {
    const since = new Date(Date.now() - WINDOW_MS).toISOString()
    const { count } = await supabase.from('api_usage').select('*', { count: 'exact', head: true }).eq('endpoint', 'auth_fail').gt('created_at', since)
    if (count >= MAX_FAILURES) return res.status(429).json({ ok: false, error: 'Te veel pogingen, probeer het over een kwartier opnieuw.' })
  }

  const { password } = req.body || {}
  if (checkPassword(password)) return res.status(200).json({ ok: true, calendarToken: calendarToken() })

  if (supabase) await supabase.from('api_usage').insert({ endpoint: 'auth_fail' })
  return res.status(401).json({ ok: false })
}
