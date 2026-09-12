import { createClient } from '@supabase/supabase-js'

export const config = { api: { bodyParser: { sizeLimit: '5mb' } } }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' })

  const { imageBase64, mimeType } = req.body || {}
  if (!imageBase64 || !mimeType) return res.status(400).json({ error: 'Missing imageBase64 or mimeType' })

  const today = new Date().toISOString().slice(0, 10)
  const dayOfWeek = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'][new Date().getDay()]

  const prompt = `Je bent een OCR-assistent voor een gezinsplanner. Vandaag is ${today} (${dayOfWeek}).

Bekijk deze foto en extraheer alle agenda-items die je ziet. Geef een JSON array terug met objecten:
- title (string): korte titel
- who (string): een van Siem, Mare, Merel, Rick, Algemeen
- type (string): wekelijks, jaarlijks, eenmalig, periode
- weekday (string|null): maandag t/m zondag (alleen bij wekelijks)
- date (string|null): ISO datum YYYY-MM-DD
- end_date (string|null): ISO datum
- time (string|null): HH:MM 24-uurs formaat
- note (string|null): extra info

Regels:
- Als geen persoon te herkennen: who = "Algemeen"
- Probeer het type af te leiden uit context
- Als je niets kunt lezen, geef een lege array []
- Geef ALLEEN valid JSON terug (een array), geen uitleg.
- Geef ook een apart veld "summary" met een korte beschrijving van wat je op de foto ziet.

Formaat: { "summary": "...", "entries": [...] }`

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBase64 } },
            { type: 'text', text: 'Lees deze foto en geef de agenda-items terug als JSON.' }
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

    const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY)
    const photoId = crypto.randomUUID()
    await supabase.from('photos').insert({ id: photoId, status: 'verwerkt', ai_summary: parsed.summary || '' })

    res.status(200).json({ photoId, summary: parsed.summary || '', entries: parsed.entries || [] })
  } catch (e) {
    res.status(500).json({ error: 'OCR failed', detail: e.message })
  }
}
