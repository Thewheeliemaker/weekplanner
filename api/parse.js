export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  const { text } = req.body || {}
  if (!text || typeof text !== 'string' || text.length > 300) return res.status(400).json({ error: 'Invalid input' })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' })

  const today = new Date().toISOString().slice(0, 10)
  const dayOfWeek = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'][new Date().getDay()]

  const prompt = `Je bent een parser voor een gezinsplanner. Vandaag is ${today} (${dayOfWeek}).

De gebruiker typt een beschrijving van een agenda-item. Geef een JSON object terug met:
- title (string): korte titel
- who (string): een van Siem, Mare, Merel, Rick, Algemeen
- type (string): wekelijks, jaarlijks, eenmalig, periode
- weekday (string|null): maandag t/m zondag (alleen bij wekelijks)
- date (string|null): ISO datum YYYY-MM-DD (bij eenmalig, jaarlijks, periode)
- end_date (string|null): ISO datum (bij periode of wekelijks met einddatum)
- time (string|null): HH:MM 24-uurs formaat
- note (string|null): extra informatie

Regels:
- Als geen persoon genoemd: who = "Algemeen"
- "elke dinsdag" → type = wekelijks, weekday = dinsdag
- "tot eind oktober" → end_date = laatste dag van oktober dit jaar
- Verjaardagen → type = jaarlijks
- Datumbereik → type = periode
- Geef ALLEEN valid JSON terug, geen uitleg.`

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{ role: 'user', content: text }],
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
    if (!jsonMatch) return res.status(502).json({ error: 'Could not parse AI response' })

    const parsed = JSON.parse(jsonMatch[0])
    res.status(200).json(parsed)
  } catch (e) {
    res.status(500).json({ error: 'Parse failed', detail: e.message })
  }
}
