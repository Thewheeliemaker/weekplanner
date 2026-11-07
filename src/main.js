import './style.css'
import { supabase } from './supabase.js'
import { dutchHolidays } from './holidays.js'

const FAMILY = ['Siem', 'Mare', 'Merel', 'Rick']
const COLUMNS = FAMILY.concat(['Algemeen'])
const DAY_ORDER = ['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag']
const DAY_LABELS = { maandag: 'Maandag', dinsdag: 'Dinsdag', woensdag: 'Woensdag', donderdag: 'Donderdag', vrijdag: 'Vrijdag', zaterdag: 'Zaterdag', zondag: 'Zondag' }
const DAY_ABBR = { maandag: 'Ma', dinsdag: 'Di', woensdag: 'Wo', donderdag: 'Do', vrijdag: 'Vr', zaterdag: 'Za', zondag: 'Zo' }

const state = { entries: [], groceries: [], favorites: [], addType: 'wekelijks', weekOffset: 0, filterWho: null, currentUser: null, addForDate: null, editId: null, detailId: null, weather: null }

// ── preferences ──
function loadPrefs() {
  try { return JSON.parse(localStorage.getItem('wp-prefs') || '{}') } catch { return {} }
}
function savePref(key, val) {
  const p = loadPrefs(); p[key] = val
  try { localStorage.setItem('wp-prefs', JSON.stringify(p)) } catch {}
}
function pref(key, def) { const v = loadPrefs()[key]; return v === undefined ? def : v }

async function dbWrite(action, table, { data, id, ids, silent } = {}) {
  const password = localStorage.getItem('wp-auth')
  let resp
  try {
    resp = await fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password, action, table, data, id, ids, silent, currentUser: state.currentUser })
    })
  } catch {
    setOffline(true)
    return { error: { message: 'offline' } }
  }
  const result = await resp.json().catch(() => ({ error: 'Ongeldig antwoord' }))
  if (!resp.ok) return { error: { message: result.error } }
  return { data: result.data, error: null }
}

// ── helpers ──
const $ = (id) => document.getElementById(id)
const toastEl = $('toast')
let toastTimer = null
function toast(msg) { toastEl.textContent = msg; toastEl.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { toastEl.hidden = true }, 3800) }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]) }
function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s }
// ── offline support ──
// Last successful data loads are kept in localStorage so the app still shows something without internet.
function cacheSave(key, rows) { try { localStorage.setItem('wp-cache-' + key, JSON.stringify({ at: Date.now(), rows })) } catch {} }
function cacheLoad(key) { try { return JSON.parse(localStorage.getItem('wp-cache-' + key) || 'null') } catch { return null } }
let offlineSince = null
function setOffline(on, cachedAt) {
  let el = document.getElementById('offlineBanner')
  if (!on) { if (el) el.hidden = true; offlineSince = null; return }
  if (!el) { el = document.createElement('div'); el.id = 'offlineBanner'; el.className = 'offline-banner'; el.setAttribute('role', 'status'); document.body.prepend(el) }
  if (cachedAt) offlineSince = cachedAt
  const when = offlineSince ? ' Je ziet de versie van ' + new Date(offlineSince).toLocaleString('nl-NL', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) + '.' : ''
  el.textContent = 'Offline.' + when + ' Wijzigen kan weer zodra je internet hebt.'
  el.hidden = false
}
window.addEventListener('offline', () => setOffline(true))
window.addEventListener('online', () => { if (state.currentUser) { loadEntries(); loadGroceries(); loadFavorites() } })
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}) })
}

// iOS only opens the keyboard when focus() runs synchronously inside the tap, so focus right away
// (the element must already be visible), and retry on the next frame as a fallback for other browsers.
function focusSoon(id) {
  const el = $(id); if (!el) return
  el.focus()
  requestAnimationFrame(() => { if (document.activeElement !== el) el.focus() })
}

// ── snackbar (delete with undo) ──
const snackEl = $('snackbar'), snackMsgEl = $('snackbar-msg'), snackUndoBtn = $('snackbar-undo')
let snackTimer = null
function undoSnack(msg, onUndo) {
  clearTimeout(snackTimer); snackMsgEl.textContent = msg; snackEl.hidden = false
  let handled = false
  const close = () => { snackEl.hidden = true; snackUndoBtn.onclick = null }
  snackUndoBtn.onclick = () => { if (handled) return; handled = true; close(); onUndo() }
  snackTimer = setTimeout(() => { if (!handled) close() }, 5000)
}

async function deleteOneWithUndo(table, id, data, label) {
  const { error } = await dbWrite('delete', table, { id })
  if (error) { toast('Verwijderen mislukt.'); return }
  undoSnack(capitalize(label) + ' verwijderd.', async () => {
    const clone = { ...data, id }
    const { error: e2 } = await dbWrite('insert', table, { data: clone, silent: true })
    if (e2) toast('Herstellen mislukt.')
  })
}

// docs: rows in DB shape (snake_case), including id
async function deleteManyWithUndo(table, docs, label) {
  if (docs.length === 0) { toast('Niets te verwijderen.'); return }
  const ids = docs.map(d => d.id)
  const { error } = await dbWrite('delete_many', table, { ids })
  if (error) { toast('Verwijderen mislukt.'); return }
  undoSnack(docs.length + ' item(en) verwijderd (' + label + ').', async () => {
    const { error: e2 } = await dbWrite('insert', table, { data: docs, silent: true })
    if (e2) toast('Herstellen mislukt.')
  })
}

// ── modal ──
const modalOverlay = $('modalOverlay'), modalBox = $('modalBox')
function showChoiceModal(title, message, choices) {
  return new Promise(resolve => {
    modalBox.innerHTML = '<h3>' + esc(title) + '</h3><p class="modal-msg">' + esc(message) + '</p><div class="modal-actions">' +
      choices.map(c => '<button type="button" class="btn ' + (c.variant || 'btn-ghost') + '" data-id="' + esc(c.id) + '">' + esc(c.label) + '</button>').join('') +
      '<button type="button" class="btn btn-ghost" id="modal-cancel">Annuleren</button></div>'
    modalOverlay.hidden = false
    let done = false
    const finish = r => { if (done) return; done = true; modalOverlay.hidden = true; resolve(r) }
    modalBox.querySelectorAll('[data-id]').forEach(btn => btn.addEventListener('click', () => finish(btn.getAttribute('data-id'))))
    $('modal-cancel').addEventListener('click', () => finish(null))
    modalOverlay.addEventListener('click', function oc(ev) { if (ev.target === modalOverlay) { modalOverlay.removeEventListener('click', oc); finish(null) } })
  })
}

// ── weather ──
const WEATHER_ICON = {
  0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️',
  45: '🌫️', 48: '🌫️',
  51: '🌦️', 53: '🌦️', 55: '🌧️',
  56: '🌧️', 57: '🌧️',
  61: '🌦️', 63: '🌧️', 65: '🌧️',
  66: '🌧️', 67: '🌧️',
  71: '🌨️', 73: '🌨️', 75: '❄️',
  77: '❄️', 80: '🌦️', 81: '🌧️', 82: '🌧️',
  85: '🌨️', 86: '🌨️',
  95: '⛈️', 96: '⛈️', 99: '⛈️'
}
function weatherIcon(code) { return WEATHER_ICON[code] || '🌡️' }

const weatherCache = { data: null, fetched: 0, weekStart: '' }
let locationCoords = { lat: 52.09, lon: 5.12, name: 'Utrecht' }

async function loadLocation() {
  try {
    const cached = JSON.parse(localStorage.getItem('wp-location') || 'null')
    if (cached && cached.lat) { locationCoords = cached; return }
  } catch {}
  try {
    const { data } = await supabase.from('settings').select('value').eq('id', 'location').single()
    if (data && data.value && data.value.lat) {
      locationCoords = data.value
      try { localStorage.setItem('wp-location', JSON.stringify(locationCoords)) } catch {}
    }
  } catch {}
}

// key: localStorage slot; the week view and the today view each keep their own range
async function fetchWeather(days, key = 'wp-weather') {
  const startStr = ymd(days[0])
  const endStr = ymd(days[days.length - 1])
  const isWeek = key === 'wp-weather'
  const now = Date.now()
  try {
    const cached = JSON.parse(localStorage.getItem(key) || 'null')
    if (cached && cached.weekStart === startStr && cached.end === endStr && (now - cached.fetched) < 3 * 3600000) {
      if (isWeek) { weatherCache.data = cached.data; weatherCache.fetched = cached.fetched; weatherCache.weekStart = startStr }
      return cached.data
    }
  } catch {}
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${locationCoords.lat}&longitude=${locationCoords.lon}&daily=weather_code,temperature_2m_max,precipitation_sum,precipitation_probability_max,sunshine_duration&timezone=Europe/Amsterdam&start_date=${startStr}&end_date=${endStr}`
  try {
    const resp = await fetch(url)
    if (!resp.ok) return null
    const json = await resp.json()
    const result = {}
    const d = json.daily
    for (let i = 0; i < d.time.length; i++) {
      result[d.time[i]] = {
        code: d.weather_code[i],
        temp: Math.round(d.temperature_2m_max[i]),
        rain: Math.round(d.precipitation_sum[i] * 10) / 10,
        rainPct: d.precipitation_probability_max[i],
        sun: Math.round((d.sunshine_duration[i] || 0) / 3600 * 10) / 10
      }
    }
    const store = { data: result, fetched: now, weekStart: startStr, end: endStr }
    try { localStorage.setItem(key, JSON.stringify(store)) } catch {}
    if (isWeek) { weatherCache.data = result; weatherCache.fetched = now; weatherCache.weekStart = startStr }
    return result
  } catch { return null }
}

function weatherHtml(dateStr, weather) {
  if (!weather || !weather[dateStr]) return ''
  const w = weather[dateStr]
  return `<div class="weather-row">${weatherIcon(w.code)} ${w.temp}° ${w.rainPct}% ${w.rain}mm ☀${w.sun}u</div>`
}

const WEATHER_DESC = [[0, 'Zonnig'], [2, 'Half bewolkt'], [3, 'Bewolkt'], [48, 'Mistig'], [55, 'Motregen'], [57, 'Motregen'], [63, 'Regen'], [67, 'IJzel'], [75, 'Sneeuw'], [77, 'Korrelsneeuw'], [82, 'Buien'], [86, 'Sneeuwbuien'], [99, 'Onweer']]
function weatherDesc(code) { for (const [max, label] of WEATHER_DESC) if (code <= max) return label; return 'Bewolkt' }

function weatherChipHtml(dateStr, weather) {
  if (!weather || !weather[dateStr]) return ''
  const w = weather[dateStr]
  return `<span class="weather-chip">${weatherIcon(w.code)} ${w.temp}° ${w.rainPct}% ${w.rain}mm ☀${w.sun}u</span>`
}

// ── date helpers ──
function mondayOf(d) { const x = new Date(d); const day = x.getDay() || 7; x.setDate(x.getDate() - (day - 1)); x.setHours(0, 0, 0, 0); return x }
function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }
function isoWeekNum(d) {
  const dd = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = dd.getUTCDay() || 7
  dd.setUTCDate(dd.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(dd.getUTCFullYear(), 0, 1))
  return Math.ceil(((dd - yearStart) / 86400000 + 1) / 7)
}
function getWeekDays(offsetWeeks) {
  const base = new Date(); base.setDate(base.getDate() + offsetWeeks * 7)
  const monday = mondayOf(base); const days = []
  for (let i = 0; i < 7; i++) { const dd = new Date(monday); dd.setDate(monday.getDate() + i); days.push(dd) }
  return days
}
function dayNameOf(d) { return DAY_ORDER[d.getDay() === 0 ? 6 : d.getDay() - 1] }
function monthDay(str) { return str ? str.slice(5) : '' }
function shortDate(d) { return d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' }) }
function fmtDateFull(iso) { try { return new Date(iso + 'T00:00:00').toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' }) } catch { return iso } }
function todayInfo() { const d = new Date(); return { iso: ymd(d), weekday: DAY_LABELS[dayNameOf(d)] } }

// Person colours come from CSS classes (.p-Siem etc.), so light/dark is handled by the stylesheet
function personClass(name) { return 'p-' + (FAMILY.includes(name) ? name : 'Algemeen') }
function chipHtml(who) {
  if (who === 'Algemeen' || !FAMILY.includes(who)) return '<span class="chip p-Algemeen">Algemeen</span>'
  return `<span class="chip ${personClass(who)}">${esc(who)}</span>`
}
// Colour class + optional split style for an entry (first person; two-tone when two people)
function entryColor(e) {
  if (e.category === 'eten') return { cls: 'p-Eten', style: '' }
  const names = whoList(e).filter(n => FAMILY.includes(n))
  if (names.length >= 2) return { cls: personClass(names[0]) + ' is-split', style: `--split-a:var(--${names[0].toLowerCase()}-bg);--split-b:var(--${names[1].toLowerCase()}-bg)` }
  return { cls: personClass(names[0] || 'Algemeen'), style: '' }
}

// ── Supabase data helpers (snake_case ↔ camelCase) ──
function rowToEntry(r) {
  return { id: r.id, title: r.title, who: r.who, type: r.type, weekday: r.weekday, date: r.date, endDate: r.end_date, time: r.time || '', note: r.note || '', category: r.category, skipDates: r.skip_dates || [], source: r.source, opFysiekBord: r.op_fysiek_bord, photoId: r.photo_id, reminderMinutes: r.reminder_minutes, birthYear: r.birth_year, createdAt: r.created_at }
}
function entryToRow(e) {
  return { title: e.title, who: e.who, type: e.type, weekday: e.weekday || null, date: e.date || null, end_date: e.endDate || null, time: e.time || '', note: e.note || '', category: e.category || null, skip_dates: e.skipDates || [], source: e.source || 'handmatig', op_fysiek_bord: e.opFysiekBord ?? false, photo_id: e.photoId || null, reminder_minutes: e.reminderMinutes ?? null, birth_year: e.birthYear || null }
}

// ── data loading ──
async function loadEntries() {
  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - 3)
  const cutoffStr = ymd(cutoff)
  const [recurring, dated] = await Promise.all([
    supabase.from('entries').select('*').in('type', ['wekelijks', 'jaarlijks']),
    supabase.from('entries').select('*').in('type', ['eenmalig', 'periode']).or('date.gte.' + cutoffStr + ',end_date.gte.' + cutoffStr + ',date.is.null')
  ])
  if (recurring.error || dated.error) {
    const c = cacheLoad('entries')
    if (c) { state.entries = c.rows.map(rowToEntry); setOffline(true, c.at); renderTasks(); renderWeek() }
    else toast('Kon items niet laden.')
    return
  }
  const rows = (recurring.data || []).concat(dated.data || [])
  cacheSave('entries', rows); setOffline(false)
  state.entries = rows.map(rowToEntry)
  renderTasks(); renderWeek()
}
async function loadGroceries() {
  const { data, error } = await supabase.from('boodschappen').select('*').order('created_at', { ascending: true }).limit(300)
  let rows = data
  if (error) { const c = cacheLoad('groceries'); if (!c) { toast('Kon boodschappenlijst niet laden.'); return } rows = c.rows; setOffline(true, c.at) } else cacheSave('groceries', rows)
  state.groceries = rows.map(r => ({ id: r.id, naam: r.naam, afgevinkt: r.afgevinkt, createdAt: r.created_at }))
  renderGroceries()
}
async function loadFavorites() {
  const { data, error } = await supabase.from('favorieten').select('*').order('naam', { ascending: true }).limit(100)
  let rows = data
  if (error) { const c = cacheLoad('favorites'); if (!c) return; rows = c.rows } else cacheSave('favorites', rows)
  state.favorites = rows.map(r => ({ id: r.id, naam: r.naam, createdAt: r.created_at }))
  renderFavChips(); renderFavManageList()
}

// ── realtime subscriptions ──
const notifyBannerEl = $('notifyBanner'), notifyTextEl = $('notifyText'), notifyCloseEl = $('notifyClose')
let notifyTimer = null
function showInAppNotify(msg) {
  notifyTextEl.textContent = msg
  notifyBannerEl.hidden = false
  clearTimeout(notifyTimer)
  notifyTimer = setTimeout(() => { notifyBannerEl.hidden = true }, 6000)
  try { navigator.vibrate?.(200) } catch {}
}
if (notifyCloseEl) notifyCloseEl.addEventListener('click', () => { notifyBannerEl.hidden = true; clearTimeout(notifyTimer) })

function notifyNewEntry(row) {
  if (!PUSH_USERS.includes(state.currentUser)) return
  const title = row.title || 'Nieuw item'
  const who = row.who || ''
  const msg = title + (who && who !== 'Algemeen' ? ' (' + who + ')' : '')
  showInAppNotify('Nieuw op het bord: ' + msg)
}

function subscribeRealtime() {
  supabase.channel('planbord')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'entries' }, (payload) => { notifyNewEntry(payload.new); loadEntries() })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'entries' }, () => loadEntries())
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'entries' }, () => loadEntries())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'boodschappen' }, () => loadGroceries())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'favorieten' }, () => loadFavorites())
    .subscribe()
}

// ── board / task list ──
function getNewSeenAt() { try { return localStorage.getItem('wp-new-seen-at') || '' } catch { return '' } }
function markNewAsSeen() { try { localStorage.setItem('wp-new-seen-at', new Date().toISOString()) } catch {}; updateNewBadge(); try { navigator.clearAppBadge?.() } catch {} }

function updateNewBadge() {
  const badge = $('newBadge')
  if (!badge) return
  const seenAt = getNewSeenAt()
  const unread = state.entries.filter(e => !e.opFysiekBord && e.createdAt && e.createdAt > seenAt).length
  if (unread > 0) { badge.textContent = unread; badge.hidden = false }
  else badge.hidden = true
  try { if ('setAppBadge' in navigator) { unread > 0 ? navigator.setAppBadge(unread) : navigator.clearAppBadge() } } catch {}
}

function renderTasks() {
  const ul = $('taskList'), empty = $('taskEmpty')
  const pending = state.entries.filter(e => !e.opFysiekBord).slice().reverse()
  updateNewBadge()
  if (pending.length === 0) { ul.innerHTML = ''; empty.hidden = false; return }
  empty.hidden = true
  ul.innerHTML = pending.map(e => {
    let when = e.type === 'eenmalig' ? fmtDateFull(e.date || '')
      : e.type === 'jaarlijks' ? ('Jaarlijks · ' + (e.date ? shortDate(new Date(e.date + 'T00:00:00')) : ''))
      : e.type === 'periode' ? (fmtDateFull(e.date || '') + ' t/m ' + fmtDateFull(e.endDate || ''))
      : (DAY_LABELS[e.weekday] ? 'Elke ' + DAY_LABELS[e.weekday].toLowerCase() : '')
    if (e.time) when += (when ? ' · ' : '') + e.time
    if (e.endDate && e.type === 'wekelijks') when += ' (t/m ' + fmtDateFull(e.endDate) + ')'
    return `<li class="task-row"><button class="task-check" data-id="${esc(e.id)}" aria-label="Markeer als overgezet"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l5 5L20 6"></path></svg></button><div class="task-body"><div class="task-title">${esc(e.title)} ${e.category === 'eten' ? '' : chipHtml(e.who)}</div>${when ? `<div class="task-when mono">${esc(when)}</div>` : ''}${e.note ? `<div class="task-note">${esc(e.note)}</div>` : ''}<span class="task-source">${e.source === 'handmatig' ? 'handmatig' : e.source === 'foto' ? 'via foto' : 'via beschrijving'}</span></div></li>`
  }).join('')
  ul.querySelectorAll('.task-check').forEach(btn => btn.addEventListener('click', async () => {
    const { error } = await dbWrite('update', 'entries', { id: btn.dataset.id, data: { op_fysiek_bord: true } })
    if (error) toast('Kon niet bijwerken.'); else { toast('Overgezet op het bord.'); loadEntries() }
  }))

  const archiveList = $('archiveList'), archiveCount = $('archiveCount')
  const recent = state.entries.slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')).slice(0, 20)
  archiveCount.textContent = `(${recent.length})`
  if (recent.length === 0) { archiveList.innerHTML = '<p class="empty-note">Nog geen items.</p>'; return }
  archiveList.innerHTML = recent.map(e => {
    let when = e.type === 'eenmalig' ? fmtDateFull(e.date || '')
      : e.type === 'jaarlijks' ? ('Jaarlijks · ' + (e.date ? shortDate(new Date(e.date + 'T00:00:00')) : ''))
      : e.type === 'periode' ? (fmtDateFull(e.date || '') + ' t/m ' + fmtDateFull(e.endDate || ''))
      : (DAY_LABELS[e.weekday] ? 'Elke ' + DAY_LABELS[e.weekday].toLowerCase() : '')
    if (e.time) when += (when ? ' · ' : '') + e.time
    return `<li class="task-row"><div class="task-body"><div class="task-title">${esc(e.title)} ${e.category === 'eten' ? '' : chipHtml(e.who)}</div>${when ? `<div class="task-when mono">${esc(when)}</div>` : ''}</div></li>`
  }).join('')
}

$('clearBoard').addEventListener('click', async () => {
  const pending = state.entries.filter(e => !e.opFysiekBord)
  if (pending.length === 0) { toast('Niets te wissen.'); return }
  const choice = await showChoiceModal(
    'Alles als verwerkt markeren',
    pending.length + ' item(s) worden als "overgezet op het bord" gemarkeerd. Ze verdwijnen van deze lijst maar blijven op het weekoverzicht staan.',
    [{ id: 'confirm', label: 'Ja, markeer alles', variant: 'btn-primary' }]
  )
  if (choice !== 'confirm') return
  const ids = pending.map(e => e.id)
  const { error } = await dbWrite('update_many', 'entries', { ids, data: { op_fysiek_bord: true } })
  if (error) { toast('Markeren mislukt.'); return }
  toast(pending.length + ' items als verwerkt gemarkeerd.')
  loadEntries()
})

function whoList(e) { return e.who ? e.who.split(',').map(s => s.trim()) : [] }
function entryHasWho(e, col) { return whoList(e).includes(col) }

// ── week table ──
function isBirthday(e) { return e.type === 'jaarlijks' && e.birthYear }
// Dutch holidays are calculated, not stored. Skipped when a stored entry with the same title+date exists.
function holidayEntries() {
  const days = getWeekDays(state.weekOffset)
  const years = [...new Set([days[0].getFullYear(), days[6].getFullYear(), new Date().getFullYear(), new Date(Date.now() + 7 * 86400000).getFullYear()])]
  const out = []
  for (const y of years) for (const h of dutchHolidays(y)) {
    if (state.entries.some(e => e.date === h.date && e.title === h.title)) continue
    out.push({ id: 'feestdag-' + h.date, title: h.title, who: 'Algemeen', type: 'eenmalig', date: h.date, endDate: null, time: '', note: '', category: 'bijzonder', skipDates: [], opFysiekBord: true, isHoliday: true })
  }
  return out
}
function visibleEntries() {
  const base = pref('showBirthdays', true) ? state.entries : state.entries.filter(e => !isBirthday(e))
  return base.concat(holidayEntries())
}
function findEntry(id) { return state.entries.find(e => e.id === id) || holidayEntries().find(e => e.id === id) }

// ── overlap detection ──
// Timed items (not dinner, not holidays) whose 1-hour windows overlap on the same day.
const DEFAULT_DURATION = 60
function toMin(t) { const [h, m] = t.split(':').map(Number); return h * 60 + m }
function timedItemsOn(dName, dStr, list) {
  return list.filter(e => e.category !== 'eten' && !e.isHoliday && entryMatchesDay(e, dName, dStr) && showTimeForDay(e, dStr))
}
function overlaps(a, b, dStr) {
  const sa = toMin(showTimeForDay(a, dStr)), sb = toMin(showTimeForDay(b, dStr))
  return sa < sb + DEFAULT_DURATION && sb < sa + DEFAULT_DURATION
}
let weekConflicts = new Map()
function buildConflictMap(days) {
  const map = new Map(), list = visibleEntries()
  for (const day of days) {
    const dName = dayNameOf(day), dStr = ymd(day)
    const items = timedItemsOn(dName, dStr, list)
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      if (!overlaps(items[i], items[j], dStr)) continue
      for (const [x, y] of [[items[i], items[j]], [items[j], items[i]]]) {
        const k = x.id + '|' + dStr
        if (!map.has(k)) map.set(k, [])
        map.get(k).push(y)
      }
    }
  }
  return map
}
function conflictsFor(e, dStr) {
  if (!showTimeForDay(e, dStr) || e.category === 'eten' || e.isHoliday) return []
  const d = new Date(dStr + 'T12:00:00')
  return timedItemsOn(dayNameOf(d), dStr, visibleEntries()).filter(o => o.id !== e.id && overlaps(e, o, dStr))
}
function conflictBadge(e, dStr) {
  const others = weekConflicts.get(e.id + '|' + dStr)
  if (!others || others.length === 0) return ''
  const txt = 'Overlapt met: ' + others.map(o => (showTimeForDay(o, dStr) + ' ' + o.title + (o.who && o.who !== 'Algemeen' ? ' (' + o.who.split(',').join(' & ') + ')' : ''))).join(', ')
  return '<span class="ci-warn" title="' + esc(txt) + '" aria-label="' + esc(txt) + '">⚠</span>'
}
function entryMatchesDay(e, dName, dStr) {
  if (e.skipDates && e.skipDates.indexOf(dStr) >= 0) return false
  if (e.type === 'eenmalig') return e.date === dStr
  if (e.type === 'jaarlijks') return !!e.date && monthDay(e.date) === monthDay(dStr)
  if (e.type === 'periode') return !!e.date && !!e.endDate && dStr >= e.date && dStr <= e.endDate
  if (e.weekday !== dName) return false
  if (e.date && dStr < e.date) return false
  if (e.endDate && dStr > e.endDate) return false
  return true
}

function showTimeForDay(e, dStr) {
  if (!e.time) return ''
  if (e.type === 'periode' && e.date !== dStr) return ''
  return e.time
}

function ageForYear(birthYear, displayYear) { return birthYear ? displayYear - birthYear : null }

function entryIconHtml(e, col) {
  if (e.type === 'jaarlijks' && e.birthYear) return '<span class="ci-icon-emoji">🎂</span>'
  if (e.isHoliday) return '<span class="ci-icon-emoji">🇳🇱</span>'
  if (col === 'Algemeen' && e.category === 'eten') return '<svg class="ci-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3v7a2 2 0 0 0 2 2v9M6 3v7M9 3v7M15 3c-1.5 0-2 2-2 4s.5 4 2 4v10"></path></svg>'
  if (col === 'Algemeen') return ''
  return ''
}

function entryAgeBadge(e, dStr) {
  if (e.type !== 'jaarlijks' || !e.birthYear || !dStr) return ''
  const year = parseInt(dStr.slice(0, 4))
  const age = ageForYear(e.birthYear, year)
  return age > 0 ? '<span class="ci-age">' + age + ' jr</span>' : ''
}
function entryTooltip(e) {
  let tt = e.note || ''
  if (e.type === 'periode') tt = ('periode t/m ' + fmtDateFull(e.endDate)) + (tt ? ' • ' + tt : '')
  else if (e.endDate) tt += (tt ? ' • ' : '') + 't/m ' + fmtDateFull(e.endDate)
  if (e.type === 'jaarlijks') tt += (tt ? ' • ' : '') + 'jaarlijks terugkerend'
  return tt
}

async function handleEntryDeleteClick(id, dStr) {
  const entry = state.entries.find(e => e.id === id)
  if (!entry) return
  if (entry.type === 'wekelijks' || entry.type === 'jaarlijks') {
    const onceLabel = entry.type === 'jaarlijks' ? 'Alleen dit jaar' : 'Alleen deze week'
    const choice = await showChoiceModal('Terugkerend item', '"' + entry.title + '" komt vaker voor. Wat wil je verwijderen?',
      [{ id: 'once', label: onceLabel, variant: 'btn-ghost' }, { id: 'series', label: 'De hele reeks', variant: 'btn-danger' }])
    if (choice === 'once') {
      const prevSkip = entry.skipDates ? entry.skipDates.slice() : []
      const newSkip = prevSkip.concat([dStr])
      const { error } = await dbWrite('update', 'entries', { id, data: { skip_dates: newSkip } })
      if (error) { toast('Aanpassen mislukt.'); return }
      undoSnack('Overgeslagen: ' + entry.title + '.', async () => {
        await dbWrite('update', 'entries', { id, data: { skip_dates: prevSkip } })
        loadEntries()
      })
      loadEntries()
    } else if (choice === 'series') {
      await deleteOneWithUndo('entries', id, { ...entryToRow(entry), created_at: entry.createdAt }, 'item')
      loadEntries()
    }
  } else {
    await deleteOneWithUndo('entries', id, { ...entryToRow(entry), created_at: entry.createdAt }, 'item')
    loadEntries()
  }
}

function renderWeek() {
  const days = getWeekDays(state.weekOffset)
  weekConflicts = buildConflictMap(days)
  const todayStr = ymd(new Date())
  $('weekNum').textContent = String(isoWeekNum(days[0]))
  $('weekRange').textContent = shortDate(days[0]) + ' – ' + shortDate(days[6]) + ' ' + days[6].getFullYear()
  $('weekToday').hidden = state.weekOffset === 0

  const visibleCols = state.filterWho ? [state.filterWho] : COLUMNS
  const filterNote = $('weekFilterNote')
  if (state.filterWho) {
    filterNote.hidden = false
    filterNote.innerHTML = 'Filter: ' + esc(state.filterWho) + ' <button type="button" id="clearColFilter">Toon iedereen</button>'
    $('clearColFilter').addEventListener('click', () => { state.filterWho = null; renderWeek() })
  } else { filterNote.hidden = true; filterNote.innerHTML = '' }

  const theadHtml = '<thead><tr><th class="day-th">Dag</th>' + visibleCols.map(col => {
    const active = state.filterWho === col
    const cls = 'col-clickable' + (active ? ' is-filtered' : '')
    return `<th class="${cls} ${personClass(col)}" data-col="${esc(col)}">${esc(col)}</th>`
  }).join('') + '</tr></thead>'

  const rows = days.map(day => {
    const dName = dayNameOf(day), dStr = ymd(day), isToday = dStr === todayStr
    const tds = visibleCols.map(col => {
      const items = visibleEntries().filter(e => entryHasWho(e, col) && entryMatchesDay(e, dName, dStr))
        .sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'))
      const body = items.map(e => {
        const t = showTimeForDay(e, dStr)
        const c = e.category === 'eten' ? 'p-Eten' : personClass(col)
        return `<div class="ci ${c}${e.opFysiekBord ? '' : ' is-pending'}" data-id="${esc(e.id)}" title="${esc(entryTooltip(e) || (e.opFysiekBord ? '' : 'Nog op het bord zetten'))}">${entryIconHtml(e, col)}${t ? `<span class="ci-time mono">${esc(t)}</span>` : ''}<span class="ci-title">${esc(e.title)}</span>${entryAgeBadge(e, dStr)}${conflictBadge(e, dStr)}${e.note ? '<svg class="ci-note" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>' : ''}${e.isHoliday ? '' : `<button class="ci-del" data-id="${esc(e.id)}" data-date="${esc(dStr)}" aria-label="Verwijderen">×</button>`}</div>`
      }).join('')
      return `<td${col === 'Algemeen' ? ' class="col-algemeen"' : ''}>${body}<button class="cell-add" data-date="${esc(dStr)}" data-dayname="${esc(dName)}" data-who="${esc(col)}">+</button></td>`
    }).join('')
    const wHtml = state.weather ? weatherHtml(dStr, state.weather) : ''
    return `<tr class="${isToday ? 'is-today' : ''}"><td class="day-td"><div class="day-head"><span class="day-abbr">${DAY_ABBR[dName]}</span> <span class="day-num mono">${shortDate(day)}</span></div>${wHtml}<button class="day-add" data-date="${esc(dStr)}" data-dayname="${esc(dName)}" aria-label="Item toevoegen op ${DAY_LABELS[dName]}">+</button></td>${tds}</tr>`
  }).join('')

  const table = $('weekTable')
  table.innerHTML = theadHtml + '<tbody>' + rows + '</tbody>'
  table.style.minWidth = state.filterWho ? '0' : ''
  table.style.setProperty('--col-count', String(visibleCols.length))
  table.querySelectorAll('thead th[data-col]').forEach(th => {
    th.title = state.filterWho === th.dataset.col ? 'Klik om iedereen te tonen' : 'Klik om alleen ' + th.dataset.col + ' te tonen'
    th.addEventListener('click', () => { state.filterWho = state.filterWho === th.dataset.col ? null : th.dataset.col; renderWeek() })
  })
  table.querySelectorAll('.ci-del').forEach(btn => btn.addEventListener('click', ev => { ev.stopPropagation(); handleEntryDeleteClick(btn.dataset.id, btn.dataset.date) }))
  table.querySelectorAll('.ci[data-id]').forEach(div => { const tr = div.closest('tr'); const dStr = tr ? tr.querySelector('.day-add')?.dataset.date : null; div.addEventListener('click', () => openDetailEntry(div.dataset.id, div, dStr)) })
  table.querySelectorAll('.day-add').forEach(btn => btn.addEventListener('click', () => openItemForDay(btn.dataset.date, btn.dataset.dayname)))
  table.querySelectorAll('.cell-add').forEach(btn => btn.addEventListener('click', () => openItemForDay(btn.dataset.date, btn.dataset.dayname, btn.dataset.who)))

  renderWhoFilter()
  renderWeekAgenda(days, todayStr)
  renderToday()
  loadWeather(days)
}

let weatherLoading = false
async function loadWeather(days) {
  if (!pref('showWeather', true)) { state.weather = null; return }
  if (weatherLoading) return
  const weekKey = ymd(days[0])
  if (state.weather && weatherCache.weekStart === weekKey && (Date.now() - weatherCache.fetched) < 3 * 3600000) return
  weatherLoading = true
  const today = new Date()
  const maxForecast = new Date(today); maxForecast.setDate(maxForecast.getDate() + 16)
  if (days[0] > maxForecast || days[6] < today) { state.weather = null; weatherLoading = false; return }
  const weather = await fetchWeather(days)
  state.weather = weather
  weatherLoading = false
  if (weather) renderWeek()
}

const SVG = {
  note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>',
  warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"></path></svg>',
  eat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3v7a2 2 0 0 0 2 2v9M6 3v7M9 3v7M16 3c-1.5 0-2.5 2-2.5 4.5S14.5 12 16 12v9"></path></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0"></path></svg>',
  cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="3"></rect><path d="M3 9h18M8 2v4M16 2v4"></path></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"></path></svg>'
}

// Sort: timed items first (by time), then holidays, birthdays, other all-day items, dinner last
function itemRank(e) { return e.isHoliday ? 1 : isBirthday(e) ? 2 : e.category === 'eten' ? 4 : 3 }
function sortForDay(dStr) {
  return (a, b) => {
    const ta = showTimeForDay(a, dStr), tb = showTimeForDay(b, dStr)
    if (ta && tb) return ta.localeCompare(tb)
    if (ta) return -1
    if (tb) return 1
    return itemRank(a) - itemRank(b)
  }
}
function itemsOn(d) {
  const dStr = ymd(d), dName = dayNameOf(d)
  return visibleEntries().filter(e => entryMatchesDay(e, dName, dStr)).sort(sortForDay(dStr))
}

// One colour block for an entry on a given day. size: 'lg' | '' | 'sm'
function blockHtml(e, dStr, size = '') {
  const c = entryColor(e)
  const t = showTimeForDay(e, dStr)
  const names = whoList(e).filter(n => FAMILY.includes(n))
  const meta = []
  if (names.length) meta.push(names.join(' & '))
  if (e.isHoliday) meta.push('Nationale feestdag')
  if (e.category === 'eten') meta.push('Avondeten')
  if (isBirthday(e)) { const age = ageForYear(e.birthYear, parseInt(dStr.slice(0, 4))); if (age > 0) meta.push('wordt ' + age) }
  if (!e.opFysiekBord) meta.push('nog op het bord zetten')
  const clashes = conflictsFor(e, dStr)
  const pre = e.isHoliday ? '🇳🇱 ' : isBirthday(e) ? '🎂 ' : e.category === 'eten' ? `<span class="blk-icons">${SVG.eat}</span> ` : ''
  const post = (e.note ? ` <span class="blk-icons" title="Heeft een notitie">${SVG.note}</span>` : '') +
    (clashes.length ? ` <span class="blk-icons blk-warn" title="Overlapt met ${esc(clashes.map(o => o.title).join(', '))}">${SVG.warn}</span>` : '')
  return `<div class="blk ${size} ${c.cls}${e.opFysiekBord ? '' : ' is-pending'}" style="${c.style}" data-id="${esc(e.id)}" data-date="${esc(dStr)}" role="button" tabindex="0">${t ? `<div class="blk-time">${esc(t)}</div>` : ''}<div class="blk-body"><div class="blk-title">${pre}${esc(e.title)}${post}</div>${meta.length ? `<div class="blk-meta">${esc(meta.join(' · '))}</div>` : ''}</div></div>`
}

// Tap (or Enter) opens the detail sheet. Horizontal swipes are reserved for changing weeks.
function wireBlocks(root) {
  root.querySelectorAll('.blk[data-id]').forEach(el => {
    const id = el.dataset.id, dStr = el.dataset.date
    el.addEventListener('click', () => openDetailEntry(id, el, dStr))
    el.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openDetailEntry(id, el, dStr) } })
  })
}

function renderWhoFilter() {
  const wrap = $('whoFilter'); if (!wrap) return
  wrap.innerHTML = `<button type="button" class="who-chip is-all${state.filterWho ? '' : ' is-on'}" data-who="">Iedereen</button>` +
    COLUMNS.map(n => `<button type="button" class="who-chip ${personClass(n)}${state.filterWho === n ? ' is-on' : ''}" data-who="${esc(n)}">${esc(n)}</button>`).join('')
  wrap.querySelectorAll('.who-chip').forEach(b => b.addEventListener('click', () => { state.filterWho = b.dataset.who || null; renderWeek() }))
}

function renderWeekAgenda(days, todayStr) {
  const wrap = $('weekAgenda'); if (!wrap) return
  wrap.innerHTML = days.map(day => {
    const dName = dayNameOf(day), dStr = ymd(day), isToday = dStr === todayStr
    const items = itemsOn(day).filter(e => !state.filterWho || entryHasWho(e, state.filterWho))
    const itemsHtml = items.length === 0
      ? `<div class="agenda-empty">Niets gepland · <button type="button" class="agenda-empty-add" data-date="${esc(dStr)}" data-dayname="${esc(dName)}">+ toevoegen</button></div>`
      : items.map(e => blockHtml(e, dStr)).join('')
    const wChip = state.weather ? weatherChipHtml(dStr, state.weather) : ''
    return `<div class="agenda-day${isToday ? ' is-today' : ''}" data-date="${esc(dStr)}"><div class="agenda-day-head"><span class="agenda-day-name">${DAY_LABELS[dName]} ${day.getDate()}</span>${isToday ? '<span class="agenda-today-pill">vandaag</span>' : ''}${wChip}<button class="agenda-day-add" data-date="${esc(dStr)}" data-dayname="${esc(dName)}" aria-label="Item toevoegen op ${DAY_LABELS[dName]}">+</button></div><div class="agenda-items">${itemsHtml}</div></div>`
  }).join('')
  wireBlocks(wrap)
  wrap.querySelectorAll('.agenda-day-add, .agenda-empty-add').forEach(btn => btn.addEventListener('click', () => openItemForDay(btn.dataset.date, btn.dataset.dayname, state.filterWho || undefined)))
}

// ── today view ──
let todayWeather = null, todayWeatherAt = 0
async function loadTodayWeather() {
  if (!pref('showWeather', true)) { todayWeather = null; renderToday(); return }
  if (todayWeather && Date.now() - todayWeatherAt < 3 * 3600000) return
  const w = await fetchWeather(nextDays(7), 'wp-weather-today')
  if (w) { todayWeather = w; todayWeatherAt = Date.now(); renderToday() }
}
// Today plus the following days (rolling, not Monday–Sunday)
function nextDays(n) {
  const start = new Date(); start.setHours(0, 0, 0, 0)
  return Array.from({ length: n }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d })
}
function weatherCardHtml(w) {
  return `<div class="today-weather-icon" aria-hidden="true">${weatherIcon(w.code)}</div><div><div class="today-weather-main">${w.temp}° <span>${esc(weatherDesc(w.code).toLowerCase())}</span></div><div class="today-weather-sub">${w.rainPct}% kans op regen · ${w.rain} mm · ☀ ${w.sun} uur zon</div></div>`
}
function greeting(h) { return h < 6 ? 'Goedenacht' : h < 12 ? 'Goedemorgen' : h < 18 ? 'Goedemiddag' : 'Goedenavond' }
function renderToday() {
  const view = $('view-today'); if (!view) return
  const now = new Date(), todayStr = ymd(now)
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1)
  $('todayDate').textContent = capitalize(now.toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' })) + ' · week ' + isoWeekNum(now)
  $('todayGreet').textContent = greeting(now.getHours()) + (state.currentUser ? ' ' + state.currentUser : '')

  const wEl = $('todayWeather'), w = todayWeather && todayWeather[todayStr]
  if (w) {
    wEl.hidden = false
    wEl.innerHTML = weatherCardHtml(w)
  } else wEl.hidden = true

  const items = itemsOn(now)
  const main = items.filter(e => showTimeForDay(e, todayStr) || itemRank(e) === 3)
  const minis = items.filter(e => !main.includes(e))
  $('todayList').innerHTML = items.length === 0
    ? '<div class="today-empty">Niets gepland vandaag.</div>'
    : main.map(e => blockHtml(e, todayStr, 'lg')).join('') + (minis.length ? `<div class="today-minis">${minis.map(e => blockHtml(e, todayStr)).join('')}</div>` : '')

  const tStr = ymd(tomorrow), tw = todayWeather && todayWeather[tStr]
  $('tomorrowLabel').textContent = 'Morgen · ' + tomorrow.toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric' })
  const twEl = $('tomorrowWeather')
  twEl.hidden = !tw
  if (tw) twEl.innerHTML = weatherCardHtml(tw)
  const tItems = itemsOn(tomorrow)
  $('tomorrowList').innerHTML = tItems.length ? tItems.map(e => blockHtml(e, tStr, 'sm')).join('') : '<div class="agenda-empty">Niets gepland</div>'

  $('todayStrip').innerHTML = nextDays(7).map(d => {
    const dStr = ymd(d), its = itemsOn(d)
    const people = [...new Set(its.flatMap(e => whoList(e)).filter(n => FAMILY.includes(n)))].slice(0, 4)
    const dw = todayWeather && todayWeather[dStr]
    return `<button type="button" class="strip-day${dStr === todayStr ? ' is-today' : ''}" data-date="${dStr}" aria-label="${DAY_LABELS[dayNameOf(d)]}: ${its.length} items"><span>${DAY_ABBR[dayNameOf(d)].toLowerCase()}</span><span class="strip-count">${its.length}</span><span>${dw ? weatherIcon(dw.code) + ' ' + dw.temp + '°' : '&nbsp;'}</span><span class="strip-dots">${people.map(n => `<span class="${personClass(n)}"></span>`).join('')}</span></button>`
  }).join('')

  wireBlocks(view)
  view.querySelectorAll('.strip-day').forEach(b => b.addEventListener('click', () => goToDay(b.dataset.date)))
}
function goToDay(dStr) {
  state.weekOffset = Math.round((mondayOf(new Date(dStr + 'T12:00:00')) - mondayOf(new Date())) / (7 * 86400000))
  showView('week')
  renderWeek()
  requestAnimationFrame(() => {
    const el = document.querySelector(`.agenda-day[data-date="${dStr}"]`)
    if (el && el.offsetParent) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
}

// ── week nav ──
function animateWeek(direction) {
  const wrap = $('weekTable').closest('.week-table-wrap'), agenda = $('weekAgenda')
  const cls = direction === 'left' ? 'slide-left' : 'slide-right'
  wrap.classList.add(cls); agenda.classList.add(cls)
  setTimeout(() => { renderWeek(); wrap.classList.remove(cls); agenda.classList.remove(cls) }, 150)
  const hint = $('swipeHint')
  if (hint && !hint.hidden) { hint.hidden = true; localStorage.setItem('wp-swipe-seen', '1') }
}
$('weekPrev').addEventListener('click', () => { state.weekOffset -= 1; animateWeek('right') })
$('weekNext').addEventListener('click', () => { state.weekOffset += 1; animateWeek('left') })
$('weekToday').addEventListener('click', () => { state.weekOffset = 0; renderWeek() })

const weekJumpDate = $('weekJumpDate')
function syncWeekJumpValue() {
  const days = getWeekDays(state.weekOffset)
  weekJumpDate.value = ymd(days[0])
}
weekJumpDate.addEventListener('focus', syncWeekJumpValue)
weekJumpDate.addEventListener('click', (ev) => {
  ev.stopPropagation()
  syncWeekJumpValue()
})
weekJumpDate.addEventListener('change', () => {
  if (!weekJumpDate.value) return
  const picked = new Date(weekJumpDate.value + 'T12:00:00')
  const todayMon = mondayOf(new Date())
  const pickedMon = mondayOf(picked)
  const diffWeeks = Math.round((pickedMon - todayMon) / (7 * 86400000))
  state.weekOffset = diffWeeks
  renderWeek()
})

// ── keyboard nav (desktop) ──
document.addEventListener('keydown', (ev) => {
  if (ev.target.tagName === 'INPUT' || ev.target.tagName === 'TEXTAREA' || ev.target.tagName === 'SELECT' || ev.target.isContentEditable) return
  if (ev.key === 'ArrowLeft') { state.weekOffset -= 1; animateWeek('right') }
  else if (ev.key === 'ArrowRight') { state.weekOffset += 1; animateWeek('left') }
})

// ── swipe nav (mobile) ──
;(function () {
  const el = $('view-week')
  let startX = 0, startY = 0
  el.addEventListener('touchstart', e => { startX = e.touches[0].clientX; startY = e.touches[0].clientY }, { passive: true })
  el.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - startX, dy = e.changedTouches[0].clientY - startY
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return
    if (dx < 0) { state.weekOffset += 1; animateWeek('left') }
    else { state.weekOffset -= 1; animateWeek('right') }
  }, { passive: true })
})()

// ── sticky header heights (topbar + week bar) as CSS variables ──
;(function () {
  const root = document.documentElement, topbar = document.querySelector('.topbar'), weekbar = $('weekSticky')
  const update = () => {
    root.style.setProperty('--topbar-h', topbar.offsetHeight + 'px')
    root.style.setProperty('--weekbar-h', (weekbar && weekbar.offsetParent ? weekbar.offsetHeight : 0) + 'px')
  }
  if ('ResizeObserver' in window) { const ro = new ResizeObserver(update); ro.observe(topbar); if (weekbar) ro.observe(weekbar) }
  window.addEventListener('resize', update)
  window.addEventListener('scroll', () => { if (weekbar) weekbar.classList.toggle('is-stuck', weekbar.getBoundingClientRect().top <= topbar.offsetHeight + 1 && window.scrollY > 0) }, { passive: true })
  update()
})()

// ── views / tabs ──
const VIEWS = ['today', 'week', 'groceries', 'board', 'profile']
const mobileQuery = window.matchMedia('(max-width: 760px)')
function defaultView() { return mobileQuery.matches ? 'today' : 'week' }
let currentView = null
function showView(view) {
  currentView = view
  document.querySelectorAll('.tab').forEach(b => { const on = b.dataset.view === view; b.classList.toggle('is-active', on); b.setAttribute('aria-selected', on ? 'true' : 'false') })
  $('avatarBtn').classList.toggle('is-active', view === 'profile')
  VIEWS.forEach(v => { $('view-' + v).hidden = v !== view })
  closeFabMenu(); closeInlineDetail()
  if (view === 'board') markNewAsSeen()
  if (view === 'profile') { $('profileUser').textContent = state.currentUser || '—'; $('profileAvatar').textContent = state.currentUser ? state.currentUser.charAt(0).toUpperCase() : '—' }
  if (view === 'today') { renderToday(); loadTodayWeather() }
  window.scrollTo(0, 0)
}
document.querySelectorAll('.tab').forEach(btn => btn.addEventListener('click', () => showView(btn.dataset.view)))
$('avatarBtn').addEventListener('click', () => showView(currentView === 'profile' ? defaultView() : 'profile'))

// ── floating add button (mobile) ──
const fab = $('fab'), fabMenu = $('fabMenu')
function closeFabMenu() { if (!fabMenu) return; fabMenu.hidden = true; fab.classList.remove('is-open'); fab.setAttribute('aria-expanded', 'false') }
fab.addEventListener('click', ev => {
  ev.stopPropagation()
  const open = fabMenu.hidden
  fabMenu.hidden = !open; fab.classList.toggle('is-open', open); fab.setAttribute('aria-expanded', String(open))
})
document.addEventListener('click', ev => { if (!fabMenu.hidden && !fabMenu.contains(ev.target)) closeFabMenu() })
fabMenu.addEventListener('click', ev => {
  const b = ev.target.closest('[data-fab]'); if (!b) return
  const action = b.dataset.fab
  closeFabMenu()
  if (action === 'item') { showView('week'); hideAllPanels(); state.addForDate = null; state.editId = null; itemPanel.hidden = false; resetItemPanel(); itemPanel.scrollIntoView({ block: 'start' }) }
  else if (action === 'dinner') { showView('week'); if (dinnerPanel.hidden) $('btnNewDinner').click(); dinnerPanel.scrollIntoView({ block: 'start' }) }
  else if (action === 'grocery') { showView('groceries'); focusSoon('g-input') }
  else if (action === 'scan') { showView('board'); if (photoPanel.hidden) $('btnPhoto').click() }
})

// ── item form ──
function resetItemPanel() {
  state.editId = null
  $('quick-text').value = ''
  $('quick-text').placeholder = 'Bijv. Rick elke dinsdag tennisles 20:50 tot eind oktober'
  $('quickAddBox').hidden = false
  $('itemForm').hidden = true
  $('quick-hint').hidden = true
  $('f-submit').textContent = 'Toevoegen'
  $('f-back').hidden = false
  focusSoon('quick-text')
}

const itemPanel = $('itemPanel'), groceryPanel = $('groceryPanel'), dinnerPanel = $('dinnerPanel'), photoPanel = $('photoPanel')
const addDropdownMenu = $('addDropdownMenu')
function hideAllPanels() { itemPanel.hidden = true; groceryPanel.hidden = true; dinnerPanel.hidden = true; closeInlineDetail() }
$('btnAddToggle').addEventListener('click', (ev) => { ev.stopPropagation(); addDropdownMenu.hidden = !addDropdownMenu.hidden })
document.addEventListener('click', () => { if (addDropdownMenu && !addDropdownMenu.hidden) addDropdownMenu.hidden = true })
$('btnNewItem').addEventListener('click', () => { const was = itemPanel.hidden; hideAllPanels(); state.addForDate = null; state.editId = null; if (was) { itemPanel.hidden = false; resetItemPanel() } })

function openItemForDay(dateStr, dayName, who) {
  hideAllPanels()
  state.addForDate = { date: dateStr, dayName, who: who || null }
  itemPanel.hidden = false
  resetItemPanel()
  itemPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  const el = $('quick-text')
  el.placeholder = who ? 'Item voor ' + who + ' op ' + DAY_LABELS[dayName] + '…' : 'Item voor ' + DAY_LABELS[dayName] + '…'
}
let _detailOutsideHandler = null
function closeInlineDetail() {
  document.querySelectorAll('.detail-popover, .detail-inline, .detail-sheet, .sheet-backdrop').forEach(el => el.remove())
  if (_detailOutsideHandler) { document.removeEventListener('click', _detailOutsideHandler); _detailOutsideHandler = null }
  state.detailId = null
}

function positionPopover(pop, anchor) {
  document.body.appendChild(pop)
  const ar = anchor.getBoundingClientRect()
  const pr = pop.getBoundingClientRect()
  let top = ar.bottom + 6
  let left = ar.left
  if (top + pr.height > window.innerHeight - 12) top = ar.top - pr.height - 6
  if (top < 12) top = 12
  if (left + pr.width > window.innerWidth - 12) left = window.innerWidth - pr.width - 12
  if (left < 12) left = 12
  pop.style.top = top + 'px'
  pop.style.left = left + 'px'
}

const REMINDER_LABELS = { 0: 'Op het moment zelf', 15: '15 minuten van tevoren', 30: '30 minuten van tevoren', 60: '1 uur van tevoren', 1440: '1 dag van tevoren' }
function openDetailEntry(id, clickedEl, dateStr) {
  const e = findEntry(id)
  if (!e) return
  const wasOpen = state.detailId === id
  closeInlineDetail()
  if (wasOpen) return
  state.detailId = id
  const dStr = dateStr || ymd(new Date())
  let when
  if (e.type === 'wekelijks') when = 'Elke ' + (DAY_LABELS[e.weekday] || '').toLowerCase() + (e.endDate ? ' t/m ' + fmtDateFull(e.endDate) : '')
  else if (e.type === 'periode') when = fmtDateFull(e.date) + ' t/m ' + fmtDateFull(e.endDate)
  else if (e.type === 'jaarlijks') when = fmtDateFull(dStr) + ' · jaarlijks'
  else when = fmtDateFull(e.date)
  if (e.time) when += ' · ' + e.time
  const names = whoList(e).filter(n => FAMILY.includes(n))
  const c = entryColor(e)
  const rows = []
  if (e.note) rows.push(`<div class="detail-row">${SVG.note}<span>${esc(e.note)}</span></div>`)
  if (e.reminderMinutes != null) rows.push(`<div class="detail-row">${SVG.bell}<span>Herinnering: ${esc(REMINDER_LABELS[e.reminderMinutes] || e.reminderMinutes + ' min van tevoren')}</span></div>`)
  if (isBirthday(e)) { const age = ageForYear(e.birthYear, parseInt(dStr.slice(0, 4))); rows.push(`<div class="detail-row"><span>🎂</span><span>Geboren in ${e.birthYear}${age > 0 ? ', wordt ' + age : ''}</span></div>`) }
  const clashes = conflictsFor(e, dStr)
  if (clashes.length) rows.push(`<div class="detail-row is-warn">${SVG.warn}<span>Overlapt met ${esc(clashes.map(o => o.title + (whoList(o).some(n => FAMILY.includes(n)) ? ' (' + whoList(o).join(' & ') + ')' : '') + ' om ' + showTimeForDay(o, dStr)).join(', '))}</span></div>`)
  if (e.isHoliday) rows.push(`<div class="detail-row">${SVG.cal}<span>Nationale feestdag, automatisch toegevoegd</span></div>`)
  else rows.push(`<div class="detail-row"><span class="detail-status-dot" style="background:${e.opFysiekBord ? 'var(--good)' : 'var(--warn-line)'}"></span><span>${e.opFysiekBord ? 'Staat op het fysieke bord' : 'Nog op het fysieke bord zetten'}</span></div>`)
  const inner = `<div class="sheet-grip"></div><div class="detail-hero ${c.cls}" style="${c.style}"><div class="detail-who">${esc(names.join(' & ') || (e.category === 'eten' ? 'Avondeten' : 'Algemeen'))}</div><div class="detail-title">${e.isHoliday ? '🇳🇱 ' : ''}${esc(e.title)}</div><div class="detail-when">${esc(when)}</div><button type="button" class="detail-close" aria-label="Sluiten">${SVG.x}</button></div><div class="detail-rows">${rows.join('')}</div>${e.isHoliday ? '' : `<div class="detail-actions"><button type="button" class="btn btn-primary detail-edit">Bewerken</button><button type="button" class="btn btn-danger detail-delete">Verwijderen</button></div>`}`

  const inTable = clickedEl && clickedEl.closest('.week-table')
  const box = document.createElement('div')
  box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', e.title)
  if (inTable) {
    box.className = 'detail-popover'
    box.innerHTML = `<div class="detail-sheet-inner">${inner}</div>`
    box.addEventListener('click', ev => ev.stopPropagation())
    positionPopover(box, clickedEl)
    _detailOutsideHandler = () => closeInlineDetail()
    setTimeout(() => document.addEventListener('click', _detailOutsideHandler), 0)
  } else {
    const backdrop = document.createElement('div')
    backdrop.className = 'sheet-backdrop'
    backdrop.addEventListener('click', () => closeInlineDetail())
    box.className = 'detail-sheet'
    box.innerHTML = inner
    document.body.append(backdrop, box)
  }
  box.querySelector('.detail-close').addEventListener('click', () => closeInlineDetail())
  box.querySelector('.detail-edit')?.addEventListener('click', () => { closeInlineDetail(); openEditEntry(e.id) })
  box.querySelector('.detail-delete')?.addEventListener('click', () => { closeInlineDetail(); handleEntryDeleteClick(e.id, dStr) })
  box.querySelector('.detail-close').focus({ preventScroll: true })
}
document.addEventListener('keydown', ev => { if (ev.key === 'Escape') { closeInlineDetail(); closeFabMenu() } })

function openEditEntry(id) {
  const e = state.entries.find(x => x.id === id)
  if (!e) return
  if (currentView !== 'week') showView('week')
  state.editId = id
  state.addForDate = null
  hideAllPanels()
  $('itemForm').reset()
  $('quickAddBox').hidden = true
  $('itemForm').hidden = false
  $('quick-hint').hidden = true
  $('f-title').value = e.title
  setWho(e.who)
  setTimePicker(e.time || '')
  $('f-note').value = e.note || ''
  $('categoryField').hidden = e.who !== 'Algemeen'
  if (e.category) $('f-category').value = e.category
  const typeMap = { wekelijks: $('typeWeekly'), jaarlijks: $('typeYearly'), eenmalig: $('typeOnce'), periode: $('typePeriod') }
  ;(typeMap[e.type] || $('typeWeekly')).click()
  if (e.weekday) $('f-weekday').value = e.weekday
  if (e.date) $('f-date').value = e.date
  if (e.endDate) $('f-enddate').value = e.endDate
  syncEndDateMin()
  if (e.reminderMinutes != null) $('f-reminder').value = String(e.reminderMinutes)
  $('f-birthyear').value = e.birthYear || ''
  $('f-submit').textContent = 'Opslaan'
  $('f-back').hidden = true
  itemPanel.hidden = false
  itemPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
}

$('quick-cancel').addEventListener('click', () => itemPanel.hidden = true)
$('f-cancel').addEventListener('click', () => itemPanel.hidden = true)
$('f-back').addEventListener('click', () => { $('itemForm').hidden = true; $('quickAddBox').hidden = false; focusSoon('quick-text') })
$('quick-manual').addEventListener('click', () => {
  $('itemForm').reset(); setTimePicker(''); $('categoryField').hidden = true; $('quick-hint').hidden = true
  if (state.addForDate) {
    $('typeWeekly').click()
    $('f-weekday').value = state.addForDate.dayName
    $('f-date').value = state.addForDate.date
    if (state.addForDate.who) setWho(state.addForDate.who)
    else if (state.currentUser) setWho(state.currentUser)
  } else {
    $('typeWeekly').click()
    if (state.currentUser) setWho(state.currentUser)
  }
  $('quickAddBox').hidden = true; $('itemForm').hidden = false; focusSoon('f-title')
})

$('quick-text').addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); $('quick-parse').click() }
})

$('quick-parse').addEventListener('click', async () => {
  const text = $('quick-text').value.trim()
  if (!text) { toast('Typ eerst wat je wilt toevoegen.'); return }
  const btn = $('quick-parse')
  btn.disabled = true; btn.textContent = 'Bezig…'
  try {
    const parseBody = { text, password: localStorage.getItem('wp-auth') }
    if (state.addForDate) {
      parseBody.contextDate = state.addForDate.date
      if (state.addForDate.who) parseBody.contextWho = state.addForDate.who
    }
    if (state.currentUser) parseBody.currentUser = state.currentUser
    const resp = await fetch('/api/parse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(parseBody) })
    if (!resp.ok) throw new Error('API error')
    const d = await resp.json()
    $('itemForm').reset(); setTimePicker('')
    if (d.title) $('f-title').value = d.title
    if (d.time) setTimePicker(d.time)
    if (d.note) $('f-note').value = d.note
    if (d.date) $('f-date').value = d.date
    else if (state.addForDate) $('f-date').value = state.addForDate.date
    if (d.end_date) $('f-enddate').value = d.end_date
    if (d.weekday) $('f-weekday').value = d.weekday
    const typeMap = { wekelijks: typeWeekly, jaarlijks: typeYearly, eenmalig: typeOnce, periode: typePeriod }
    const typeBtn = typeMap[d.type] || typeWeekly
    typeBtn.click()
    if (d.who) setWho(d.who)
    else if (state.addForDate && state.addForDate.who) setWho(state.addForDate.who)
    else if (state.currentUser) setWho(state.currentUser)
    $('categoryField').hidden = true
    $('quick-hint').textContent = 'AI-interpretatie van: "' + text + '" — controleer en pas aan.'
    $('quick-hint').hidden = false
    $('quickAddBox').hidden = true; $('itemForm').hidden = false
  } catch (e) {
    toast('Kon tekst niet interpreteren. Probeer handmatig.')
  } finally { btn.disabled = false; btn.textContent = 'Interpreteer' }
})

const whoHidden = $('f-who'), categoryField = $('categoryField'), whoTags = $('f-who-tags')
const selectedWho = new Set()
function syncWho() {
  whoHidden.value = [...selectedWho].join(',')
  whoTags.querySelectorAll('.who-tag').forEach(b => b.classList.toggle('is-active', selectedWho.has(b.dataset.who)))
  categoryField.hidden = !selectedWho.has('Algemeen') || selectedWho.size > 1
}
function setWho(names) { selectedWho.clear(); (Array.isArray(names) ? names : names.split(',')).filter(Boolean).forEach(n => selectedWho.add(n.trim())); syncWho() }
whoTags.addEventListener('click', e => {
  const tag = e.target.closest('.who-tag'); if (!tag) return
  const name = tag.dataset.who
  if (selectedWho.has(name)) selectedWho.delete(name); else selectedWho.add(name)
  syncWho()
})

const p2 = n => String(n).padStart(2, '0')
const timeH = $('f-time-h'), timeM = $('f-time-m'), timeHidden = $('f-time')
for (let h = 0; h < 24; h++) { const o = document.createElement('option'); o.value = p2(h); o.textContent = p2(h); timeH.appendChild(o) }
for (let m = 0; m < 60; m += 5) { const o = document.createElement('option'); o.value = p2(m); o.textContent = p2(m); timeM.appendChild(o) }
function syncTime() { timeHidden.value = (timeH.value && timeM.value) ? timeH.value + ':' + timeM.value : '' }
function setTimePicker(val) { if (!val) { timeH.value = ''; timeM.value = '' } else { const [h, m] = val.split(':'); timeH.value = h; const mn = Math.round(parseInt(m) / 5) * 5; timeM.value = p2(mn >= 60 ? 55 : mn) }; syncTime() }
timeH.addEventListener('change', () => { if (timeH.value && !timeM.value) timeM.value = '00'; syncTime() })
timeM.addEventListener('change', syncTime)

const typeWeekly = $('typeWeekly'), typeYearly = $('typeYearly'), typeOnce = $('typeOnce'), typePeriod = $('typePeriod')
const weekdayField = $('weekdayField'), endDateField = $('endDateField'), dateRow = $('dateRow')
const endDateFieldLabel = $('endDateFieldLabel'), dateField = $('dateField'), dateFieldLabel = $('dateFieldLabel'), dateFieldHint = $('dateFieldHint')

function setTypeButtons(active) { [typeWeekly, typeYearly, typeOnce, typePeriod].forEach(b => b.classList.toggle('is-active', b === active)) }

typeWeekly.addEventListener('click', () => {
  state.addType = 'wekelijks'; setTypeButtons(typeWeekly)
  weekdayField.hidden = false; dateRow.hidden = false; dateField.hidden = false; endDateField.hidden = false
  dateFieldLabel.textContent = 'Vanaf'; endDateFieldLabel.textContent = 'Tot en met'
  dateFieldHint.hidden = true; syncEndDateMin(); $('birthYearField').hidden = true
})
typeYearly.addEventListener('click', () => { state.addType = 'jaarlijks'; setTypeButtons(typeYearly); weekdayField.hidden = true; dateRow.hidden = false; dateField.hidden = false; endDateField.hidden = true; dateFieldLabel.textContent = 'Datum (dit jaar)'; dateFieldHint.hidden = false; $('f-enddate').value = ''; $('birthYearField').hidden = false })
typeOnce.addEventListener('click', () => { state.addType = 'eenmalig'; setTypeButtons(typeOnce); weekdayField.hidden = true; dateRow.hidden = false; dateField.hidden = false; endDateField.hidden = true; dateFieldLabel.textContent = 'Datum'; dateFieldHint.hidden = true; $('f-enddate').value = ''; $('birthYearField').hidden = true })
typePeriod.addEventListener('click', () => {
  state.addType = 'periode'; setTypeButtons(typePeriod)
  weekdayField.hidden = true; dateRow.hidden = false; dateField.hidden = false; endDateField.hidden = false
  dateFieldLabel.textContent = 'Vanaf'; endDateFieldLabel.textContent = 'Tot en met'
  dateFieldHint.hidden = true; syncEndDateMin(); $('birthYearField').hidden = true
})

function syncEndDateMin() {
  const startVal = $('f-date').value
  const endEl = $('f-enddate')
  if (startVal) {
    endEl.min = startVal
    if (!endEl.value || endEl.value < startVal) endEl.value = startVal
  }
}
$('f-date').addEventListener('change', syncEndDateMin)

// First date (from today, within 8 weeks) on which a new/edited item would overlap with existing timed items
function findClashForNew({ type, weekday, date, endDate, time, editId }) {
  const candidate = { id: '__new__', type, weekday, date, endDate, time, skipDates: [], category: null }
  const list = visibleEntries().filter(e => e.id !== editId)
  const dates = []
  if (type === 'wekelijks') {
    const start = new Date(); start.setHours(0, 0, 0, 0)
    for (let i = 0; i < 56; i++) { const d = new Date(start); d.setDate(start.getDate() + i); dates.push(d) }
  } else if (date) dates.push(new Date(date + 'T12:00:00'))
  for (const d of dates) {
    const dName = dayNameOf(d), dStr = ymd(d)
    if (!entryMatchesDay(candidate, dName, dStr) || !showTimeForDay(candidate, dStr)) continue
    const items = timedItemsOn(dName, dStr, list).filter(o => overlaps(candidate, o, dStr))
    if (items.length) return { date: dStr, items }
  }
  return null
}

$('itemForm').addEventListener('submit', async (ev) => {
  ev.preventDefault()
  const title = $('f-title').value.trim(), who = whoHidden.value, time = $('f-time').value
  const note = $('f-note').value.trim(), weekday = $('f-weekday').value
  const date = $('f-date').value, endDate = $('f-enddate').value
  const category = selectedWho.has('Algemeen') && selectedWho.size === 1 ? $('f-category').value : null
  const reminderVal = $('f-reminder').value
  if (!title || !who) { toast('Vul in ieder geval \'wat\' en wie in.'); return }
  if ((state.addType === 'eenmalig' || state.addType === 'jaarlijks') && !date) { toast('Kies een datum.'); return }
  if (state.addType === 'periode' && (!date || !endDate)) { toast('Kies een begin- en einddatum.'); return }
  if (state.addType === 'periode' && date > endDate) { toast('De einddatum ligt voor de begindatum.'); return }

  if (time) {
    const clash = findClashForNew({ type: state.addType, weekday, date, endDate, time, editId: state.editId })
    if (clash) {
      const others = clash.items.map(o => '"' + o.title + '"' + (o.who && o.who !== 'Algemeen' ? ' (' + o.who.split(',').join(' & ') + ')' : '') + ' om ' + showTimeForDay(o, clash.date)).join(', ')
      const choice = await showChoiceModal('Overlap', 'Op ' + fmtDateFull(clash.date) + ' rond ' + time + ' staat ook: ' + others + '.', [{ id: 'save', label: 'Toch opslaan', variant: 'btn-primary' }])
      if (choice !== 'save') return
    }
  }

  const submitBtn = $('f-submit'); submitBtn.disabled = true
  const row = {
    title, who, type: state.addType,
    weekday: state.addType === 'wekelijks' ? weekday : null,
    date: (state.addType === 'eenmalig' || state.addType === 'jaarlijks' || state.addType === 'periode') ? date : (state.addType === 'wekelijks' && date) ? date : null,
    end_date: (state.addType === 'wekelijks' && endDate) ? endDate : (state.addType === 'periode' ? endDate : null),
    time: time || '', note, category,
    reminder_minutes: reminderVal !== '' ? parseInt(reminderVal) : null,
    birth_year: (state.addType === 'jaarlijks' && $('f-birthyear').value) ? parseInt($('f-birthyear').value) : null
  }
  let error
  if (state.editId) {
    ({ error } = await dbWrite('update', 'entries', { id: state.editId, data: row }))
  } else {
    row.source = 'handmatig'; row.op_fysiek_bord = false
    ;({ error } = await dbWrite('insert', 'entries', { data: row }))
  }
  submitBtn.disabled = false
  if (error) { toast(state.editId ? 'Opslaan mislukt.' : 'Toevoegen mislukt.'); return }
  toast(state.editId ? 'Opgeslagen.' : 'Toegevoegd.')
  state.editId = null; itemPanel.hidden = true; loadEntries()
})

// ── groceries ──
function groceryToRow(g) { return { id: g.id, naam: g.naam, afgevinkt: !!g.afgevinkt, created_at: g.createdAt } }
async function addGroceryItem(naam) {
  const { error } = await dbWrite('insert', 'boodschappen', { data: { naam, afgevinkt: false } })
  if (error) { toast('Toevoegen mislukt.'); return }
  toast('Toegevoegd aan boodschappenlijst.'); loadGroceries()
}

$('btnNewGrocery').addEventListener('click', () => { const was = groceryPanel.hidden; hideAllPanels(); groceryPanel.hidden = !was; if (!groceryPanel.hidden) focusSoon('gq-input') })
$('gq-cancel').addEventListener('click', () => groceryPanel.hidden = true)
$('groceryQuickForm').addEventListener('submit', ev => { ev.preventDefault(); const v = $('gq-input').value.trim(); if (!v) return; addGroceryItem(v).then(() => { $('gq-input').value = ''; groceryPanel.hidden = true }) })
$('groceryForm').addEventListener('submit', ev => { ev.preventDefault(); const v = $('g-input').value.trim(); if (!v) return; addGroceryItem(v).then(() => { $('g-input').value = '' }) })
$('clearGroceries').addEventListener('click', () => { if (state.groceries.length === 0) { toast('Lijst is al leeg.'); return }; deleteManyWithUndo('boodschappen', state.groceries.map(groceryToRow), 'boodschappenlijst gewist').then(loadGroceries) })
$('clearCheckedGroceries').addEventListener('click', () => { const checked = state.groceries.filter(g => g.afgevinkt); if (checked.length === 0) { toast('Nog niets afgevinkt.'); return }; deleteManyWithUndo('boodschappen', checked.map(groceryToRow), 'afgevinkte items gewist').then(loadGroceries) })

// ── dinner quick add ──
$('btnNewDinner').addEventListener('click', () => { const was = dinnerPanel.hidden; hideAllPanels(); dinnerPanel.hidden = !was; if (!dinnerPanel.hidden) { if (!$('d-date').value) $('d-date').value = todayInfo().iso; focusSoon('d-title') } })
$('d-cancel').addEventListener('click', () => dinnerPanel.hidden = true)
$('dinnerQuickForm').addEventListener('submit', async (ev) => {
  ev.preventDefault()
  const title = $('d-title').value.trim(), date = $('d-date').value, note = $('d-note').value.trim()
  if (!title || !date) { toast('Vul in wat we eten en de datum.'); return }
  const btn = ev.target.querySelector('button[type="submit"]'); btn.disabled = true
  const { error } = await dbWrite('insert', 'entries', { data: { title, who: 'Algemeen', type: 'eenmalig', date, time: '', note, category: 'eten', source: 'handmatig', op_fysiek_bord: false } })
  btn.disabled = false
  if (error) { toast('Toevoegen mislukt.'); return }
  toast('Avondeten toegevoegd.'); $('d-title').value = ''; $('d-note').value = ''; dinnerPanel.hidden = true; loadEntries()
})

// ── rooster scan ──
$('btnPhoto').addEventListener('click', () => {
  if (photoPanel.hidden) {
    const sel = $('scan-who')
    sel.innerHTML = COLUMNS.map(c => '<option value="' + esc(c) + '"' + (c === state.currentUser ? ' selected' : '') + '>' + esc(c) + '</option>').join('')
  }
  photoPanel.hidden = !photoPanel.hidden
})
$('photo-cancel').addEventListener('click', () => { photoPanel.hidden = true; $('photo-input').value = ''; $('photo-preview').hidden = true; $('photo-results').hidden = true; $('photo-scan').hidden = true })

function loadImagePreview(dataUrl) {
  $('photo-img').src = dataUrl; $('photo-preview').hidden = false; $('photo-scan').hidden = false; $('photo-status').textContent = ''
}

$('scan-paste').addEventListener('click', async () => {
  try {
    const items = await navigator.clipboard.read()
    for (const item of items) {
      const imgType = item.types.find(t => t.startsWith('image/'))
      if (imgType) {
        const blob = await item.getType(imgType)
        const reader = new FileReader()
        reader.onload = () => loadImagePreview(reader.result)
        reader.readAsDataURL(blob)
        return
      }
    }
    toast('Geen afbeelding op het klembord.')
  } catch (e) {
    toast('Kan klembord niet lezen. Gebruik "Kies bestand".')
  }
})

$('photo-input').addEventListener('change', (ev) => {
  const file = ev.target.files[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => loadImagePreview(reader.result)
  reader.readAsDataURL(file)
})

$('photo-scan').addEventListener('click', async () => {
  const imgSrc = $('photo-img').src
  if (!imgSrc || !imgSrc.startsWith('data:')) { toast('Plak of kies eerst een screenshot.'); return }
  const who = $('scan-who').value
  const btn = $('photo-scan')
  btn.disabled = true; btn.textContent = 'Bezig met herkennen…'; $('photo-status').textContent = 'Even geduld, AI leest het rooster…'
  try {
    const [header, base64] = imgSrc.split(',')
    const mimeType = header.match(/:(.*?);/)[1]
    const resp = await fetch('/api/ocr', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageBase64: base64, mimeType, who, password: localStorage.getItem('wp-auth') }) })
    if (!resp.ok) throw new Error('API error')
    const data = await resp.json()
    $('photo-status').textContent = data.summary || 'Klaar.'
    const entries = data.entries || []
    $('photo-scan').hidden = true
    if (entries.length === 0) { $('photo-results').innerHTML = '<p class="panel-sub">Geen diensten gevonden.</p>'; $('photo-results').hidden = false; return }
    $('photo-results').innerHTML = '<p class="panel-sub" style="margin-bottom:6px">Gevonden diensten (pas datum/tijd aan indien nodig):</p>' +
      entries.map((e, i) =>
        '<div class="scan-entry" style="display:flex;align-items:center;gap:6px;padding:5px 0;font-size:0.85rem;flex-wrap:wrap">' +
          '<input type="checkbox" checked data-idx="' + i + '" class="scan-check" style="accent-color:var(--accent)" />' +
          '<input type="date" class="scan-date" data-idx="' + i + '" value="' + esc(e.date || '') + '" />' +
          '<input type="time" class="scan-time" data-idx="' + i + '" value="' + esc(e.time || '') + '" />' +
          (e.end_time ? '<span style="color:var(--ink-soft)">–</span><input type="time" class="scan-endtime" data-idx="' + i + '" value="' + esc(e.end_time) + '" />' : '') +
          '<span style="color:var(--ink-soft)">' + esc(e.title || 'Werk') + '</span>' +
        '</div>'
      ).join('') +
      '<div style="margin-top:8px"><button type="button" class="btn btn-primary btn-sm" id="scan-add-all">Geselecteerde toevoegen</button></div>'
    $('photo-results').hidden = false
    $('scan-add-all').addEventListener('click', async () => {
      const checks = $('photo-results').querySelectorAll('.scan-check:checked')
      if (checks.length === 0) { toast('Selecteer minstens één dienst.'); return }
      const selectedWho = $('scan-who').value
      const addBtn = $('scan-add-all'); addBtn.disabled = true; addBtn.textContent = 'Bezig…'
      const rows = []
      for (const cb of checks) {
        const idx = cb.dataset.idx
        const e = entries[parseInt(idx)]
        const dateInput = $('photo-results').querySelector('.scan-date[data-idx="' + idx + '"]')
        const timeInput = $('photo-results').querySelector('.scan-time[data-idx="' + idx + '"]')
        const endInput = $('photo-results').querySelector('.scan-endtime[data-idx="' + idx + '"]')
        const date = dateInput ? dateInput.value : (e.date || null)
        const time = timeInput ? timeInput.value : (e.time || '')
        const endTime = endInput ? endInput.value : (e.end_time || '')
        const isFree = /^vrij\b/i.test((e.title || '').trim())
        const row = { title: selectedWho + (isFree ? ' vrij' : ' werken'), who: selectedWho, type: 'eenmalig', weekday: null, date: date || null, end_date: null, time: time || null, note: (!isFree && endTime) ? 'Tot ' + endTime : '', category: null, skip_dates: [], source: 'foto', op_fysiek_bord: false, photo_id: null, reminder_minutes: null, birth_year: null }
        if (isFree) row.time = null
        rows.push(row)
      }
      const { data: inserted, error } = await dbWrite('insert', 'entries', { data: rows })
      const added = error ? 0 : (inserted ? inserted.length : rows.length)
      const lastErr = error ? (error.message || 'onbekende fout') : ''
      if (added > 0) { toast(added + ' dienst' + (added !== 1 ? 'en' : '') + ' toegevoegd.'); loadEntries() }
      if (lastErr) { toast('Fout: ' + lastErr); $('photo-status').textContent = 'Fout: ' + lastErr; addBtn.disabled = false; addBtn.textContent = 'Geselecteerde toevoegen'; return }
      photoPanel.hidden = true; $('photo-input').value = ''; $('photo-preview').hidden = true; $('photo-results').hidden = true; $('photo-scan').hidden = true
    })
  } catch (e) {
    toast('Rooster kon niet worden verwerkt.')
    $('photo-status').textContent = 'Er ging iets mis.'
  } finally { btn.disabled = false; btn.textContent = 'Verwerk rooster' }
})

function renderGroceries() {
  const ul = $('groceryList'), empty = $('groceryEmpty')
  if (state.groceries.length === 0) { ul.innerHTML = ''; empty.hidden = false; return }
  empty.hidden = true
  const GROENTE = /tomaat|tomaten|komkommer|sla|paprika|ui|uien|wortel|wortels|broccoli|spinazie|courgette|champignon|champignons|bloemkool|prei|bonen|doperwt|mais|radijs|aubergine|avocado|groente|groenten|salade|rucola|andijvie|boerenkool|spruitjes|aardappel|aardappelen|aardappels|pieper|piepers|krieltjes|fruit|appel|appels|peer|peren|banaan|bananen|druiven|aardbei|aardbeien|citroen|sinaasappel|mango|kiwi|bessen|frambozen|blauwe bessen|mandarijn|mandarijnen|ananas|meloen|pruim|pruimen/i
  const VLEES = /kip|kipfilet|kippenfilet|gehakt|biefstuk|spek|worst|worstjes|rookworst|hamburger|bal|ballen|gehaktbal|karbonades|schnitzel|slavink|slavinken|draadjesvlees|rundvlees|varkensvlees|lamsvlees|shoarma|gyros|bacon|ham|filet|riblappen|stoofvlees|vis|zalm|garnalen|kabeljauw|tonijn|pangasius|tilapia|kibbeling/i
  function groceryCategory(naam) { if (GROENTE.test(naam)) return 0; if (VLEES.test(naam)) return 1; return 2 }
  const sorted = state.groceries.slice().sort((a, b) => {
    if (!!a.afgevinkt !== !!b.afgevinkt) return a.afgevinkt ? 1 : -1
    const ca = groceryCategory(a.naam), cb = groceryCategory(b.naam)
    if (ca !== cb) return ca - cb
    return (a.createdAt || '').localeCompare(b.createdAt || '')
  })
  ul.innerHTML = sorted.map(g =>
    `<li class="check-row"><button class="grocery-check${g.afgevinkt ? ' is-checked' : ''}" data-id="${esc(g.id)}" aria-label="Afvinken"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l5 5L20 6"></path></svg></button><div class="check-body"><span class="check-title${g.afgevinkt ? ' is-done' : ''}">${esc(g.naam)}</span></div><button class="icon-btn g-del" data-id="${esc(g.id)}" aria-label="Verwijderen"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-8 0 1 12a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-12"></path></svg></button></li>`
  ).join('')
  ul.querySelectorAll('.grocery-check').forEach(btn => btn.addEventListener('click', async () => {
    const item = state.groceries.find(g => g.id === btn.dataset.id)
    await dbWrite('update', 'boodschappen', { id: btn.dataset.id, data: { afgevinkt: !(item && item.afgevinkt) } })
    loadGroceries()
  }))
  ul.querySelectorAll('.g-del').forEach(btn => btn.addEventListener('click', async () => {
    const item = state.groceries.find(g => g.id === btn.dataset.id)
    if (item) { await deleteOneWithUndo('boodschappen', item.id, groceryToRow(item), 'boodschap'); loadGroceries() }
  }))
}

// ── favorites ──
function renderFavChips() {
  const wrap = $('favChips'); if (!wrap) return
  if (state.favorites.length === 0) { wrap.innerHTML = '<p class="empty-note" style="padding:0;">Nog geen favorieten — voeg ze toe via "Beheer favorieten".</p>'; return }
  wrap.innerHTML = state.favorites.map(f => `<button type="button" class="fav-chip" data-naam="${esc(f.naam)}">+ ${esc(f.naam)}</button>`).join('')
  wrap.querySelectorAll('.fav-chip').forEach(btn => btn.addEventListener('click', () => {
    const naam = btn.dataset.naam
    if (state.groceries.some(g => !g.afgevinkt && g.naam.toLowerCase() === naam.toLowerCase())) { toast(naam + ' staat al op de lijst.'); return }
    addGroceryItem(naam)
  }))
}
function renderFavManageList() {
  const ul = $('favManageList'), empty = $('favManageEmpty'); if (!ul) return
  if (state.favorites.length === 0) { ul.innerHTML = ''; empty.hidden = false; return }
  empty.hidden = true
  ul.innerHTML = state.favorites.map(f =>
    `<li class="check-row"><div class="check-body"><span class="check-title">${esc(f.naam)}</span></div><button class="icon-btn fav-del" data-id="${esc(f.id)}" aria-label="Verwijderen"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-8 0 1 12a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-12"></path></svg></button></li>`
  ).join('')
  ul.querySelectorAll('.fav-del').forEach(btn => btn.addEventListener('click', async () => {
    const fav = state.favorites.find(f => f.id === btn.dataset.id)
    if (fav) { await deleteOneWithUndo('favorieten', fav.id, { naam: fav.naam, created_at: fav.createdAt }, 'favoriet'); loadFavorites() }
  }))
}

$('btnManageFav').addEventListener('click', () => { const p = $('favPanel'); p.hidden = !p.hidden; if (!p.hidden) focusSoon('fav-input') })
$('favPanelClose').addEventListener('click', () => $('favPanel').hidden = true)
$('favAddForm').addEventListener('submit', async (ev) => {
  ev.preventDefault()
  const v = $('fav-input').value.trim(); if (!v) return
  if (state.favorites.some(f => f.naam.toLowerCase() === v.toLowerCase())) { toast(v + ' staat al bij de favorieten.'); return }
  const { error } = await dbWrite('insert', 'favorieten', { data: { naam: v } })
  if (error) { toast('Toevoegen mislukt.'); return }
  $('fav-input').value = ''; toast('Favoriet toegevoegd.'); focusSoon('fav-input'); loadFavorites()
})

// ── theme change re-render ──
if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { renderTasks(); renderWeek() })
}

// Reminders are sent as push notifications by the server (/api/tick via Supabase pg_cron).

// ── login ──
const loginOverlay = $('loginOverlay')
let selectedMember = null

document.querySelectorAll('.login-member').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.login-member').forEach(b => b.classList.remove('is-selected'))
    btn.classList.add('is-selected')
    selectedMember = btn.dataset.who
    document.documentElement.dataset.user = selectedMember
    $('loginPassRow').hidden = false
    focusSoon('loginPass')
  })
})

// Shared family account in Supabase Auth. Reads from the database require this session (RLS: authenticated only).
const FAMILY_EMAIL = 'gezin@weekplanner.app'
async function ensureDbSession(password) {
  try {
    const { data } = await supabase.auth.getSession()
    if (data.session) return true
    if (!password) return false
    const { error } = await supabase.auth.signInWithPassword({ email: FAMILY_EMAIL, password })
    if (error) console.warn('Supabase-login mislukt:', error.message)
    return !error
  } catch { return false }
}

function saveAuthResponse(json) {
  try { if (json && json.calendarToken) localStorage.setItem('wp-cal-token', json.calendarToken) } catch {}
}

async function skipLogin(user, password) {
  state.currentUser = user; document.documentElement.dataset.user = user
  const av = $('avatarBtn'); av.textContent = user.charAt(0).toUpperCase(); av.className = 'avatar-btn ' + personClass(user) + (currentView === 'profile' ? ' is-active' : '')
  await ensureDbSession(password)
  loginOverlay.hidden = true; init()
}

async function tryLogin() {
  const pass = $('loginPass').value
  if (!pass || !selectedMember) return
  $('loginSubmit').disabled = true; $('loginSubmit').textContent = '…'
  try {
    const resp = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pass }) })
    const ct = resp.headers.get('content-type') || ''
    if (!ct.includes('json')) { await skipLogin(selectedMember); return }
    const json = await resp.json().catch(() => ({}))
    if (resp.ok) {
      localStorage.setItem('wp-auth', pass)
      localStorage.setItem('wp-user', selectedMember)
      saveAuthResponse(json)
      await skipLogin(selectedMember, pass)
    } else {
      $('loginError').textContent = resp.status === 429 ? (json.error || 'Te veel pogingen.') : 'Verkeerd wachtwoord'
      $('loginError').hidden = false
    }
  } catch { $('loginError').hidden = false }
  $('loginSubmit').disabled = false; $('loginSubmit').textContent = 'Open'
}

$('loginSubmit').addEventListener('click', tryLogin)
$('loginPass').addEventListener('keydown', (e) => { if (e.key === 'Enter') tryLogin() })

// ── push subscription ──
const pushPromptEl = $('pushPrompt'), pushEnableBtn = $('pushEnable'), pushDismissBtn = $('pushDismiss')

const PUSH_USERS = ['Merel', 'Rick']

function showPushPrompt() {
  if (!PUSH_USERS.includes(state.currentUser)) return
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
  if (Notification.permission === 'granted') { doSubscribePush(); return }
  if (Notification.permission === 'denied') return
  if (localStorage.getItem('wp-push-dismissed')) return
  if (pushPromptEl) pushPromptEl.hidden = false
}

async function doSubscribePush() {
  try {
    const reg = await navigator.serviceWorker.register('/sw.js')
    await navigator.serviceWorker.ready
    const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY
    if (!vapidKey) return
    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKey })
    }
    const password = localStorage.getItem('wp-auth')
    const resp = await fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password, subscription: sub.toJSON(), user: state.currentUser })
    })
    if (resp.ok) toast('Push-notificaties actief.')
    else { const err = await resp.json().catch(() => ({})); toast('Push-registratie mislukt: ' + (err.error || resp.status)) }
  } catch (e) { toast('Push-setup mislukt: ' + e.message) }
}

if (pushEnableBtn) pushEnableBtn.addEventListener('click', async () => {
  if (pushPromptEl) pushPromptEl.hidden = true
  const permission = await Notification.requestPermission()
  if (permission === 'granted') { doSubscribePush() }
  else { toast('Notificaties zijn geblokkeerd. Schakel ze in via Instellingen.') }
})
if (pushDismissBtn) pushDismissBtn.addEventListener('click', () => {
  if (pushPromptEl) pushPromptEl.hidden = true
  try { localStorage.setItem('wp-push-dismissed', '1') } catch {}
})

// ── profile prefs ──
const prefWeather = $('pref-weather'), prefBirthdays = $('pref-birthdays'), prefDarkmode = $('pref-darkmode')
prefWeather.checked = pref('showWeather', true)
prefBirthdays.checked = pref('showBirthdays', true)
prefDarkmode.checked = pref('darkMode', false)
if (pref('darkMode', false)) document.documentElement.setAttribute('data-theme', 'dark')
prefWeather.addEventListener('change', () => { savePref('showWeather', prefWeather.checked); state.weather = null; renderWeek() })
prefBirthdays.addEventListener('change', () => { savePref('showBirthdays', prefBirthdays.checked); renderWeek() })
prefDarkmode.addEventListener('change', () => {
  savePref('darkMode', prefDarkmode.checked)
  if (prefDarkmode.checked) document.documentElement.setAttribute('data-theme', 'dark')
  else document.documentElement.removeAttribute('data-theme')
  renderWeek(); renderTasks()
})
// ── digest opt-out ──
const prefDigest = $('pref-digest')
let digestOptout = []
async function loadDigestPref() {
  try {
    const { data } = await supabase.from('settings').select('value').eq('id', 'digest_optout').single()
    if (data && Array.isArray(data.value)) digestOptout = data.value
  } catch {}
  prefDigest.checked = !digestOptout.includes(state.currentUser)
}
prefDigest.addEventListener('change', async () => {
  const user = state.currentUser
  if (!user) return
  if (prefDigest.checked) digestOptout = digestOptout.filter(u => u !== user)
  else if (!digestOptout.includes(user)) digestOptout.push(user)
  await dbWrite('upsert', 'settings', { data: { id: 'digest_optout', value: digestOptout } })
  toast(prefDigest.checked ? 'Dagelijkse digest ingeschakeld' : 'Dagelijkse digest uitgeschakeld')
})

// ── digest time (gezinsbreed) ──
const prefDigestTime = $('pref-digest-time')
async function loadDigestTime() {
  try {
    const { data } = await supabase.from('settings').select('value').eq('id', 'digest_time').single()
    if (data?.value) prefDigestTime.value = data.value
  } catch {}
}
prefDigestTime.addEventListener('change', async () => {
  const { error } = await dbWrite('upsert', 'settings', { data: { id: 'digest_time', value: prefDigestTime.value } })
  if (error) { toast('Opslaan mislukt.'); return }
  toast(`Digest-tijdstip ingesteld op ${prefDigestTime.value}`)
})

// ── location search ──
const locInput = $('locationInput'), locResults = $('locationResults'), locCurrent = $('locationCurrent')
locCurrent.textContent = locationCoords.name ? `Huidige locatie: ${locationCoords.name}` : ''
let locTimer = null
locInput.addEventListener('input', () => {
  clearTimeout(locTimer)
  const q = locInput.value.trim()
  if (q.length < 2) { locResults.hidden = true; return }
  locTimer = setTimeout(async () => {
    try {
      const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=nl&format=json`)
      const json = await r.json()
      if (!json.results || json.results.length === 0) { locResults.innerHTML = '<li>Geen resultaten</li>'; locResults.hidden = false; return }
      locResults.innerHTML = json.results.map((r, i) => `<li data-idx="${i}">${esc(r.name)} <span class="loc-sub">${esc([r.admin1, r.country].filter(Boolean).join(', '))}</span></li>`).join('')
      locResults.hidden = false
      locResults.querySelectorAll('li').forEach(li => li.addEventListener('click', async () => {
        const loc = json.results[li.dataset.idx]
        if (!loc) return
        locationCoords = { lat: loc.latitude, lon: loc.longitude, name: loc.name }
        try { localStorage.setItem('wp-location', JSON.stringify(locationCoords)) } catch {}
        await dbWrite('upsert', 'settings', { data: { id: 'location', value: locationCoords } })
        locCurrent.textContent = `Huidige locatie: ${loc.name}`
        locInput.value = ''
        locResults.hidden = true
        localStorage.removeItem('wp-weather')
        weatherCache.data = null; weatherCache.fetched = 0
        state.weather = null; renderWeek()
        toast(`Locatie ingesteld op ${loc.name}`)
      }))
    } catch {}
  }, 400)
})

$('btnTestDigest').addEventListener('click', () => {
  const btn = $('btnTestDigest')
  if (btn.disabled) return
  btn.disabled = true
  let sec = 10
  btn.textContent = `Digest over ${sec}s…`
  const iv = setInterval(() => {
    sec--
    if (sec > 0) { btn.textContent = `Digest over ${sec}s…`; return }
    clearInterval(iv)
    btn.textContent = 'Wordt verstuurd…'
    fetch('/api/digest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: localStorage.getItem('wp-auth'), test: true }) })
      .then(r => r.json())
      .then(json => { if (json.ok) toast(`Digest verstuurd naar ${json.sent} apparaat${json.sent !== 1 ? 'en' : ''}!`); else toast(json.error || 'Mislukt.') })
      .catch(() => toast('Digest versturen mislukt.'))
      .finally(() => { btn.disabled = false; btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;vertical-align:-3px;margin-right:6px"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>Test digest nu versturen' })
  }, 1000)
})

$('btnCopyCalendar').addEventListener('click', () => {
  const token = localStorage.getItem('wp-cal-token')
  if (!token) { toast('Agenda-link niet beschikbaar. Log opnieuw in.'); return }
  const url = window.location.origin + '/api/calendar?token=' + encodeURIComponent(token)
  navigator.clipboard.writeText(url).then(() => toast('Agenda-link gekopieerd!')).catch(() => toast('Kopiëren mislukt.'))
})
$('btnLogout').addEventListener('click', async () => {
  try { await supabase.auth.signOut() } catch {}
  localStorage.removeItem('wp-auth'); localStorage.removeItem('wp-user'); localStorage.removeItem('wp-cal-token')
  ;['entries', 'groceries', 'favorites'].forEach(k => localStorage.removeItem('wp-cache-' + k))
  window.location.reload()
})

// ── init ──
async function init() {
  await Promise.all([loadEntries(), loadGroceries(), loadFavorites(), loadLocation()])
  subscribeRealtime()
  renderWeek()
  loadTodayWeather()
  loadDigestPref()
  loadDigestTime()
  showPushPrompt()
  if (state.currentUser) {
    setWho(state.currentUser)
  }
  const hint = $('swipeHint')
  if (hint && localStorage.getItem('wp-swipe-seen')) hint.hidden = true

  try {
    const now = new Date()
    const hhmm = now.toLocaleTimeString('nl-NL', { timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit', hour12: false })
    const { data: timePref } = await supabase.from('settings').select('value').eq('id', 'digest_time').single()
    const digestTime = timePref?.value || '07:00'
    if (hhmm >= digestTime && hhmm < '12:00') {
      const today = now.toISOString().slice(0, 10)
      const lastTrigger = localStorage.getItem('wp-digest-trigger')
      if (lastTrigger !== today) {
        localStorage.setItem('wp-digest-trigger', today)
        fetch('/api/digest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: localStorage.getItem('wp-auth') }) })
      }
    }
  } catch {}
}

;(async function boot() {
  const savedPass = localStorage.getItem('wp-auth')
  const savedUser = localStorage.getItem('wp-user')
  // The login overlay starts hidden (see index.html) so returning users never see it flash.
  if (!savedPass || !savedUser) { loginOverlay.hidden = false; return }

  let hasSession = false
  try { const { data } = await supabase.auth.getSession(); hasSession = !!data.session } catch {}

  if (hasSession) {
    // Open right away; re-check the password in the background (e.g. after a password change)
    skipLogin(savedUser)
    verifySavedLogin(savedPass)
    return
  }

  try {
    const resp = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: savedPass }) })
    const ct = resp.headers.get('content-type') || ''
    if (!ct.includes('json')) return skipLogin(savedUser)
    if (resp.ok) { saveAuthResponse(await resp.json().catch(() => ({}))); return skipLogin(savedUser, savedPass) }
    loginOverlay.hidden = false
  } catch {
    // No connection: open with cached data
    return skipLogin(savedUser)
  }
})()

async function verifySavedLogin(password) {
  try {
    const resp = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) })
    if (!(resp.headers.get('content-type') || '').includes('json')) return
    if (resp.ok) { saveAuthResponse(await resp.json().catch(() => ({}))); return }
    if (resp.status === 401) {
      // Saved password no longer valid: sign out and show the login screen
      try { await supabase.auth.signOut() } catch {}
      localStorage.removeItem('wp-auth')
      window.location.reload()
    }
  } catch {}
}

showView(defaultView())
