import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  return createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}

async function createBackup(supabase) {
  const { data: entries, error: fetchErr } = await supabase
    .from('entries')
    .select('*')
    .order('created_at', { ascending: true })
    .limit(10000)
  if (fetchErr) throw new Error(fetchErr.message)

  const { error: insErr } = await supabase.from('backups').insert({
    entries_json: entries,
    entry_count: entries.length
  })
  if (insErr) throw new Error(insErr.message)

  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 14)
  await supabase.from('backups').delete().lt('created_at', cutoff.toISOString())

  return entries.length
}

export default async function handler(req, res) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: 'Service key not configured' })
  const supabase = getSupabase()

  // GET = Vercel cron trigger (weekly auto-backup)
  if (req.method === 'GET') {
    const cronSecret = process.env.CRON_SECRET
    if (cronSecret && req.headers['authorization'] !== 'Bearer ' + cronSecret) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    try {
      const count = await createBackup(supabase)
      return res.status(200).json({ ok: true, entries: count })
    } catch (e) {
      return res.status(500).json({ error: e.message })
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'GET or POST' })

  const { password, action, backupId } = req.body || {}
  if (password !== process.env.APP_PASSWORD) return res.status(401).json({ error: 'Unauthorized' })

  if (action === 'list') {
    const { data: backups } = await supabase
      .from('backups')
      .select('id, created_at, entry_count')
      .order('created_at', { ascending: false })
      .limit(10)
    return res.status(200).json({ backups: backups || [] })
  }

  if (action === 'create') {
    try {
      const count = await createBackup(supabase)
      return res.status(200).json({ ok: true, entries: count })
    } catch (e) {
      return res.status(500).json({ error: e.message })
    }
  }

  if (action === 'restore') {
    if (!backupId) return res.status(400).json({ error: 'Missing backupId' })
    const { data: backup, error: bErr } = await supabase
      .from('backups')
      .select('entries_json')
      .eq('id', backupId)
      .single()
    if (bErr || !backup) return res.status(404).json({ error: 'Backup niet gevonden' })

    const { error: delErr } = await supabase.from('entries').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    if (delErr) return res.status(500).json({ error: 'Kon entries niet wissen: ' + delErr.message })

    const rows = backup.entries_json.map(e => { const { id, ...rest } = e; return rest })
    if (rows.length > 0) {
      const { error: insErr } = await supabase.from('entries').insert(rows)
      if (insErr) return res.status(500).json({ error: 'Herstellen mislukt: ' + insErr.message })
    }
    return res.status(200).json({ ok: true, restored: rows.length })
  }

  return res.status(400).json({ error: 'Unknown action' })
}
