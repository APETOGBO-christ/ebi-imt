import { useCallback, useEffect, useState } from 'react'
import { MonitorPlay } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { usePermits } from '../lib/permissions'
import { xof } from '../lib/utils'

export interface ProductionRow {
  id: string
  order_id: string
  responsible_id: string | null
  status: string
  planned_start_at: string | null
  planned_delivery_at: string | null
  actual_start_at: string | null
  actual_delivery_at: string | null
  notes: string | null
  orders: { order_number: string; amount_xof: string | number; companies: { legal_name: string; trade_name: string | null }[] | null } | null
}

export interface DeliveryRow {
  id: string
  delivery_number: string
  kind: string
  status: string
  planned_at: string | null
  delivered_at: string | null
  received_by_name: string | null
  notes: string | null
  orders: { order_number: string }[] | null
}

const productionStatusLabels: Record<string, string> = {
  not_started: 'Non démarré', in_progress: 'En cours', blocked: 'Bloqué', ready_for_delivery: 'Prêt à livrer', delivered: 'Livré', cancelled: 'Annulé',
}
const productionStatusClass: Record<string, string> = {
  not_started: '', in_progress: 'crm-status-proposal', blocked: 'crm-status-lost', ready_for_delivery: 'crm-status-negotiation', delivered: 'crm-status-won', cancelled: 'crm-status-cancelled',
}
const deliveryStatusLabels: Record<string, string> = { planned: 'Planifiée', in_transit: 'En transit', delivered: 'Livrée', cancelled: 'Annulée', partial: 'Partielle' }
const deliveryStatusClass: Record<string, string> = { planned: '', in_transit: 'crm-status-proposal', delivered: 'crm-status-won', cancelled: 'crm-status-cancelled', partial: 'crm-status-negotiation' }
const statusOrder = ['not_started', 'in_progress', 'blocked', 'ready_for_delivery', 'delivered', 'cancelled']

function shortDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('fr-TG', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function ProductionPage() {
  const { can, loading: permitsLoading } = usePermits()
  const [rows, setRows] = useState<ProductionRow[]>([])
  const [deliveries, setDeliveries] = useState<DeliveryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const canAct = !permitsLoading && can('commandes', 'update')

  const refresh = useCallback(() => {
    if (!supabase) { setError('Connexion Supabase non configurée.'); setLoading(false); return }
    setLoading(true)
    Promise.all([
      supabase.from('production_projects')
        .select('id, order_id, responsible_id, status, planned_start_at, planned_delivery_at, actual_start_at, actual_delivery_at, notes, orders!order_id(order_number, amount_xof, companies!company_id(legal_name, trade_name))')
        .order('created_at', { ascending: false }).limit(100),
      supabase.from('deliveries')
        .select('id, delivery_number, kind, status, planned_at, delivered_at, received_by_name, notes, orders!order_id(order_number)')
        .order('created_at', { ascending: false }).limit(30),
    ]).then(([production, delivery]) => {
      if (production.error) throw new Error(production.error.message)
      if (delivery.error) throw new Error(delivery.error.message)
      setRows((production.data ?? []) as unknown as ProductionRow[])
      setDeliveries((delivery.data ?? []) as unknown as DeliveryRow[])
      setError(null)
    }).catch(reason => setError(reason instanceof Error ? reason.message : 'Chargement impossible.')).finally(() => setLoading(false))
  }, [])
  useEffect(refresh, [refresh])

  function clientName(row: ProductionRow): string {
    const company = row.orders?.companies?.[0]
    return company?.trade_name?.trim() || company?.legal_name || '—'
  }

  async function updateStatus(row: ProductionRow, status: string) {
    setPendingId(row.id); setNotice(null); setError(null)
    try {
      const { error: rpcError } = await supabase!.rpc('production_update', { p_production_id: row.id, p_status: status, p_responsible_id: null, p_notes: null, p_planned_delivery_at: null })
      if (rpcError) throw new Error(rpcError.message)
      setNotice(`${row.orders?.order_number ?? 'Projet'} : statut « ${productionStatusLabels[status] ?? status} » enregistré.`)
      refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Mise à jour impossible.')
    } finally { setPendingId(null) }
  }

  return <div className="crm-page">
    <div className="crm-page-head"><div><span className="section-kicker">PRODUCTION</span><h1>Production et livraison</h1><p>Suivi de la création des sites commandés et des livraisons associées.</p></div></div>
    {error && <div className="crm-alert" role="alert">{error}</div>}
    {notice && <div className="form-success" role="status">{notice}</div>}
    {loading ? <div className="crm-empty">Chargement de la production.</div> : <>
      <div className="crm-table-wrap">
        <table className="crm-table">
          <thead><tr><th>Commande</th><th>Client</th><th>Montant</th><th>Démarrage prévu</th><th>Livraison prévue</th><th>Démarrage réel</th><th>Livraison réelle</th><th>Statut</th>{canAct && <th>Action</th>}</tr></thead>
          <tbody>{rows.map(row => <tr key={row.id}>
            <td><strong>{row.orders?.order_number ?? '—'}</strong></td>
            <td>{clientName(row)}</td>
            <td>{xof.format(Number(row.orders?.amount_xof ?? 0))} FCFA</td>
            <td>{shortDate(row.planned_start_at)}</td>
            <td>{shortDate(row.planned_delivery_at)}</td>
            <td>{shortDate(row.actual_start_at)}</td>
            <td>{shortDate(row.actual_delivery_at)}</td>
            <td><span className={`crm-status ${productionStatusClass[row.status]}`}>{productionStatusLabels[row.status] ?? row.status}</span></td>
            {canAct && <td className="prod-actions">
              <select aria-label={`Statut de ${row.orders?.order_number ?? 'projet'}`} value={row.status} disabled={pendingId === row.id} onChange={event => void updateStatus(row, event.target.value)}>
                {statusOrder.map(status => <option key={status} value={status}>{productionStatusLabels[status]}</option>)}
              </select>
            </td>}
          </tr>)}
          </tbody>
        </table>
        {rows.length === 0 && <div className="crm-empty"><MonitorPlay size={22} /> Aucun projet de production. Il apparaîtra dès qu’une commande passera en production.</div>}
      </div>
      <div className="crm-form-section"><h2>Livraisons récentes</h2></div>
      <div className="crm-table-wrap">
        <table className="crm-table">
          <thead><tr><th>Livraison</th><th>Commande</th><th>Type</th><th>Prévue</th><th>Effectuée</th><th>Reçu par</th><th>Statut</th></tr></thead>
          <tbody>{deliveries.map(row => <tr key={row.id}>
            <td><strong>{row.delivery_number}</strong></td>
            <td>{row.orders?.[0]?.order_number ?? '—'}</td>
            <td>{row.kind === 'supplier_reception' ? 'Réception fournisseur' : 'Livraison client'}</td>
            <td>{shortDate(row.planned_at)}</td>
            <td>{shortDate(row.delivered_at)}</td>
            <td>{row.received_by_name ?? '—'}</td>
            <td><span className={`crm-status ${deliveryStatusClass[row.status]}`}>{deliveryStatusLabels[row.status] ?? row.status}</span></td>
          </tr>)}
          </tbody>
        </table>
        {deliveries.length === 0 && <div className="crm-empty">Aucune livraison enregistrée.</div>}
      </div>
    </>}
  </div>
}
