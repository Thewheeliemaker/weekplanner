// Date/time helpers pinned to Europe/Amsterdam (Vercel functions run in UTC).

export const TZ = 'Europe/Amsterdam'
export const DAY_NAMES = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag']

// { date: 'YYYY-MM-DD', hhmm: 'HH:MM', minutes, weekday: 'maandag', year }
export function amsterdamNow(at = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(at).map(p => [p.type, p.value]))
  const hour = parts.hour === '24' ? '00' : parts.hour
  const date = `${parts.year}-${parts.month}-${parts.day}`
  return {
    date,
    hhmm: `${hour}:${parts.minute}`,
    minutes: Number(hour) * 60 + Number(parts.minute),
    weekday: DAY_NAMES[new Date(date + 'T12:00:00Z').getUTCDay()],
    year: Number(parts.year)
  }
}

// Add days to a YYYY-MM-DD string
export function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function weekdayOf(iso) { return DAY_NAMES[new Date(iso + 'T12:00:00Z').getUTCDay()] }
