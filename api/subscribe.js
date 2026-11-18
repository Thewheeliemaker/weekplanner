import { createClient } from '@supabase/supabase-js'
import { checkPassword } from './_lib/auth.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  const { password, subscription, user, action, endpoint } = req.body || {}
  if (!checkPassword(password)) return res.status(401).json({ error: 'Unauthorized' })

  const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

  // Turn notifications off for this phone
  if (action === 'unsubscribe') {
    if (!endpoint) return res.status(400).json({ error: 'Missing endpoint' })
    const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint)
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ ok: true })
  }

  if (!subscription || !subscription.endpoint || !user) return res.status(400).json({ error: 'Missing subscription or user' })

  const { error } = await supabase.from('push_subscriptions').upsert(
    { endpoint: subscription.endpoint, subscription: JSON.stringify(subscription), user_name: user },
    { onConflict: 'endpoint' }
  )
  if (error) return res.status(500).json({ error: error.message })
  res.status(200).json({ ok: true })
}
