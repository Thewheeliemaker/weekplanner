import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { checkPassword } from './_lib/auth.js'
import { amsterdamNow } from './_lib/time.js'

// Several screenshots per request: allow a bigger body and enough time for the parallel calls
export const config = { api: { bodyParser: { sizeLimit: '8mb' } }, maxDuration: 60 }

const MAX_IMAGES = 12
const MODEL = 'claude-opus-5-5'

// Structured output: one object per screenshot
const SHIFTS_SCHEMA = {
  type: 'object',
  properties: {
    selected_date: { type: 'string', description: 'YYYY-MM-DD of the day this screenshot shows (the selected day), or empty if unclear' },
    person_found: { type: 'boolean', description: 'Whether the requested person appears on this screenshot' },
    shifts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD' },
          start: { type: 'string', description: 'HH:MM, 24h' },
          end: { type: 'string', description: 'HH:MM, 24h, or empty if not shown' },
          department: { type: 'string', description: 'Department or shift label, e.g. AGF, or empty' },
          day_off: { type: 'boolean' }
        },
        required: ['date', 'start', 'end', 'department', 'day_off'],
        additionalProperties: false
      }
    },
    note: { type: 'string', description: 'Short remark if something was unclear, otherwise empty' }
  },
  required: ['selected_date', 'person_found', 'shifts', 'note'],
  additionalProperties: false
}

function systemPrompt(who, now) {
  return `Je leest screenshots van werkrooster-apps voor een gezinsplanner. Vandaag is ${now.date} (${now.weekday}).

Doel: haal ALLEEN de diensten van ${who} uit de screenshot. Het rooster toont vaak meerdere collega's onder elkaar; neem uitsluitend de blokken die onder de naam van ${who} staan (de voornaam "${who}" gevolgd door een achternaam, bijvoorbeeld "${who} van Doorn"). Diensten van andere mensen negeer je volledig.

De datum bepalen:
- Bovenaan staan maand en jaar (bijv. "november 2026") en een weekstrip met dagnummers, soms met het weeknummer ervoor.
- De GESELECTEERDE dag heeft een omlijnd kader (vierkant met rand). De diensten op de screenshot horen bij die dag.
- Een GEVULDE gekleurde cirkel is alleen "vandaag" en zegt niets over de getoonde diensten, tenzij er geen ander kader is.
- Combineer het dagnummer met maand en jaar uit de kop. Valt het dagnummer in een week die over de maandgrens loopt (bijv. 30, 31, 1, 2), kies dan de maand die bij die positie in de weekstrip past.

Tijden: "07:00 - 14:00 | 00:45" betekent start 07:00, eind 14:00, 45 minuten pauze (pauze negeren). Gebruik 24-uursnotatie HH:MM.
Staat ${who} er niet op, geef dan person_found=false en een lege shifts-lijst. Staat er "vrij" of verlof bij ${who}, zet day_off=true.`
}

async function readOne(client, img, who, now) {
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: systemPrompt(who, now),
    output_config: { format: { type: 'json_schema', schema: SHIFTS_SCHEMA } },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: img.mimeType, data: img.data } },
        { type: 'text', text: `Welke diensten heeft ${who} op deze screenshot?` }
      ]
    }]
  })
  if (response.stop_reason === 'refusal') return { error: 'geweigerd' }
  const text = response.content.find(b => b.type === 'text')?.text || ''
  try { return JSON.parse(text) } catch { return { error: 'onleesbaar antwoord' } }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  const { images, imageBase64, mimeType, who, password } = req.body || {}
  if (!checkPassword(password)) return res.status(401).json({ error: 'Unauthorized' })
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'API key not configured' })

  // Accept the new multi-image shape and the old single-image one
  const list = Array.isArray(images) ? images : (imageBase64 && mimeType ? [{ data: imageBase64, mimeType }] : [])
  if (list.length === 0) return res.status(400).json({ error: 'Geen screenshots ontvangen' })
  if (list.length > MAX_IMAGES) return res.status(400).json({ error: `Maximaal ${MAX_IMAGES} screenshots tegelijk` })
  if (!who || typeof who !== 'string') return res.status(400).json({ error: 'Kies voor wie het rooster is' })

  // Rate limit: each screenshot counts as one AI request
  const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  const hourAgo = new Date(Date.now() - 3600000).toISOString()
  const { count } = await supabase.from('api_usage').select('*', { count: 'exact', head: true }).gt('created_at', hourAgo)
  if ((count || 0) + list.length > 60) return res.status(429).json({ error: 'Te veel scans dit uur (max 60 screenshots per uur)' })
  await supabase.from('api_usage').insert(list.map(() => ({ endpoint: 'ocr' })))

  const client = new Anthropic()
  const now = amsterdamNow()
  const results = await Promise.all(list.map(img =>
    readOne(client, img, who, now).catch(e => ({ error: e instanceof Anthropic.APIError ? `API-fout ${e.status}` : e.message }))
  ))

  // Merge, drop duplicates (same date + start), sort by date/time
  const seen = new Set(), entries = []
  results.forEach((r, i) => {
    for (const s of (r && r.shifts) || []) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s.date)) continue
      const key = s.date + '|' + (s.day_off ? 'vrij' : s.start)
      if (seen.has(key)) continue
      seen.add(key)
      entries.push({ date: s.date, time: s.day_off ? null : (s.start || null), end_time: s.day_off ? null : (s.end || null), title: s.day_off ? 'Vrij' : 'Werk', note: s.department || '', screenshot: i + 1 })
    }
  })
  entries.sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')))

  const perImage = results.map((r, i) => ({
    screenshot: i + 1,
    date: (r && r.selected_date) || '',
    found: !!(r && r.person_found),
    error: (r && r.error) || null
  }))
  const missing = perImage.filter(p => !p.error && !p.found).length
  const failed = perImage.filter(p => p.error).length
  const summary = `${list.length} screenshot${list.length === 1 ? '' : 's'} gelezen, ${entries.length} dienst${entries.length === 1 ? '' : 'en'} van ${who} gevonden` +
    (missing ? ` · op ${missing} stond ${who} niet` : '') + (failed ? ` · ${failed} mislukt` : '')

  res.status(200).json({ summary, entries, perImage })
}
