import webpush from 'web-push'
import { amsterdamNow, addDays, weekdayOf } from './time.js'

// Sends push reminders for entries with reminder_minutes. Called every ~5 minutes by /api/tick (pg_cron).
// Each (entry, occurrence date) is claimed in reminder_log first, so a reminder is never sent twice.

const WINDOW_MIN = 10 // catch-up window: tick interval (5 min) plus slack for a delayed run

function occursOn(e, day) {
  if (e.birth_year) return false
  if (e.skip_dates && e.skip_dates.includes(day)) return false
  if (e.type === 'eenmalig') return e.date === day
  if (e.type === 'periode') return e.date === day // time applies to the first day only
  if (e.type === 'jaarlijks') return !!e.date && e.date.slice(5) === day.slice(5)
  if (e.type === 'wekelijks') {
    if (e.weekday !== weekdayOf(day)) return false
    if (e.date && day < e.date) return false
    if (e.end_date && day > e.end_date) return false
    return true
  }
  return false
}

function toMin(t) { const [h, m] = t.split(':').map(Number); return h * 60 + m }

function label(minutes) {
  if (minutes === 0) return 'Nu'
  if (minutes < 60) return 'Over ' + minutes + ' min'
  if (minutes === 60) return 'Over 1 uur'
  if (minutes === 1440) return 'Morgen'
  return 'Over ' + Math.round(minutes / 60) + ' uur'
}

export async function runReminders(supabase, at = new Date()) {
  const now = amsterdamNow(at)
  const today = now.date, tomorrow = addDays(today, 1)

  const { data: entries, error } = await supabase.from('entries').select('*').not('reminder_minutes', 'is', null)
  if (error) return { error: error.message }

  // Find reminders whose fire moment falls in (now - WINDOW, now]
  const due = []
  for (const e of entries || []) {
    if (!e.time || !/^\d{1,2}:\d{2}$/.test(e.time)) continue
    for (const [day, offset] of [[today, 0], [tomorrow, 1440]]) {
      if (!occursOn(e, day)) continue
      const fireAt = offset + toMin(e.time) - e.reminder_minutes
      if (fireAt <= now.minutes && fireAt > now.minutes - WINDOW_MIN) due.push({ e, day })
    }
  }

  // Housekeeping: keep the log small
  await supabase.from('reminder_log').delete().lt('occurrence', addDays(today, -7))

  if (due.length === 0) return { due: 0, sent: 0 }

  const vapidPublic = process.env.VITE_VAPID_PUBLIC_KEY, vapidPrivate = process.env.VAPID_PRIVATE_KEY
  if (!vapidPublic || !vapidPrivate) return { error: 'VAPID keys not set' }
  webpush.setVapidDetails('mailto:weekplanner@example.com', vapidPublic, vapidPrivate)

  const { data: subs } = await supabase.from('push_subscriptions').select('*')
  let sent = 0
  for (const { e, day } of due) {
    // Atomic claim; a conflict means another run already handled it
    const { data: claim, error: claimErr } = await supabase.from('reminder_log')
      .upsert({ entry_id: e.id, occurrence: day }, { onConflict: 'entry_id,occurrence', ignoreDuplicates: true }).select()
    if (claimErr || !claim || claim.length === 0) continue

    const names = (e.who || '').split(',').map(s => s.trim()).filter(Boolean)
    const targets = (subs || []).filter(s => names.includes('Algemeen') || names.includes(s.user_name))
    const who = names.filter(n => n !== 'Algemeen').join(' & ')
    const body = label(e.reminder_minutes) + ': ' + e.title + (who ? ' (' + who + ')' : '') + ' om ' + e.time
    const payload = JSON.stringify({ title: 'Herinnering', body, tag: 'reminder-' + e.id })

    for (const sub of targets) {
      try {
        await webpush.sendNotification(JSON.parse(sub.subscription), payload, { TTL: 3600 })
        sent++
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) await supabase.from('push_subscriptions').delete().eq('id', sub.id)
      }
    }
  }
  return { due: due.length, sent }
}
