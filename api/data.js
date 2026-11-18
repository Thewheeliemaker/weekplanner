import { createClient } from '@supabase/supabase-js'
import webpush from 'web-push'
import { checkPassword } from './_lib/auth.js'

const ALLOWED_TABLES = ['entries', 'boodschappen', 'favorieten', 'photos', 'settings']

// Per-person preference for "new item" pushes, stored as settings rows notify_pref_<Name>:
//   'all'  = every new item, 'mine' = only items with that person or Algemeen, 'none' = no new-item pushes.
// No row means 'all' (the behaviour before the setting existed).
async function loadNotifyPrefs(supabase) {
  const { data } = await supabase.from('settings').select('id, value').like('id', 'notify_pref_%')
  const prefs = {}
  for (const row of data || []) prefs[row.id.slice('notify_pref_'.length)] = row.value
  return prefs
}

function involves(entry, name) {
  const who = String(entry.who || '').split(',').map(s => s.trim())
  return who.includes(name) || who.includes('Algemeen')
}

const DAY_ABBR = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za']
const WEEKDAY_ABBR = { maandag: 'ma', dinsdag: 'di', woensdag: 'wo', donderdag: 'do', vrijdag: 'vr', zaterdag: 'za', zondag: 'zo' }
function describe(entry) {
  let when = ''
  if (entry.date) {
    const d = new Date(entry.date + 'T12:00:00')
    when = DAY_ABBR[d.getDay()] + ' ' + d.getDate() + '-' + (d.getMonth() + 1)
  } else if (entry.weekday) when = 'elke ' + (WEEKDAY_ABBR[entry.weekday] || entry.weekday)
  if (entry.time) when += (when ? ' ' : '') + entry.time
  let body = entry.title || 'Nieuw item'
  if (entry.who && entry.who !== 'Algemeen') body += ' (' + entry.who.split(',').join(' & ') + ')'
  if (when) body += ' · ' + when
  return body
}

// entries: the newly inserted rows. Each subscriber gets one push about the items relevant to them.
async function sendPushNotifications(supabase, entries, excludeUser) {
  const vapidPublic = process.env.VITE_VAPID_PUBLIC_KEY
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY
  if (!vapidPublic || !vapidPrivate || entries.length === 0) return
  webpush.setVapidDetails('mailto:weekplanner@example.com', vapidPublic, vapidPrivate)

  const [{ data: subs }, prefs] = await Promise.all([supabase.from('push_subscriptions').select('*'), loadNotifyPrefs(supabase)])
  for (const sub of subs || []) {
    if (excludeUser && sub.user_name === excludeUser) continue
    const pref = prefs[sub.user_name] || 'all'
    if (pref === 'none') continue
    const relevant = pref === 'mine' ? entries.filter(e => involves(e, sub.user_name)) : entries
    if (relevant.length === 0) continue
    const body = relevant.length === 1 ? describe(relevant[0])
      : relevant.length + ' nieuwe items' + (() => { const w = [...new Set(relevant.flatMap(e => String(e.who || '').split(',')).map(x => x.trim()).filter(x => x && x !== 'Algemeen'))]; return w.length ? ' (' + w.join(', ') + ')' : '' })()
    const payload = JSON.stringify({ title: 'Nieuw op het bord', body })
    try {
      await webpush.sendNotification(JSON.parse(sub.subscription), payload)
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) await supabase.from('push_subscriptions').delete().eq('id', sub.id)
    }
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  const { password, action, table, data, id, ids, currentUser, silent } = req.body || {}

  if (!checkPassword(password)) return res.status(401).json({ error: 'Unauthorized' })
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
    } else if (action === 'upsert' && table === 'settings') {
      if (!data || !data.id) return res.status(400).json({ error: 'Missing data.id' })
      result = await supabase.from(table).upsert({ id: data.id, value: data.value }, { onConflict: 'id' }).select()
    } else if (action === 'update' && id) {
      if (!data) return res.status(400).json({ error: 'Missing data' })
      result = await supabase.from(table).update(data).eq('id', id).select()
    } else if (action === 'delete' && id) {
      result = await supabase.from(table).delete().eq('id', id)
    } else if (action === 'update_many' && ids && Array.isArray(ids)) {
      if (!data) return res.status(400).json({ error: 'Missing data' })
      result = await supabase.from(table).update(data).in('id', ids).select()
    } else if (action === 'delete_many' && ids && Array.isArray(ids)) {
      result = await supabase.from(table).delete().in('id', ids)
    } else {
      return res.status(400).json({ error: 'Invalid action/params' })
    }

    if (result.error) return res.status(400).json({ error: result.error.message })

    if (action === 'insert' && table === 'entries' && result.data && !silent) {
      const entries = Array.isArray(result.data) ? result.data : [result.data]
      // One push per subscriber; bulk inserts (roster scan) become a single summary
      try { await sendPushNotifications(supabase, entries, currentUser) } catch {}
    }

    res.status(200).json({ ok: true, data: result.data })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
