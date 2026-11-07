// Dutch public holidays, calculated (no database rows needed). Shared by the app and api/digest.

function iso(y, m, d) { return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0') }

// Anonymous Gregorian algorithm (Meeus/Jones/Butcher)
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(Date.UTC(y, month - 1, day))
}

function shift(date, days) { const d = new Date(date); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10) }

const cache = new Map()

// Returns [{ date: 'YYYY-MM-DD', title }] for a year
export function dutchHolidays(year) {
  if (cache.has(year)) return cache.get(year)
  const e = easter(year)
  // Koningsdag: 27 April, or 26 April when the 27th is a Sunday
  const kingsDay = new Date(Date.UTC(year, 3, 27)).getUTCDay() === 0 ? iso(year, 4, 26) : iso(year, 4, 27)
  const list = [
    { date: iso(year, 1, 1), title: 'Nieuwjaarsdag' },
    { date: shift(e, -2), title: 'Goede Vrijdag' },
    { date: shift(e, 0), title: 'Eerste Paasdag' },
    { date: shift(e, 1), title: 'Tweede Paasdag' },
    { date: kingsDay, title: 'Koningsdag' },
    { date: iso(year, 5, 5), title: 'Bevrijdingsdag' },
    { date: shift(e, 39), title: 'Hemelvaartsdag' },
    { date: shift(e, 49), title: 'Eerste Pinksterdag' },
    { date: shift(e, 50), title: 'Tweede Pinksterdag' },
    { date: iso(year, 12, 25), title: 'Eerste Kerstdag' },
    { date: iso(year, 12, 26), title: 'Tweede Kerstdag' }
  ]
  cache.set(year, list)
  return list
}

export function holidayOn(isoDate) {
  return dutchHolidays(Number(isoDate.slice(0, 4))).find(h => h.date === isoDate) || null
}
