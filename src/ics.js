const DAY_TO_RRULE = { maandag: 'MO', dinsdag: 'TU', woensdag: 'WE', donderdag: 'TH', vrijdag: 'FR', zaterdag: 'SA', zondag: 'SU' }

function pad(n) { return String(n).padStart(2, '0') }
function icsDate(iso, time) {
  const d = iso.replace(/-/g, '')
  if (!time) return d
  return d + 'T' + time.replace(':', '') + '00'
}
function uid(id) { return id + '@weekplanner' }

export function generateICS(entries) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Weekplanner//NL', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Weekplanner']

  for (const e of entries) {
    lines.push('BEGIN:VEVENT')
    lines.push('UID:' + uid(e.id))
    lines.push('SUMMARY:' + icsEscape(e.title + ' (' + e.who + ')'))
    if (e.note) lines.push('DESCRIPTION:' + icsEscape(e.note))

    if (e.type === 'eenmalig' && e.date) {
      if (e.time) {
        lines.push('DTSTART:' + icsDate(e.date, e.time))
        lines.push('DTEND:' + icsDate(e.date, addHour(e.time)))
      } else {
        lines.push('DTSTART;VALUE=DATE:' + icsDate(e.date))
      }
    } else if (e.type === 'wekelijks' && e.weekday) {
      const refDate = nextOccurrence(e.weekday)
      if (e.time) {
        lines.push('DTSTART:' + icsDate(refDate, e.time))
        lines.push('DTEND:' + icsDate(refDate, addHour(e.time)))
      } else {
        lines.push('DTSTART;VALUE=DATE:' + icsDate(refDate))
      }
      let rrule = 'RRULE:FREQ=WEEKLY;BYDAY=' + DAY_TO_RRULE[e.weekday]
      if (e.endDate) rrule += ';UNTIL=' + icsDate(e.endDate) + 'T235959'
      lines.push(rrule)
    } else if (e.type === 'jaarlijks' && e.date) {
      if (e.time) {
        lines.push('DTSTART:' + icsDate(e.date, e.time))
        lines.push('DTEND:' + icsDate(e.date, addHour(e.time)))
      } else {
        lines.push('DTSTART;VALUE=DATE:' + icsDate(e.date))
      }
      lines.push('RRULE:FREQ=YEARLY')
    } else if (e.type === 'periode' && e.date && e.endDate) {
      lines.push('DTSTART;VALUE=DATE:' + icsDate(e.date))
      const end = new Date(e.endDate + 'T00:00:00')
      end.setDate(end.getDate() + 1)
      lines.push('DTEND;VALUE=DATE:' + end.toISOString().slice(0, 10).replace(/-/g, ''))
    } else continue

    if (e.reminderMinutes != null) {
      lines.push('BEGIN:VALARM', 'TRIGGER:-PT' + e.reminderMinutes + 'M', 'ACTION:DISPLAY', 'DESCRIPTION:' + icsEscape(e.title), 'END:VALARM')
    }

    if (e.skipDates && e.skipDates.length) {
      for (const sd of e.skipDates) lines.push('EXDATE;VALUE=DATE:' + sd.replace(/-/g, ''))
    }

    lines.push('END:VEVENT')
  }

  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}

function icsEscape(s) { return s.replace(/[\\;,]/g, c => '\\' + c).replace(/\n/g, '\\n') }
function addHour(t) { const [h, m] = t.split(':').map(Number); return pad((h + 1) % 24) + ':' + pad(m) }
function nextOccurrence(weekday) {
  const dayIdx = { maandag: 1, dinsdag: 2, woensdag: 3, donderdag: 4, vrijdag: 5, zaterdag: 6, zondag: 0 }
  const now = new Date(), target = dayIdx[weekday], current = now.getDay()
  const diff = (target - current + 7) % 7 || 7
  const d = new Date(now); d.setDate(now.getDate() + diff)
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}

export function downloadICS(entries) {
  const ics = generateICS(entries)
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = 'weekplanner.ics'; a.click()
  URL.revokeObjectURL(url)
}
