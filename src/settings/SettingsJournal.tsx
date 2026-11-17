import { useCallback, useEffect, useState } from 'react'
import { listAudit, type AuditRow } from './api'

const entityLabels: Record<string, string> = {
  companies: 'Sociétés', contacts: 'Contacts', company_activities: 'Échanges',
  leads: 'Prospects', tenders: 'Appels d’offres', purchase_orders: 'Commandes',
  deliveries: 'Livraisons', invoices: 'Factures', projects: 'Projets',
  activities: 'Activités', appointments: 'Rendez-vous', follow_ups: 'Relances',
  role_permissions: 'Permissions', profiles: 'Utilisateurs', app_settings: 'Paramètres',
  library_categories: 'Catégories', documents: 'Documents',
}

export function SettingsJournal() {
  const [rows, setRows] = useState<AuditRow[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [action, setAction] = useState('')
  const [entity, setEntity] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await listAudit(action, entity, search)
      setRows(result)
      const missing = [...new Set(result.filter(row => row.actor_id).map(row => row.actor_id as string))]
        .filter(id => !names[id])
      if (missing.length > 0) {
        const { supabase } = await import('../lib/supabase')
        if (supabase) {
          const { data } = await supabase.from('profiles').select('id, full_name').in('id', missing)
          if (data) setNames(old => ({ ...old, ...Object.fromEntries((data as { id: string; full_name: string }[]).map(row => [row.id, row.full_name])) }))
        }
      }
      setError(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Chargement impossible.')
    } finally { setLoading(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action, entity, search])

  useEffect(() => { void load() }, [load])

  const actions = [...new Set([...rows.map(row => row.action), 'auth_login', 'auth_logout', 'update', 'insert', 'delete', 'settings_update'])].sort()

  return <div className="set-journal">
    <div className="crm-toolbar">
      <select aria-label="Filtrer par entité" value={entity} onChange={event => setEntity(event.target.value)}>
        <option value="">Toutes les entités</option>
        {Object.entries(entityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <select aria-label="Filtrer par action" value={action} onChange={event => setAction(event.target.value)}>
        <option value="">Toutes les actions</option>
        {actions.map(value => <option key={value} value={value}>{value}</option>)}
      </select>
      <input aria-label="Rechercher une action" placeholder="Rechercher dans les actions." value={search} onChange={event => setSearch(event.target.value)} />
      <button type="button" onClick={() => { setAction(''); setEntity(''); setSearch('') }}>Réinitialiser</button>
    </div>
    <p className="crm-hint">Journal append-only : 100 derniers événements consultables, inchangé et inamovible par les utilisateurs.</p>
    {error && <div className="crm-alert" role="alert">{error}</div>}
    {loading ? <div className="crm-empty">Chargement du journal.</div> : <div className="crm-table-wrap">
      <table className="crm-table">
        <thead><tr><th>Date</th><th>Utilisateur</th><th>Action</th><th>Entité</th><th>Détail</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.id}>
          <td>{new Date(row.created_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
          <td>{row.actor_id ? (names[row.actor_id] ?? `${row.actor_id.slice(0, 8)}…`) : 'Système'}</td>
          <td><strong>{row.action}</strong></td>
          <td>{entityLabels[row.entity_table ?? ''] ?? row.entity_table ?? '—'}</td>
          <td><code className="set-journal-detail">{JSON.stringify(row.changes ?? row.context ?? {})}</code></td>
        </tr>)}
        </tbody>
      </table>
      {rows.length === 0 && <div className="crm-empty">Aucun événement pour ces filtres.</div>}
    </div>}
  </div>
}
