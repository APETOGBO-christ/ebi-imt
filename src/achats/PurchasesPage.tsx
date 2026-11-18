import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Plus, Search, ShoppingCart } from 'lucide-react'
import { Button } from '../components/ui/button'
import { usePermits } from '../lib/permissions'
import { createPurchase, listClientOrderOptions, listProjectOptions, listPurchases, listSupplierCompanies } from './api'
import { dateFr, purchaseStatusLabels, xof, type PurchaseRow } from './types'

const statusClass: Record<string, string> = {
  draft: 'ach-badge ach-draft', submitted: 'ach-badge ach-wait', confirmed: 'ach-badge ach-ok',
  sent: 'ach-badge ach-ok', partially_received: 'ach-badge ach-wait', received: 'ach-badge ach-ok',
  closed: 'ach-badge ach-done', cancelled: 'ach-badge ach-cancelled',
}

export function PurchasesPage() {
  const { can } = usePermits()
  const navigate = useNavigate()
  const [purchases, setPurchases] = useState<PurchaseRow[]>([])
  const [projects, setProjects] = useState<Record<string, string>>({})
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [supplierId, setSupplierId] = useState('')
  const [projectId, setProjectId] = useState('')
  const [orderId, setOrderId] = useState('')
  const [suppliers, setSuppliers] = useState<{ id: string; label: string }[]>([])
  const [projectOptions, setProjectOptions] = useState<{ id: string; label: string }[]>([])
  const [orderOptions, setOrderOptions] = useState<{ id: string; label: string }[]>([])
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const [rows, projectRows] = await Promise.all([listPurchases(), listProjectOptions()])
        setPurchases(rows)
        setProjects(Object.fromEntries(projectRows.map(row => [row.id, row.label])))
        setProjectOptions(projectRows)
      } catch (reason) { setError(reason instanceof Error ? reason.message : 'Erreur de chargement.') }
      finally { setLoading(false) }
    })()
  }, [])

  useEffect(() => {
    if (!showForm || suppliers.length > 0) return
    void listSupplierCompanies().then(setSuppliers).catch(() => setSuppliers([]))
    void listClientOrderOptions().then(setOrderOptions).catch(() => setOrderOptions([]))
  }, [showForm, suppliers.length])

  async function submitPurchase(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setFormError(null)
    try {
      const id = await createPurchase({ supplier_company_id: supplierId, order_id: orderId || null, project_id: projectId || null, delivery_expected_at: null, payment_terms: null, negotiated_ref: null, notes: null })
      setShowForm(false); setSupplierId(''); setProjectId(''); setOrderId('')
      setPurchases(await listPurchases())
      navigate(`/achats/${id}`)
    } catch (reason) { setFormError(reason instanceof Error ? reason.message : 'Création refusée.') }
    finally { setBusy(false) }
  }

  const shown = purchases.filter(item =>
    (!status || item.status === status) &&
    (!search || `${item.purchase_number} ${item.negotiated_ref ?? ''}`.toLowerCase().includes(search.toLowerCase())))

  return <div className="crm-page">
    <div className="crm-page-head">
      <div><span className="section-kicker">ACHATS</span><h1>Achats fournisseurs</h1><p>Chaque commande fournisseur est rattachée à un projet ou à une commande cliente, soumise à validation, envoyée puis réceptionnée.</p></div>
      {can('achats', 'insert') && <Button onClick={() => setShowForm(true)}><Plus size={16} /> Nouvel achat</Button>}
    </div>
    {error && <div className="crm-alert" role="alert">{error}</div>}
    {showForm && <form className="ach-create-form" onSubmit={submitPurchase}>
      <label htmlFor="a-supplier">Fournisseur</label>
      <select id="a-supplier" required value={supplierId} onChange={event => setSupplierId(event.target.value)}>
        <option value="">Sélectionner un fournisseur…</option>
        {suppliers.map(company => <option key={company.id} value={company.id}>{company.label}</option>)}
      </select>
      <label htmlFor="a-project">Rattachement projet</label>
      <select id="a-project" value={projectId} onChange={event => { setProjectId(event.target.value); if (event.target.value) setOrderId('') }}>
        <option value="">Aucun</option>
        {projectOptions.map(project => <option key={project.id} value={project.id}>{project.label}</option>)}
      </select>
      <label htmlFor="a-order">Ou commande cliente</label>
      <select id="a-order" value={orderId} onChange={event => { setOrderId(event.target.value); if (event.target.value) setProjectId('') }} disabled={Boolean(projectId)}>
        <option value="">Aucune</option>
        {orderOptions.map(order => <option key={order.id} value={order.id}>{order.label}</option>)}
      </select>
      <p className="commercial-note">Rattachez l’achat à un projet ou à une commande cliente (au moins un des deux).</p>
      {formError && <div className="form-error" role="alert">{formError}</div>}
      <div className="crm-form-actions"><Button type="submit" disabled={busy || (!projectId && !orderId) || !supplierId}>{busy ? 'Création…' : 'Créer la commande fournisseur'}</Button><Button type="button" variant="secondary" onClick={() => setShowForm(false)}>Annuler</Button></div>
    </form>}
    <div className="crm-toolbar">
      <div className="crm-search"><Search size={16} /><input aria-label="Rechercher un achat" placeholder="Numéro ou référence négociée…" value={search} onChange={event => setSearch(event.target.value)} /></div>
      <select aria-label="Filtrer par statut" value={status} onChange={event => setStatus(event.target.value)}>
        <option value="">Tous les statuts</option>{Object.entries(purchaseStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </div>
    <div className="crm-table-wrap"><table className="crm-table">
      <thead><tr><th>Achat</th><th>Fournisseur</th><th>Projet</th><th>Statut</th><th>Total</th><th>Livraison attendue</th><th /></tr></thead>
      <tbody>{loading ? <tr><td colSpan={7}>Chargement…</td></tr> : shown.map(item => <tr key={item.id}>
        <td><strong>{item.purchase_number}</strong><small>{item.negotiated_ref || '—'}</small></td>
        <td>{supplierName(item)}</td>
        <td>{item.project_id ? projects[item.project_id] ?? '—' : '—'}</td>
        <td><span className={statusClass[item.status] ?? 'ach-badge'}>{purchaseStatusLabels[item.status] ?? item.status}</span></td>
        <td>{xof(item.total_xof)}</td>
        <td>{item.delivery_expected_at ? dateFr(item.delivery_expected_at) : '—'}</td>
        <td><Link to={`/achats/${item.id}`} aria-label={`Ouvrir ${item.purchase_number}`}><ArrowRight size={16} /></Link></td>
      </tr>)}
      {!loading && shown.length === 0 && <tr><td colSpan={7}><div className="crm-empty"><ShoppingCart size={18} /> Aucun achat correspondant. Une commande fournisseur naît d’un besoin d’un projet ou d’une commande cliente.</div></td></tr>}
      </tbody>
    </table></div>
  </div>
}

function supplierName(item: PurchaseRow) {
  const company = (item as unknown as { companies?: { trade_name?: string | null; legal_name?: string }[] }).companies
  return company?.[0]?.trade_name?.trim() || company?.[0]?.legal_name || '—'
}
