import './style.css'
import { supabase } from './supabase.js'

const FAMILY = ['Siem', 'Mare', 'Merel', 'Rick']
const COLUMNS = FAMILY.concat(['Algemeen'])
const FAMILY_HUE = { Siem: 35, Mare: 265, Merel: 340, Rick: 205 }
const DAY_ORDER = ['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag']
const DAY_LABELS = { maandag: 'Maandag', dinsdag: 'Dinsdag', woensdag: 'Woensdag', donderdag: 'Donderdag', vrijdag: 'Vrijdag', zaterdag: 'Zaterdag', zondag: 'Zondag' }
const DAY_ABBR = { maandag: 'Ma', dinsdag: 'Di', woensdag: 'Wo', donderdag: 'Do', vrijdag: 'Vr', zaterdag: 'Za', zondag: 'Zo' }

const state = { entries: [], groceries: [], favorites: [], addType: 'wekelijks', weekOffset: 0, filterWho: null, currentUser: null, addForDate: null, editId: null }

async function dbWrite(action, table, { data, id, ids } = {}) {
  const password = localStorage.getItem('wp-auth')
  const resp = await fetch('/api/data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password, action, table, data, id, ids })
  })
  const result = await resp.json()
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
function focusSoon(id) { requestAnimationFrame(() => { const el = $(id); if (el) el.focus() }) }

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
    const clone = { ...data }; delete clone.id
    const { error: e2 } = await dbWrite('insert', table, { data: clone })
    if (e2) toast('Herstellen mislukt.')
  })
}

async function deleteManyWithUndo(table, docs, label) {
  if (docs.length === 0) { toast('Niets te verwijderen.'); return }
  const ids = docs.map(d => d.id)
  const { error } = await dbWrite('delete_many', table, { ids })
  if (error) { toast('Verwijderen mislukt.'); return }
  undoSnack(docs.length + ' item(en) verwijderd (' + label + ').', async () => {
    const rows = docs.map(d => { const c = { ...d }; delete c.id; return c })
    const { error: e2 } = await dbWrite('insert', table, { data: rows })
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

function isDark() {
  const el = document.documentElement
  if (el.getAttribute('data-theme') === 'dark') return true
  if (el.getAttribute('data-theme') === 'light') return false
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
}
function hueColors(hue) {
  const dark = isDark()
  return { bg: `hsl(${hue},${dark ? '34%' : '62%'},${dark ? '22%' : '91%'})`, fg: `hsl(${hue},${dark ? '55%' : '48%'},${dark ? '78%' : '32%'})` }
}
function chipHtml(who) {
  if (who === 'Algemeen' || !FAMILY_HUE[who]) return '<span class="chip chip-algemeen">Algemeen</span>'
  const c = hueColors(FAMILY_HUE[who])
  return `<span class="chip" style="background:${c.bg};color:${c.fg}">${esc(who)}</span>`
}

// ── Supabase data helpers (snake_case ↔ camelCase) ──
function rowToEntry(r) {
  return { id: r.id, title: r.title, who: r.who, type: r.type, weekday: r.weekday, date: r.date, endDate: r.end_date, time: r.time || '', note: r.note || '', category: r.category, skipDates: r.skip_dates || [], source: r.source, opFysiekBord: r.op_fysiek_bord, photoId: r.photo_id, reminderMinutes: r.reminder_minutes, createdAt: r.created_at }
}
function entryToRow(e) {
  return { title: e.title, who: e.who, type: e.type, weekday: e.weekday || null, date: e.date || null, end_date: e.endDate || null, time: e.time || '', note: e.note || '', category: e.category || null, skip_dates: e.skipDates || [], source: e.source || 'handmatig', op_fysiek_bord: e.opFysiekBord ?? false, photo_id: e.photoId || null, reminder_minutes: e.reminderMinutes ?? null }
}

// ── data loading ──
async function loadEntries() {
  const { data, error } = await supabase.from('entries').select('*').order('created_at', { ascending: true }).limit(800)
  if (error) { toast('Kon items niet laden.'); return }
  state.entries = data.map(rowToEntry)
  renderTasks(); renderWeek()
}
async function loadGroceries() {
  const { data, error } = await supabase.from('boodschappen').select('*').order('created_at', { ascending: true }).limit(300)
  if (error) { toast('Kon boodschappenlijst niet laden.'); return }
  state.groceries = data.map(r => ({ id: r.id, naam: r.naam, afgevinkt: r.afgevinkt, createdAt: r.created_at }))
  renderGroceries()
}
async function loadFavorites() {
  const { data, error } = await supabase.from('favorieten').select('*').order('naam', { ascending: true }).limit(100)
  if (error) { toast('Kon favorieten niet laden.'); return }
  state.favorites = data.map(r => ({ id: r.id, naam: r.naam, createdAt: r.created_at }))
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

function notifyMerelNewEntry(row) {
  if (state.currentUser !== 'Merel') return
  const title = row.title || 'Nieuw item'
  const who = row.who || ''
  const msg = title + (who && who !== 'Algemeen' ? ' (' + who + ')' : '')
  showInAppNotify('Nieuw op het bord: ' + msg)
  if ('Notification' in window && Notification.permission === 'granted') {
    try { new Notification('Weekplanner', { body: msg, icon: '/icon-192.png' }) } catch {}
  }
}

function subscribeRealtime() {
  supabase.channel('planbord')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'entries' }, (payload) => { notifyMerelNewEntry(payload.new); loadEntries() })
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
    return `<li class="task-row"><button class="task-check" data-id="${esc(e.id)}" aria-label="Markeer als overgezet"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l5 5L20 6"></path></svg></button><div class="task-body"><div class="task-title">${esc(e.title)} ${e.category === 'eten' ? '' : chipHtml(e.who)}</div>${when ? `<div class="task-when mono">${esc(when)}</div>` : ''}${e.note ? `<div class="task-note">${esc(e.note)}</div>` : ''}<span class="task-source">${e.source === 'handmatig' ? 'handmatig' : e.source === 'foto' ? 'via foto' : 'via beschrijving'}</span></div><button class="icon-btn task-del" data-id="${esc(e.id)}" aria-label="Verwijderen"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-8 0 1 12a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-12"></path></svg></button></li>`
  }).join('')
  ul.querySelectorAll('.task-check').forEach(btn => btn.addEventListener('click', async () => {
    const { error } = await dbWrite('update', 'entries', { id: btn.dataset.id, data: { op_fysiek_bord: true } })
    if (error) toast('Kon niet bijwerken.'); else { toast('Overgezet op het bord.'); loadEntries() }
  }))
  ul.querySelectorAll('.task-del').forEach(btn => btn.addEventListener('click', () => {
    const entry = state.entries.find(e => e.id === btn.dataset.id)
    if (entry) deleteOneWithUndo('entries', entry.id, entryToRow(entry), 'item').then(loadEntries)
  }))
}

$('clearBoard').addEventListener('click', () => {
  const pending = state.entries.filter(e => !e.opFysiekBord)
  deleteManyWithUndo('entries', pending.map(e => ({ id: e.id, ...entryToRow(e) })), 'takenlijst gewist').then(loadEntries)
})

function whoList(e) { return e.who ? e.who.split(',').map(s => s.trim()) : [] }
function entryHasWho(e, col) { return whoList(e).includes(col) }

// ── week table ──
function entryMatchesDay(e, dName, dStr) {
  if (e.skipDates && e.skipDates.indexOf(dStr) >= 0) return false
  if (e.type === 'eenmalig') return e.date === dStr
  if (e.type === 'jaarlijks') return !!e.date && monthDay(e.date) === monthDay(dStr)
  if (e.type === 'periode') return !!e.date && !!e.endDate && dStr >= e.date && dStr <= e.endDate
  if (e.weekday !== dName) return false
  if (e.endDate && dStr > e.endDate) return false
  return true
}

function showTimeForDay(e, dStr) {
  if (!e.time) return ''
  if (e.type === 'periode' && e.date !== dStr) return ''
  return e.time
}

function entryIconHtml(e, col) {
  if (col === 'Algemeen' && e.category === 'eten') return '<svg class="ci-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3v7a2 2 0 0 0 2 2v9M6 3v7M9 3v7M15 3c-1.5 0-2 2-2 4s.5 4 2 4v10"></path></svg>'
  if (col === 'Algemeen') return ''
  return ''
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
      await deleteOneWithUndo('entries', id, entryToRow(entry), 'item')
      loadEntries()
    }
  } else {
    await deleteOneWithUndo('entries', id, entryToRow(entry), 'item')
    loadEntries()
  }
}

function renderWeek() {
  const days = getWeekDays(state.weekOffset)
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
    if (col === 'Algemeen') return `<th class="${cls}" data-col="${esc(col)}" style="color:var(--ink-soft);border-bottom:3px dashed var(--border);">Algemeen</th>`
    const c = hueColors(FAMILY_HUE[col])
    return `<th class="${cls}" data-col="${esc(col)}" style="color:${c.fg};border-bottom:3px solid ${c.fg};">${esc(col)}</th>`
  }).join('') + '</tr></thead>'

  const rows = days.map(day => {
    const dName = dayNameOf(day), dStr = ymd(day), isToday = dStr === todayStr
    const tds = visibleCols.map(col => {
      const items = state.entries.filter(e => entryHasWho(e, col) && entryMatchesDay(e, dName, dStr))
        .sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'))
      const body = items.map(e => {
        const t = showTimeForDay(e, dStr)
        return `<div class="ci" data-id="${esc(e.id)}" title="${esc(entryTooltip(e))}">${entryIconHtml(e, col)}<span class="ci-dot ${e.opFysiekBord ? 'on-bord' : 'pending'}" title="${e.opFysiekBord ? 'Staat op het bord' : 'Nog overzetten'}"></span>${t ? `<span class="ci-time mono">${esc(t)}</span>` : ''}<span class="ci-title">${esc(e.title)}</span>${e.note ? '<svg class="ci-note" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>' : ''}<button class="ci-del" data-id="${esc(e.id)}" data-date="${esc(dStr)}" aria-label="Verwijderen">×</button></div>`
      }).join('')
      return '<td>' + body + '</td>'
    }).join('')
    return `<tr class="${isToday ? 'is-today' : ''}"><td class="day-td"><div class="day-abbr">${DAY_ABBR[dName]}</div><div class="day-num mono">${shortDate(day)}</div><button class="day-add" data-date="${esc(dStr)}" data-dayname="${esc(dName)}" aria-label="Item toevoegen op ${DAY_LABELS[dName]}">+</button></td>${tds}</tr>`
  }).join('')

  const table = $('weekTable')
  table.innerHTML = theadHtml + '<tbody>' + rows + '</tbody>'
  table.style.minWidth = state.filterWho ? '0' : ''
  table.querySelectorAll('thead th[data-col]').forEach(th => {
    th.title = state.filterWho === th.dataset.col ? 'Klik om iedereen te tonen' : 'Klik om alleen ' + th.dataset.col + ' te tonen'
    th.addEventListener('click', () => { state.filterWho = state.filterWho === th.dataset.col ? null : th.dataset.col; renderWeek() })
  })
  table.querySelectorAll('.ci-del').forEach(btn => btn.addEventListener('click', ev => { ev.stopPropagation(); handleEntryDeleteClick(btn.dataset.id, btn.dataset.date) }))
  table.querySelectorAll('.ci[data-id]').forEach(div => div.addEventListener('click', () => openEditEntry(div.dataset.id)))
  table.querySelectorAll('.day-add').forEach(btn => btn.addEventListener('click', () => openItemForDay(btn.dataset.date, btn.dataset.dayname)))

  renderWeekAgenda(days, todayStr)
}

function renderWeekAgenda(days, todayStr) {
  const wrap = $('weekAgenda'); if (!wrap) return
  wrap.innerHTML = days.map(day => {
    const dName = dayNameOf(day), dStr = ymd(day), isToday = dStr === todayStr
    const items = state.entries.filter(e => entryMatchesDay(e, dName, dStr))
      .sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'))
    const itemsHtml = items.length === 0
      ? '<li class="agenda-empty">Niets gepland</li>'
      : items.map(e => {
          const t = showTimeForDay(e, dStr)
          const names = whoList(e)
          const chips = (e.category === 'eten' ? [] : names).map(n => chipHtml(n)).join('')
          return `<li class="agenda-item" data-id="${esc(e.id)}" title="${esc(entryTooltip(e))}">${entryIconHtml(e, names[0])}${chips}${t ? `<span class="agenda-time mono">${esc(t)}</span>` : ''}<span class="agenda-title">${esc(e.title)}</span>${e.note ? '<svg class="ci-note" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>' : ''}<span class="ci-dot ${e.opFysiekBord ? 'on-bord' : 'pending'}"></span><button class="agenda-del" data-id="${esc(e.id)}" data-date="${esc(dStr)}" aria-label="Verwijderen">×</button></li>`
        }).join('')
    return `<div class="agenda-day${isToday ? ' is-today' : ''}"><div class="agenda-day-head"><span class="agenda-day-name">${DAY_LABELS[dName]}</span><span class="agenda-day-date mono">${shortDate(day)}</span><button class="agenda-day-add" data-date="${esc(dStr)}" data-dayname="${esc(dName)}" aria-label="Item toevoegen">+</button></div><ul class="agenda-items">${itemsHtml}</ul></div>`
  }).join('')
  wrap.querySelectorAll('.agenda-del').forEach(btn => btn.addEventListener('click', ev => { ev.stopPropagation(); handleEntryDeleteClick(btn.dataset.id, btn.dataset.date) }))
  wrap.querySelectorAll('.agenda-item[data-id]').forEach(li => li.addEventListener('click', () => openEditEntry(li.dataset.id)))
  wrap.querySelectorAll('.agenda-day-add').forEach(btn => btn.addEventListener('click', () => openItemForDay(btn.dataset.date, btn.dataset.dayname)))
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

// ── tabs ──
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    const view = btn.dataset.view
    document.querySelectorAll('.tab').forEach(b => { b.classList.toggle('is-active', b === btn); b.setAttribute('aria-selected', b === btn ? 'true' : 'false') })
    ;['week', 'groceries', 'board'].forEach(v => $('view-' + v).hidden = v !== view)
    if (view === 'board') markNewAsSeen()
  })
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
function hideAllPanels() { itemPanel.hidden = true; groceryPanel.hidden = true; dinnerPanel.hidden = true }
$('btnNewItem').addEventListener('click', () => { const was = itemPanel.hidden; hideAllPanels(); state.addForDate = null; state.editId = null; if (was) { resetItemPanel(); itemPanel.hidden = false } })

function openItemForDay(dateStr, dayName) {
  hideAllPanels()
  state.addForDate = { date: dateStr, dayName }
  resetItemPanel()
  itemPanel.hidden = false
  itemPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  const el = $('quick-text')
  el.placeholder = 'Item voor ' + DAY_LABELS[dayName] + '…'
}
function openEditEntry(id) {
  const e = state.entries.find(x => x.id === id)
  if (!e) return
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
  if (e.reminderMinutes != null) $('f-reminder').value = String(e.reminderMinutes)
  $('f-submit').textContent = 'Opslaan'
  $('f-back').hidden = true
  itemPanel.hidden = false
  focusSoon('f-title')
}

$('quick-cancel').addEventListener('click', () => itemPanel.hidden = true)
$('f-cancel').addEventListener('click', () => itemPanel.hidden = true)
$('f-back').addEventListener('click', () => { $('itemForm').hidden = true; $('quickAddBox').hidden = false; focusSoon('quick-text') })
$('quick-manual').addEventListener('click', () => {
  $('itemForm').reset(); setTimePicker(''); $('categoryField').hidden = true; $('quick-hint').hidden = true
  if (state.addForDate) {
    $('typeOnce').click()
    $('f-date').value = state.addForDate.date
  } else {
    $('typeWeekly').click()
  }
  if (state.currentUser) setWho(state.currentUser)
  $('quickAddBox').hidden = true; $('itemForm').hidden = false; focusSoon('f-title')
})

$('quick-parse').addEventListener('click', async () => {
  const text = $('quick-text').value.trim()
  if (!text) { toast('Typ eerst wat je wilt toevoegen.'); return }
  const btn = $('quick-parse')
  btn.disabled = true; btn.textContent = 'Bezig…'
  try {
    const parseBody = { text, password: localStorage.getItem('wp-auth') }
    if (state.addForDate) parseBody.contextDate = state.addForDate.date
    if (state.currentUser) parseBody.currentUser = state.currentUser
    const resp = await fetch('/api/parse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(parseBody) })
    if (!resp.ok) throw new Error('API error')
    const d = await resp.json()
    $('itemForm').reset(); setTimePicker('')
    if (d.title) $('f-title').value = d.title
    if (d.who) setWho(d.who)
    if (d.time) setTimePicker(d.time)
    if (d.note) $('f-note').value = d.note
    if (d.date) $('f-date').value = d.date
    if (d.end_date) $('f-enddate').value = d.end_date
    if (d.weekday) $('f-weekday').value = d.weekday
    const typeMap = { wekelijks: typeWeekly, jaarlijks: typeYearly, eenmalig: typeOnce, periode: typePeriod }
    const typeBtn = typeMap[d.type] || typeWeekly
    typeBtn.click()
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
const weekdayField = $('weekdayField'), weekdayRow = $('weekdayRow'), endDateField = $('endDateField')
const endDateFieldLabel = $('endDateFieldLabel'), dateField = $('dateField'), dateFieldLabel = $('dateFieldLabel'), dateFieldHint = $('dateFieldHint')

function setTypeButtons(active) { [typeWeekly, typeYearly, typeOnce, typePeriod].forEach(b => b.classList.toggle('is-active', b === active)) }
function restoreFieldOrder() { weekdayRow.parentNode.insertBefore(weekdayRow, dateField) }

typeWeekly.addEventListener('click', () => { state.addType = 'wekelijks'; setTypeButtons(typeWeekly); restoreFieldOrder(); weekdayRow.style.gridTemplateColumns = ''; weekdayField.hidden = false; endDateField.hidden = false; dateField.hidden = true; endDateFieldLabel.textContent = 'Tot en met (optioneel)'; dateFieldHint.hidden = true })
typeYearly.addEventListener('click', () => { state.addType = 'jaarlijks'; setTypeButtons(typeYearly); restoreFieldOrder(); weekdayField.hidden = true; endDateField.hidden = true; dateField.hidden = false; dateFieldLabel.textContent = 'Datum (dit jaar)'; dateFieldHint.hidden = false; $('f-enddate').value = '' })
typeOnce.addEventListener('click', () => { state.addType = 'eenmalig'; setTypeButtons(typeOnce); restoreFieldOrder(); weekdayField.hidden = true; endDateField.hidden = true; dateField.hidden = false; dateFieldLabel.textContent = 'Datum'; dateFieldHint.hidden = true; $('f-enddate').value = '' })
typePeriod.addEventListener('click', () => { state.addType = 'periode'; setTypeButtons(typePeriod); dateField.parentNode.insertBefore(dateField, weekdayRow); weekdayField.hidden = true; weekdayRow.style.gridTemplateColumns = '1fr'; endDateField.hidden = false; endDateFieldLabel.textContent = 'Tot en met'; dateField.hidden = false; dateFieldLabel.textContent = 'Vanaf'; dateFieldHint.hidden = true })

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

  const submitBtn = $('f-submit'); submitBtn.disabled = true
  const row = {
    title, who, type: state.addType,
    weekday: state.addType === 'wekelijks' ? weekday : null,
    date: (state.addType === 'eenmalig' || state.addType === 'jaarlijks' || state.addType === 'periode') ? date : null,
    end_date: (state.addType === 'wekelijks' && endDate) ? endDate : (state.addType === 'periode' ? endDate : null),
    time: time || '', note, category,
    reminder_minutes: reminderVal !== '' ? parseInt(reminderVal) : null
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
async function addGroceryItem(naam) {
  const { error } = await dbWrite('insert', 'boodschappen', { data: { naam, afgevinkt: false } })
  if (error) { toast('Toevoegen mislukt.'); return }
  toast('Toegevoegd aan boodschappenlijst.'); loadGroceries()
}

$('btnNewGrocery').addEventListener('click', () => { const was = groceryPanel.hidden; hideAllPanels(); groceryPanel.hidden = !was; if (!groceryPanel.hidden) focusSoon('gq-input') })
$('gq-cancel').addEventListener('click', () => groceryPanel.hidden = true)
$('groceryQuickForm').addEventListener('submit', ev => { ev.preventDefault(); const v = $('gq-input').value.trim(); if (!v) return; addGroceryItem(v).then(() => { $('gq-input').value = ''; groceryPanel.hidden = true }) })
$('groceryForm').addEventListener('submit', ev => { ev.preventDefault(); const v = $('g-input').value.trim(); if (!v) return; addGroceryItem(v).then(() => { $('g-input').value = '' }) })
$('clearGroceries').addEventListener('click', () => { if (state.groceries.length === 0) { toast('Lijst is al leeg.'); return }; deleteManyWithUndo('boodschappen', state.groceries, 'boodschappenlijst gewist').then(loadGroceries) })
$('clearCheckedGroceries').addEventListener('click', () => { const checked = state.groceries.filter(g => g.afgevinkt); if (checked.length === 0) { toast('Nog niets afgevinkt.'); return }; deleteManyWithUndo('boodschappen', checked, 'afgevinkte items gewist').then(loadGroceries) })

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

// ── photo OCR ──
$('btnPhoto').addEventListener('click', () => { photoPanel.hidden = !photoPanel.hidden })
$('photo-cancel').addEventListener('click', () => { photoPanel.hidden = true; $('photo-input').value = ''; $('photo-preview').hidden = true; $('photo-results').hidden = true; $('photo-scan').hidden = true })

$('photo-input').addEventListener('change', (ev) => {
  const file = ev.target.files[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => { $('photo-img').src = reader.result; $('photo-preview').hidden = false; $('photo-scan').hidden = false; $('photo-status').textContent = '' }
  reader.readAsDataURL(file)
})

$('photo-scan').addEventListener('click', async () => {
  const file = $('photo-input').files[0]
  if (!file) { toast('Kies eerst een foto.'); return }
  const btn = $('photo-scan')
  btn.disabled = true; btn.textContent = 'Bezig met herkennen…'; $('photo-status').textContent = 'Even geduld, AI leest de foto…'
  try {
    const dataUrl = $('photo-img').src
    const [header, base64] = dataUrl.split(',')
    const mimeType = header.match(/:(.*?);/)[1]
    const resp = await fetch('/api/ocr', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageBase64: base64, mimeType, password: localStorage.getItem('wp-auth') }) })
    if (!resp.ok) throw new Error('API error')
    const data = await resp.json()
    $('photo-status').textContent = data.summary || 'Klaar.'
    const entries = data.entries || []
    if (entries.length === 0) { $('photo-results').innerHTML = '<p class="panel-sub">Geen items gevonden op de foto.</p>'; $('photo-results').hidden = false; return }
    $('photo-results').innerHTML = '<p class="panel-sub" style="margin-bottom:6px">Gevonden items — klik om toe te voegen:</p>' +
      entries.map((e, i) => '<button type="button" class="btn btn-ghost btn-sm photo-add-entry" data-idx="' + i + '" style="margin:2px">' + esc(e.title) + ' (' + esc(e.who || 'Algemeen') + ')' + (e.time ? ' ' + esc(e.time) : '') + '</button>').join('')
    $('photo-results').hidden = false
    $('photo-results').querySelectorAll('.photo-add-entry').forEach(b => {
      b.addEventListener('click', async () => {
        const e = entries[parseInt(b.dataset.idx)]
        const row = { title: e.title, who: e.who || 'Algemeen', type: e.type || 'eenmalig', weekday: e.weekday || null, date: e.date || null, end_date: e.end_date || null, time: e.time || '', note: e.note || '', category: null, source: 'foto', op_fysiek_bord: false, photo_id: data.photoId || null }
        const { error } = await dbWrite('insert', 'entries', { data: row })
        if (error) { toast('Toevoegen mislukt.'); return }
        b.disabled = true; b.style.opacity = '0.4'; b.textContent += ' ✓'
        toast(e.title + ' toegevoegd.'); loadEntries()
      })
    })
  } catch (e) {
    toast('Foto kon niet worden verwerkt.')
    $('photo-status').textContent = 'Er ging iets mis.'
  } finally { btn.disabled = false; btn.textContent = 'Scan foto' }
})

function renderGroceries() {
  const ul = $('groceryList'), empty = $('groceryEmpty')
  if (state.groceries.length === 0) { ul.innerHTML = ''; empty.hidden = false; return }
  empty.hidden = true
  const sorted = state.groceries.slice().sort((a, b) => { if (!!a.afgevinkt !== !!b.afgevinkt) return a.afgevinkt ? 1 : -1; return (a.createdAt || '').localeCompare(b.createdAt || '') })
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
    if (item) { await deleteOneWithUndo('boodschappen', item.id, { naam: item.naam, afgevinkt: item.afgevinkt }, 'boodschap'); loadGroceries() }
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
    if (fav) { await deleteOneWithUndo('favorieten', fav.id, { naam: fav.naam }, 'favoriet'); loadFavorites() }
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

// ── reminders (browser notifications) ──
const firedReminders = new Set()
function checkReminders() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  const now = new Date()
  const todayStr = ymd(now), nowMinutes = now.getHours() * 60 + now.getMinutes()
  const dName = dayNameOf(now)
  state.entries.forEach(e => {
    if (e.reminderMinutes == null || !e.time) return
    if (!entryMatchesDay(e, dName, todayStr)) return
    const [h, m] = e.time.split(':').map(Number)
    const eventMinutes = h * 60 + m
    const fireAt = eventMinutes - e.reminderMinutes
    if (nowMinutes === fireAt && !firedReminders.has(e.id + todayStr)) {
      firedReminders.add(e.id + todayStr)
      const label = e.reminderMinutes === 0 ? 'Nu' : e.reminderMinutes < 60 ? e.reminderMinutes + ' min' : e.reminderMinutes === 60 ? '1 uur' : '1 dag'
      new Notification('Weekplanner', { body: (label === 'Nu' ? '' : label + ': ') + e.title + ' (' + e.who + ') om ' + e.time, icon: '📋' })
    }
  })
}
function initReminders() {
  if (!('Notification' in window)) return
  if (Notification.permission === 'default') Notification.requestPermission()
  setInterval(checkReminders, 60000)
  checkReminders()
}

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

function skipLogin(user) { state.currentUser = user; document.documentElement.dataset.user = user; loginOverlay.hidden = true; init() }

async function tryLogin() {
  const pass = $('loginPass').value
  if (!pass || !selectedMember) return
  $('loginSubmit').disabled = true; $('loginSubmit').textContent = '…'
  try {
    const resp = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pass }) })
    const ct = resp.headers.get('content-type') || ''
    if (!ct.includes('json')) { skipLogin(selectedMember); return }
    if (resp.ok) {
      localStorage.setItem('wp-auth', pass)
      localStorage.setItem('wp-user', selectedMember)
      skipLogin(selectedMember)
    } else { $('loginError').hidden = false }
  } catch { $('loginError').hidden = false }
  $('loginSubmit').disabled = false; $('loginSubmit').textContent = 'Open'
}

$('loginSubmit').addEventListener('click', tryLogin)
$('loginPass').addEventListener('keydown', (e) => { if (e.key === 'Enter') tryLogin() })

// ── push subscription ──
const pushPromptEl = $('pushPrompt'), pushEnableBtn = $('pushEnable'), pushDismissBtn = $('pushDismiss')

function showPushPrompt() {
  if (state.currentUser !== 'Merel') return
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
      body: JSON.stringify({ password, subscription: sub.toJSON(), user: 'Merel' })
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

// ── init ──
async function init() {
  await Promise.all([loadEntries(), loadGroceries(), loadFavorites()])
  subscribeRealtime()
  renderWeek()
  initReminders()
  showPushPrompt()
  if (state.currentUser) {
    setWho(state.currentUser)
  }
  const hint = $('swipeHint')
  if (hint && localStorage.getItem('wp-swipe-seen')) hint.hidden = true
}

;(async function boot() {
  const savedPass = localStorage.getItem('wp-auth')
  const savedUser = localStorage.getItem('wp-user')
  if (savedPass && savedUser) {
    try {
      const resp = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: savedPass }) })
      const ct = resp.headers.get('content-type') || ''
      if (!ct.includes('json') || resp.ok) return skipLogin(savedUser)
    } catch {}
  }
})()
