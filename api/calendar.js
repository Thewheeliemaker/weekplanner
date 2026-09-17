import { createClient } from '@supabase/supabase-js'

const DAY_TO_RRULE = { maandag: 'MO', dinsdag: 'TU', woensdag: 'WE', donderdag: 'TH', vrijdag: 'FR', zaterdag: 'SA', zondag: 'SU' }
const DAY_IDX = { maandag: 1, dinsdag: 2, woensdag: 3, donderdag: 4, vrijdag: 5, zaterdag: 6, zondag: 0 }

function pad(n) { return String(n).padStart(2, '0') }
function icsDate(iso, time) { const d = iso.replace(/-/g, ''); return time ? d + 'T' + time.replace(':', '') + '00' : d }
function icsEscape(s) { return s.replace(/[\\;,]/g, c => '\\' + c).replace(/\n/g, '\\n') }
function addHour(t) { const [h, m] = t.split(':').map(Number); return pad((h + 1) % 24) + ':' + pad(m) }

function nextOccurrence(weekday) {
  const now = new Date(), target = DAY_IDX[weekday], current = now.getDay()
  const diff = (target - current + 7) % 7 || 7
  const d = new Date(now); d.setDate(now.getDate() + diff)
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}

const TZ = 'Europe/Amsterdam'
const VTIMEZONE = [
  'BEGIN:VTIMEZONE', 'TZID:Europe/Amsterdam', 'X-LIC-LOCATION:Europe/Amsterdam',
  'BEGIN:DAYLIGHT', 'DTSTART:19700329T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'TZNAME:CEST', 'END:DAYLIGHT',
  'BEGIN:STANDARD', 'DTSTART:19701025T030000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'TZNAME:CET', 'END:STANDARD',
  'END:VTIMEZONE'
].join('\r\n')

function buildICS(entries) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Weekplanner//NL', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Weekplanner', 'X-WR-TIMEZONE:Europe/Amsterdam', 'METHOD:PUBLISH']
  lines.push(VTIMEZONE)

  for (const e of entries) {
    lines.push('BEGIN:VEVENT')
    lines.push('UID:' + e.id + '@weekplanner')
    lines.push('SUMMARY:' + icsEscape(e.title + ' (' + (e.who || '').split(',').join(' & ') + ')'))
    if (e.note) lines.push('DESCRIPTION:' + icsEscape(e.note))

    if (e.type === 'eenmalig' && e.date) {
      if (e.time) { lines.push('DTSTART;TZID=' + TZ + ':' + icsDate(e.date, e.time)); lines.push('DTEND;TZID=' + TZ + ':' + icsDate(e.date, addHour(e.time))) }
      else lines.push('DTSTART;VALUE=DATE:' + icsDate(e.date))
    } else if (e.type === 'wekelijks' && e.weekday) {
      const ref = nextOccurrence(e.weekday)
      if (e.time) { lines.push('DTSTART;TZID=' + TZ + ':' + icsDate(ref, e.time)); lines.push('DTEND;TZID=' + TZ + ':' + icsDate(ref, addHour(e.time))) }
      else lines.push('DTSTART;VALUE=DATE:' + icsDate(ref))
      let rrule = 'RRULE:FREQ=WEEKLY;BYDAY=' + DAY_TO_RRULE[e.weekday]
      if (e.end_date) rrule += ';UNTIL=' + icsDate(e.end_date) + 'T235959Z'
      lines.push(rrule)
    } else if (e.type === 'jaarlijks' && e.date) {
      if (e.time) { lines.push('DTSTART;TZID=' + TZ + ':' + icsDate(e.date, e.time)); lines.push('DTEND;TZID=' + TZ + ':' + icsDate(e.date, addHour(e.time))) }
      else lines.push('DTSTART;VALUE=DATE:' + icsDate(e.date))
      lines.push('RRULE:FREQ=YEARLY')
    } else if (e.type === 'periode' && e.date && e.end_date) {
      lines.push('DTSTART;VALUE=DATE:' + icsDate(e.date))
      const end = new Date(e.end_date + 'T00:00:00'); end.setDate(end.getDate() + 1)
      lines.push('DTEND;VALUE=DATE:' + end.toISOString().slice(0, 10).replace(/-/g, ''))
    } else continue

    if (e.reminder_minutes != null) {
      lines.push('BEGIN:VALARM', 'TRIGGER:-PT' + e.reminder_minutes + 'M', 'ACTION:DISPLAY', 'DESCRIPTION:' + icsEscape(e.title), 'END:VALARM')
    }
    if (e.skip_dates && e.skip_dates.length) {
      for (const sd of e.skip_dates) lines.push('EXDATE;VALUE=DATE:' + sd.replace(/-/g, ''))
    }
    lines.push('END:VEVENT')
  }

  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}

export default async function handler(req, res) {
  const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY)
  const { data, error } = await supabase.from('entries').select('*').order('created_at', { ascending: true }).limit(800)
  if (error) return res.status(500).json({ error: 'Database query failed' })

  const ics = buildICS(data || [])
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8')
  res.setHeader('Content-Disposition', 'inline; filename="weekplanner.ics"')
  res.setHeader('Cache-Control', 'public, max-age=300')
  res.status(200).send(ics)
}
