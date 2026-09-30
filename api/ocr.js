import { createClient } from '@supabase/supabase-js'

export const config = { api: { bodyParser: { sizeLimit: '5mb' } } }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  const { imageBase64, mimeType, who, password } = req.body || {}
  if (password !== process.env.APP_PASSWORD) return res.status(401).json({ error: 'Unauthorized' })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' })

  if (!imageBase64 || !mimeType) return res.status(400).json({ error: 'Missing imageBase64 or mimeType' })

  const supabaseForLimit = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY)
  const hourAgo = new Date(Date.now() - 3600000).toISOString()
  const { count } = await supabaseForLimit.from('api_usage').select('*', { count: 'exact', head: true }).gt('created_at', hourAgo)
  if (count >= 60) return res.status(429).json({ error: 'Rate limit: max 60 AI-verzoeken per uur' })
  await supabaseForLimit.from('api_usage').insert({ endpoint: 'ocr' })

  const today = new Date().toISOString().slice(0, 10)
  const year = new Date().getFullYear()
  const dayOfWeek = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'][new Date().getDay()]

  const prompt = `Je bent een assistent die werkroosters leest van screenshots. Vandaag is ${today} (${dayOfWeek}), jaar ${year}.
${who ? 'Dit rooster is van ' + who + '.' : ''}

Bekijk deze screenshot van een werkrooster/planning-app en extraheer alle diensten/shifts. Geef een JSON object terug:

{ "summary": "korte beschrijving van wat je ziet", "entries": [...] }

Elk entry-object heeft:
- title (string): "Werk NAAM" waarbij NAAM de naam van de persoon/medewerker is bij wie de dienst staat (bijv. "Werk Siem van Doorn"). Als er geen naam bij staat, gebruik "Werk" of de werkgever/locatie
- date (string): ISO datum YYYY-MM-DD — leid het jaar af uit context (huidig jaar ${year})
- time (string|null): starttijd HH:MM 24-uurs
- end_time (string|null): eindtijd HH:MM 24-uurs
- note (string|null): extra details (pauze, locatie, etc.)

Regels:
- Extraheer ALLE zichtbare diensten/werkdagen met hun EIGEN datums
- BELANGRIJK over datums in kalender-apps: een GEVULDE gekleurde cirkel rond een datum = vandaag (ter referentie). Een OMLIJND/GEBORDERED vierkantje of lichte markering rond een andere datum = de GESELECTEERDE dag. De diensten die eronder staan horen bij de GESELECTEERDE dag, NIET bij vandaag
- Voorbeeld: als "30" een blauwe cirkel heeft (vandaag) en "1" een vierkant kader heeft (geselecteerd), dan zijn de diensten voor de 1e, niet de 30e
- In veel werk-apps staat de datum bij elke dag/shift — gebruik DIE datum
- Datums zonder jaar: gebruik ${year}, tenzij de maand al voorbij is, gebruik dan ${year + 1}
- Vrije dagen, vakanties of "vrij" ook opnemen met title "Vrij"
- Als je niets kunt lezen, geef een lege entries array
- Geef ALLEEN valid JSON terug, geen uitleg`

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBase64 } },
            { type: 'text', text: 'Lees dit werkrooster en geef alle diensten terug als JSON.' }
          ]
        }],
        system: prompt
      })
    })

    if (!response.ok) {
      const err = await response.text()
      return res.status(502).json({ error: 'Anthropic API error', detail: err })
    }

    const result = await response.json()
    const content = result.content?.[0]?.text || ''
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return res.status(502).json({ error: 'Could not parse AI response', raw: content })

    const parsed = JSON.parse(jsonMatch[0])

    res.status(200).json({ summary: parsed.summary || '', entries: parsed.entries || [] })
  } catch (e) {
    res.status(500).json({ error: 'OCR failed', detail: e.message })
  }
}
