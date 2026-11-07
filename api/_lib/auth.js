import crypto from 'node:crypto'

// Files in /api/_lib are not exposed as routes by Vercel (underscore prefix).

function sha(s) { return crypto.createHash('sha256').update(String(s)).digest() }

// Constant-time password check. Fails closed when APP_PASSWORD is not configured.
export function checkPassword(password) {
  const correct = process.env.APP_PASSWORD
  if (!correct || typeof password !== 'string' || password.length === 0) return false
  return crypto.timingSafeEqual(sha(password), sha(correct))
}

// Secret token for the ICS feed URL. Uses CALENDAR_TOKEN when set, otherwise derived from APP_PASSWORD
// (so changing the password also invalidates old calendar links).
export function calendarToken() {
  if (process.env.CALENDAR_TOKEN) return process.env.CALENDAR_TOKEN
  if (!process.env.APP_PASSWORD) return null
  return crypto.createHmac('sha256', process.env.APP_PASSWORD).update('weekplanner-calendar-feed').digest('hex').slice(0, 32)
}

export function tokensEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  return crypto.timingSafeEqual(sha(a), sha(b))
}
