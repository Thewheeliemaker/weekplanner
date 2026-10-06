import { createClient } from '@supabase/supabase-js'
import webpush from 'web-push'

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

export default async function handler(req, res) {
  if (req.method === 'POST') {
    const { password } = req.body || {}
    if (password !== process.env.APP_PASSWORD) return res.status(401).json({ error: 'Unauthorized' })
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

  const today = todayInAmsterdam()
  const d = new Date(today + 'T12:00:00')
  const dayName = DAY_NAMES[d.getDay()]
  const dateLabel = `${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`

  const [entriesRes, subsRes, locationRes] = await Promise.all([
    supabase.from('entries').select('*'),
    supabase.from('push_subscriptions').select('*'),
    supabase.from('settings').select('value').eq('id', 'location').single()
  ])

  const loc = locationRes.data?.value || { lat: 52.09, lon: 5.12 }
  const weather = await fetchWeather(loc.lat, loc.lon)

  if (entriesRes.error) return res.status(500).json({ error: 'DB error' })
  const subs = subsRes.data || []
  if (subs.length === 0) return res.status(200).json({ ok: true, skipped: true, reason: 'Geen abonnees' })

  const allEntries = entriesRes.data || []
  const todayItems = entriesToday(allEntries, today)
  const birthdays = allEntries.filter(e => e.birth_year && e.date && e.date.slice(5) === today.slice(5))

  const { short: weatherShort, detail: weatherDetail } = formatWeather(weather)

  const lines = []
  for (const b of birthdays) {
    const age = d.getFullYear() - b.birth_year
    lines.push(`🎂 ${b.title} wordt ${age}!`)
  }

  const dinner = todayItems.filter(e => e.category === 'eten')
  const rest = todayItems.filter(e => e.category !== 'eten')

  for (const e of rest) lines.push(formatEntry(e))
  for (const e of dinner) lines.push(`🍽️ ${e.title}`)

  const title = `Goedemorgen ${weatherShort}`

  let body = `${dayName} ${dateLabel}\n`
  if (lines.length > 0) body += '\n' + lines.join('\n')
  else body += '\nGeen items vandaag'
  if (weatherDetail) body += '\n\n' + weatherDetail

  const vapidPublic = process.env.VITE_VAPID_PUBLIC_KEY
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY
  if (!vapidPublic || !vapidPrivate) return res.status(500).json({ error: 'VAPID keys not set' })

  webpush.setVapidDetails('mailto:weekplanner@example.com', vapidPublic, vapidPrivate)

  const payload = JSON.stringify({ title, body, tag: 'digest' })
  let sent = 0
  for (const sub of subs) {
    try {
      await webpush.sendNotification(JSON.parse(sub.subscription), payload)
      sent++
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        await supabase.from('push_subscriptions').delete().eq('id', sub.id)
      }
    }
  }

  res.status(200).json({ ok: true, sent, items: lines.length })
}
