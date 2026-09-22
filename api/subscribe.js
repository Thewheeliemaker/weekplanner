import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  const { password, subscription, user } = req.body || {}
  if (password !== process.env.APP_PASSWORD) return res.status(401).json({ error: 'Unauthorized' })
  if (!subscription || !subscription.endpoint || !user) return res.status(400).json({ error: 'Missing subscription or user' })

  const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

  const { error } = await supabase.from('push_subscriptions').upsert(
    { endpoint: subscription.endpoint, subscription: JSON.stringify(subscription), user_name: user },
    { onConflict: 'endpoint' }
  )
  if (error) return res.status(500).json({ error: error.message })
  res.status(200).json({ ok: true })
}
