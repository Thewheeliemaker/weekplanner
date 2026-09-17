import { createClient } from '@supabase/supabase-js'

const ALLOWED_TABLES = ['entries', 'boodschappen', 'favorieten', 'photos']

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  const { password, action, table, data, id, ids } = req.body || {}

  if (password !== process.env.APP_PASSWORD) return res.status(401).json({ error: 'Unauthorized' })
  if (!ALLOWED_TABLES.includes(table)) return res.status(400).json({ error: 'Invalid table' })

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) return res.status(500).json({ error: 'Service key not configured' })

  const supabase = createClient(process.env.VITE_SUPABASE_URL, serviceKey)

  try {
    let result
    if (action === 'insert') {
      if (!data) return res.status(400).json({ error: 'Missing data' })
      const rows = Array.isArray(data) ? data : [data]
      result = await supabase.from(table).insert(rows).select()
    } else if (action === 'update' && id) {
      if (!data) return res.status(400).json({ error: 'Missing data' })
      result = await supabase.from(table).update(data).eq('id', id).select()
    } else if (action === 'delete' && id) {
      result = await supabase.from(table).delete().eq('id', id)
    } else if (action === 'delete_many' && ids && Array.isArray(ids)) {
      result = await supabase.from(table).delete().in('id', ids)
    } else {
      return res.status(400).json({ error: 'Invalid action/params' })
    }

    if (result.error) return res.status(400).json({ error: result.error.message })
    res.status(200).json({ ok: true, data: result.data })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
