import { createClient } from '@supabase/supabase-js'
import webpush from 'web-push'

const ALLOWED_TABLES = ['entries', 'boodschappen', 'favorieten', 'photos']

async function sendPushNotifications(supabase, entry, excludeUser) {
  const vapidPublic = process.env.VITE_VAPID_PUBLIC_KEY
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY
  if (!vapidPublic || !vapidPrivate) return

  webpush.setVapidDetails('mailto:weekplanner@example.com', vapidPublic, vapidPrivate)

  const { data: subs } = await supabase.from('push_subscriptions').select('*')
  if (!subs || subs.length === 0) return

  const filtered = excludeUser ? subs.filter(s => s.user_name !== excludeUser) : subs
  if (filtered.length === 0) return

  const DAY_ABBR = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za']
  const title = entry.title || 'Nieuw item'
  const who = entry.who || ''

  let when = ''
  if (entry.date) {
    const d = new Date(entry.date + 'T12:00:00')
    when = DAY_ABBR[d.getDay()] + ' ' + d.getDate() + '-' + (d.getMonth() + 1)
  } else if (entry.weekday) {
    const abbr = { maandag: 'ma', dinsdag: 'di', woensdag: 'wo', donderdag: 'do', vrijdag: 'vr', zaterdag: 'za', zondag: 'zo' }
    when = 'elke ' + (abbr[entry.weekday] || entry.weekday)
  }
  if (entry.time) when += (when ? ' ' : '') + entry.time

  let body = title
  if (who && who !== 'Algemeen') body += ' (' + who + ')'
  if (when) body += ' · ' + when
  const payload = JSON.stringify({ title: 'Nieuw op het bord', body })

  for (const sub of filtered) {
    try {
      await webpush.sendNotification(JSON.parse(sub.subscription), payload)
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        await supabase.from('push_subscriptions').delete().eq('id', sub.id)
      }
    }
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  const { password, action, table, data, id, ids, currentUser } = req.body || {}

  if (password !== process.env.APP_PASSWORD) return res.status(401).json({ error: 'Unauthorized' })
  if (!ALLOWED_TABLES.includes(table)) return res.status(400).json({ error: 'Invalid table' })

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) return res.status(500).json({ error: 'Service key not configured' })

  const supabase = createClient(process.env.VITE_SUPABASE_URL, serviceKey)

  try {
    let result
    if (action === 'insert') {
      if (!data) return res.status(400).json({ error: 'Missing data' })
      const rows = Array.isArray(data) ? data : [data]
      result = await supabase.from(table).insert(rows).select()
    } else if (action === 'update' && id) {
      if (!data) return res.status(400).json({ error: 'Missing data' })
      result = await supabase.from(table).update(data).eq('id', id).select()
    } else if (action === 'delete' && id) {
      result = await supabase.from(table).delete().eq('id', id)
    } else if (action === 'delete_many' && ids && Array.isArray(ids)) {
      result = await supabase.from(table).delete().in('id', ids)
    } else {
      return res.status(400).json({ error: 'Invalid action/params' })
    }

    if (result.error) return res.status(400).json({ error: result.error.message })

    if (action === 'insert' && table === 'entries' && result.data) {
      const entries = Array.isArray(result.data) ? result.data : [result.data]
      for (const entry of entries) {
        try { await sendPushNotifications(supabase, entry, currentUser) } catch {}
      }
    }

    res.status(200).json({ ok: true, data: result.data })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
