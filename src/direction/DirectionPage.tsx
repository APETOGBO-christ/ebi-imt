import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { xof } from '../lib/utils'
import { Building2, UsersRound, Gavel, ShoppingBag, WalletCards, FolderOpen } from 'lucide-react'

interface Kpi { label: string; value: string; icon: typeof Building2; tone: string; to: string }
interface EventRow { id: string; actor_id: string | null; action: string; entity_table: string | null; created_at: string }

async function countOf(table: string, query?: (q: any) => any): Promise<number> {
  if (!supabase) throw new Error('Connexion Supabase non configurée.')
  let q = supabase.from(table).select('id', { count: 'exact', head: true })
  if (query) q = query(q)
  const { count, error } = await q
  if (error) throw new Error(error.message)
  return count ?? 0
}

async function loadKpis() {
  const [companies, leads, tenders, orders, pendingPayments, documents] = await Promise.all([
    countOf('companies'),
    countOf('leads', q => q.neq('status', 'unqualified')),
    countOf('tenders'),
    countOf('orders'),
    countOf('payments', q => q.eq('status', 'pending')),
    countOf('documents', q => q.is('deleted_at', null)),
  ])
  return { companies, leads, tenders, orders, pendingPayments, documents }
}

async function loadEvents(): Promise<EventRow[]> {
  if (!supabase) throw new Error('Connexion Supabase non configurée.')
  const { data, error } = await supabase.from('audit_logs')
    .select('id, actor_id, action, entity_table, created_at')
    .order('created_at', { ascending: false })
    .limit(15)
  if (error) throw new Error(error.message)
  return (data ?? []) as EventRow[]
}

async function loadConfirmed(): Promise<string> {
  if (!supabase) throw new Error('Connexion Supabase non configurée.')
  const { data, error } = await supabase.from('payments').select('amount_xof').eq('status', 'confirmed')
  if (error) throw new Error(error.message)
  const total = ((data ?? []) as { amount_xof: number | string }[]).reduce((sum, row) => sum + Number(row.amount_xof ?? 0), 0)
  return xof.format(total)
}

const entityShort: Record<string, string> = {
  companies: 'société', contacts: 'contact', leads: 'prospect', tenders: 'appel d’offres',
  purchase_orders: 'commande', deliveries: 'livraison', invoices: 'facture', projects: 'projet',
  role_permissions: 'permissions', profiles: 'utilisateur', app_settings: 'paramètres',
  library_categories: 'catégorie', documents: 'document',
}
const actionShort: Record<string, string> = {
  insert: 'création', update: 'modification', delete: 'suppression',
  auth_login: 'connexion', auth_logout: 'déconnexion', role_change: 'changement de rôle',
}

export function DirectionPage() {
  const { profile } = useAuth()
  const allowed = profile?.role === 'admin' || profile?.role === 'direction'
  const [kpis, setKpis] = useState<Awaited<ReturnType<typeof loadKpis>> | null>(null)
  const [confirmed, setConfirmed] = useState<string | null>(null)
  const [events, setEvents] = useState<EventRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!allowed) return
    let active = true
    setLoading(true)
    Promise.all([loadKpis(), loadConfirmed(), loadEvents()])
      .then(([k, total, rows]) => { if (active) { setKpis(k); setConfirmed(total); setEvents(rows); setError(null) } })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Chargement impossible.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [allowed])

  if (!allowed) return <div className="crm-page"><div className="crm-alert" role="alert">La vue direction est réservée à la direction et à l’administration.</div></div>

  const kpiList: Kpi[] = [
    { label: 'Sociétés au référentiel', value: String(kpis?.companies ?? '…'), icon: Building2, tone: 'blue', to: '/societes' },
    { label: 'Prospects actifs', value: String(kpis?.leads ?? '…'), icon: UsersRound, tone: 'blue', to: '/prospects' },
    { label: 'Appels d’offres', value: String(kpis?.tenders ?? '…'), icon: Gavel, tone: 'blue', to: '/appels-offres' },
    { label: 'Commandes', value: String(kpis?.orders ?? '…'), icon: ShoppingBag, tone: 'blue', to: '/commandes' },
    { label: 'Encaissements vérifiés', value: confirmed ?? '…', icon: WalletCards, tone: 'green', to: '/paiements' },
    { label: 'Paiements à valider', value: String(kpis?.pendingPayments ?? '…'), icon: WalletCards, tone: 'amber', to: '/paiements/a-verifier' },
    { label: 'Documents actifs', value: String(kpis?.documents ?? '…'), icon: FolderOpen, tone: 'blue', to: '/bibliotheque' },
  ]

  return <div className="crm-page">
    <div className="crm-page-head"><div><span className="section-kicker">VUE DIRECTION</span><h1>Vue direction</h1><p>Lecture transversale de tous les modules : la direction observe l’activité sans droits de modification automatiques.</p></div></div>
    {error && <div className="crm-alert" role="alert">{error}</div>}
    {loading ? <div className="crm-empty">Chargement de la vue transversale.</div> : <>
      <div className="kpi-strip" aria-label="Indicateurs transversaux">{kpiList.map(item => <Link className="kpi-item" to={item.to} key={item.label}>
        <span className={`kpi-icon ${item.tone}`}><item.icon size={19} strokeWidth={2} /></span>
        <div><span className="kpi-label">{item.label}</span><strong className="kpi-value">{item.value}</strong></div>
      </Link>)}</div>
      <div className="crm-section-head"><h2>Derniers événements du journal</h2><Link to="/parametres">Journal complet</Link></div>
      <div className="crm-table-wrap">
        <table className="crm-table">
          <thead><tr><th>Date</th><th>Événement</th></tr></thead>
          <tbody>{events.map(row => <tr key={row.id}>
            <td>{new Date(row.created_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
            <td><strong>{actionShort[row.action] ?? row.action}</strong>{row.entity_table ? ` — ${entityShort[row.entity_table] ?? row.entity_table}` : ''}</td>
          </tr>)}
          </tbody>
        </table>
        {events.length === 0 && <div className="crm-empty">Aucun événement journalisé.</div>}
      </div>
    </>}
  </div>
}
