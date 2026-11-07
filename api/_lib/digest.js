import webpush from 'web-push'
import { holidayOn } from '../../src/holidays.js'

// Morning digest, shared by /api/digest (Vercel cron, app-open fallback, test button) and /api/tick (pg_cron).

const DAY_NAMES = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag']
const MONTH_NAMES = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december']

function weatherIcon(code) {
  if (code === 0) return '☀️'
  if (code <= 3) return '⛅'
  if (code <= 48) return '🌫️'
  if (code <= 57) return '🌧️'
  if (code <= 67) return '🌧️'
  if (code <= 77) return '🌨️'
  if (code <= 82) return '🌦️'
  if (code <= 86) return '🌨️'
  if (code >= 95) return '⛈️'
  return '☁️'
}

function weatherDesc(code) {
  if (code === 0) return 'Zonnig'
  if (code <= 2) return 'Half bewolkt'
  if (code === 3) return 'Bewolkt'
  if (code <= 48) return 'Mistig'
  if (code <= 55) return 'Lichte motregen'
  if (code <= 57) return 'Motregen'
  if (code <= 63) return 'Regen'
  if (code <= 67) return 'IJzel'
  if (code <= 75) return 'Sneeuw'
  if (code <= 77) return 'Korrelsneeuw'
  if (code <= 82) return 'Buien'
  if (code <= 86) return 'Sneeuwbuien'
  if (code >= 95) return 'Onweer'
  return 'Bewolkt'
}

function todayInAmsterdam() {
  const now = new Date()
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' })
  return fmt.format(now)
}

function entriesToday(entries, today) {
  const d = new Date(today + 'T12:00:00')
  const weekday = DAY_NAMES[d.getDay()]

  return entries.filter(e => {
    if (e.birth_year) return false
    if (e.type === 'eenmalig' && e.date === today) return true
    if (e.type === 'wekelijks' && e.weekday === weekday) {
      if (e.skip_dates && e.skip_dates.includes(today)) return false
      if (e.date && today < e.date) return false
      if (e.end_date && today > e.end_date) return false
      return true
    }
    if (e.type === 'jaarlijks' && e.date && e.date.slice(5) === today.slice(5)) return true
    if (e.type === 'periode' && e.date && e.end_date) return today >= e.date && today <= e.end_date
    return false
  })
}

async function fetchWeather(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,weathercode,precipitation_probability_max&hourly=precipitation_probability,weathercode&timezone=Europe/Amsterdam&forecast_days=1`
  const r = await fetch(url)
  if (!r.ok) return null
  return r.json()
}

function formatWeather(w) {
  if (!w || !w.daily) return { short: '', detail: '' }
  const d = w.daily
  const max = Math.round(d.temperature_2m_max[0])
  const min = Math.round(d.temperature_2m_min[0])
  const code = d.weathercode[0]
  const icon = weatherIcon(code)
  const desc = weatherDesc(code)

  const short = `${icon} ${max}°`
  let detail = `${icon} ${desc}, ${min}°–${max}°`

  if (w.hourly && w.hourly.precipitation_probability) {
    const pp = w.hourly.precipitation_probability
    const morning = pp.slice(6, 12).some(p => p > 50)
    const afternoon = pp.slice(12, 18).some(p => p > 50)
    const evening = pp.slice(18, 23).some(p => p > 50)
    const periods = []
    if (morning) periods.push('ochtend')
    if (afternoon) periods.push('middag')
    if (evening) periods.push('avond')
    if (periods.length > 0 && periods.length < 3) {
      detail += ` · Regen in de ${periods.join(' en ')}`
    } else if (periods.length === 3) {
      detail += ' · De hele dag regen'
    }
  }

  return { short, detail }
}

function formatEntry(e) {
  let line = e.title || 'Geen titel'
  if (e.who && e.who !== 'Algemeen') line += ` (${e.who})`
  if (e.time) { line += ` ${e.time}`; if (e.end_time) line += `–${e.end_time}` }
  return line
}


function reply(status, body) { return { status, body } }

export async function runDigest(supabase, { force = false } = {}) {
  const today = todayInAmsterdam()
  const forceTest = !!force

  let previousLast = null, claimed = false
  if (!forceTest) {
    const [lastSentRes, timeRes] = await Promise.all([
      supabase.from('settings').select('value').eq('id', 'digest_last_sent').single(),
      supabase.from('settings').select('value').eq('id', 'digest_time').single()
    ])
    // Legacy format was a per-user object like {"Rick": "2026-11-06"}; take the most recent date from it
    const rawLast = lastSentRes.data?.value
    const lastSent = typeof rawLast === 'string' ? rawLast
      : (rawLast && typeof rawLast === 'object') ? (Object.values(rawLast).filter(v => typeof v === 'string').sort().pop() || null)
      : null
    if (lastSent === today) return reply(200, { ok: true, skipped: true, reason: 'Al verstuurd vandaag' })

    const digestTime = timeRes.data?.value || '07:00'
    const nowAmsterdam = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date())
    if (nowAmsterdam < digestTime) return reply(200, { ok: true, skipped: true, reason: `Te vroeg — digest staat op ${digestTime}, nu is het ${nowAmsterdam}` })

    // Atomically claim today's digest so parallel triggers (pg_cron, Vercel cron, app open) never double-send.
    // Falls back to the plain check above when the claim_digest function (migration 010) is not installed.
    previousLast = rawLast ?? null
    const { data: gotIt, error: claimErr } = await supabase.rpc('claim_digest', { p_day: today })
    if (!claimErr) {
      if (!gotIt) return reply(200, { ok: true, skipped: true, reason: 'Al verstuurd vandaag' })
      claimed = true
    }
  }

  const [entriesRes, subsRes, locationRes, optoutRes] = await Promise.all([
    supabase.from('entries').select('*'),
    supabase.from('push_subscriptions').select('*'),
    supabase.from('settings').select('value').eq('id', 'location').single(),
    supabase.from('settings').select('value').eq('id', 'digest_optout').single()
  ])

  if (entriesRes.error) return reply(500, { error: 'DB error' })

  const optout = Array.isArray(optoutRes.data?.value) ? optoutRes.data.value : []
  const subs = (subsRes.data || []).filter(s => !optout.includes(s.user_name))
  if (subs.length === 0) return reply(200, { ok: true, skipped: true, reason: 'Geen abonnees' })

  const loc = locationRes.data?.value || { lat: 52.09, lon: 5.12 }
  const weather = await fetchWeather(loc.lat, loc.lon)

  const d = new Date(today + 'T12:00:00')
  const dayName = DAY_NAMES[d.getDay()]
  const dateLabel = `${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`

  const allEntries = entriesRes.data || []
  const todayItems = entriesToday(allEntries, today)
  const birthdays = allEntries.filter(e => e.birth_year && e.date && e.date.slice(5) === today.slice(5))

  const { short: weatherShort, detail: weatherDetail } = formatWeather(weather)

  const lines = []
  const holiday = holidayOn(today)
  if (holiday && !allEntries.some(e => e.date === today && e.title === holiday.title)) lines.push(`🇳🇱 ${holiday.title}`)
  for (const b of birthdays) {
    const age = d.getFullYear() - b.birth_year
    lines.push(`🎂 ${b.title} wordt ${age}!`)
  }

  const dinner = todayItems.filter(e => e.category === 'eten')
  const rest = todayItems.filter(e => e.category !== 'eten')

  for (const e of rest) lines.push(formatEntry(e))
  for (const e of dinner) lines.push(`🍽️ ${e.title}`)

  let body = `${dayName} ${dateLabel}\n`
  if (lines.length > 0) body += '\n' + lines.join('\n')
  else body += '\nGeen items vandaag'
  if (weatherDetail) body += '\n\n' + weatherDetail

  const vapidPublic = process.env.VITE_VAPID_PUBLIC_KEY
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY
  if (!vapidPublic || !vapidPrivate) return reply(500, { error: 'VAPID keys not set' })

  webpush.setVapidDetails('mailto:weekplanner@example.com', vapidPublic, vapidPrivate)

  const GREETINGS = { Merel: 'Goedemorgen schoonheid', Mare: 'Goedemorgen scheetje', Siem: 'Goedemorgen kakkie' }

  let sent = 0
  for (const sub of subs) {
    const greeting = GREETINGS[sub.user_name] || 'Goedemorgen'
    const personalTitle = `${greeting} ${weatherShort}`
    const personalPayload = JSON.stringify({ title: personalTitle, body, tag: 'digest' })
    try {
      await webpush.sendNotification(JSON.parse(sub.subscription), personalPayload, { TTL: 21600 })
      sent++
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        await supabase.from('push_subscriptions').delete().eq('id', sub.id)
      }
    }
  }

  if (sent > 0 && !forceTest && !claimed) {
    await supabase.from('settings').upsert({ id: 'digest_last_sent', value: today }, { onConflict: 'id' })
  }
  if (sent === 0 && claimed) {
    // Nothing delivered: release the claim so a later trigger can retry today
    await supabase.from('settings').upsert({ id: 'digest_last_sent', value: previousLast ?? '' }, { onConflict: 'id' })
  }

  // Weekly backup on Sundays
  if (d.getDay() === 0 && !forceTest) {
    try {
      const { data: entries } = await supabase.from('entries').select('*').order('created_at', { ascending: true }).limit(10000)
      if (entries) {
        await supabase.from('backups').insert({ entries_json: entries, entry_count: entries.length })
        const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 14)
        await supabase.from('backups').delete().lt('created_at', cutoff.toISOString())
      }
    } catch {}
  }

  return reply(200, { ok: true, sent, items: lines.length })
}
