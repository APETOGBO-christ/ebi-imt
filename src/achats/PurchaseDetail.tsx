import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, PackageCheck, Receipt, Trash2, Truck, Wallet } from 'lucide-react'
import { Button } from '../components/ui/button'
import { EntityDocuments } from '../components/EntityDocuments'
import { usePermits } from '../lib/permissions'
import {
  addDeliveryLine, addPurchaseLine, declarePayment, getDeliveryLines, getInvoicePayments, getInvoices,
  getPurchase, getPurchaseDeliveries, getPurchaseLines, registerInvoice, removePurchaseLine,
  scheduleReception, setDeliveryStatus, setPurchaseDetails, setPurchaseStatus, verifyPayment,
} from './api'
import {
  dateFr, deliveryStatusLabels, invoiceStatusLabels, paymentMethodLabels, paymentStatusLabels,
  purchaseStatusLabels, purchaseTransitions, whenFr, xof, type DeliveryLineRow, type DeliveryRow,
  type PurchaseLineRow, type PurchaseRow, type SupplierInvoiceRow, type SupplierPaymentRow,
} from './types'

const statusClass: Record<string, string> = {
  draft: 'ach-badge ach-draft', submitted: 'ach-badge ach-wait', confirmed: 'ach-badge ach-ok',
  sent: 'ach-badge ach-ok', partially_received: 'ach-badge ach-wait', received: 'ach-badge ach-ok',
  closed: 'ach-badge ach-done', cancelled: 'ach-badge ach-cancelled',
}

export function PurchaseDetail() {
  const { id } = useParams()
  const { can } = usePermits()
  const canUpdate = can('achats', 'update')
  const canValidate = can('achats', 'validate')
  const canPay = can('paiements', 'insert')
  const canVerify = can('paiements', 'validate')
  const canDelivery = can('livraisons', 'update')
  const [purchase, setPurchase] = useState<PurchaseRow | null>(null)
  const [lines, setLines] = useState<PurchaseLineRow[]>([])
  const [invoices, setInvoices] = useState<SupplierInvoiceRow[]>([])
  const [payments, setPayments] = useState<SupplierPaymentRow[]>([])
  const [deliveries, setDeliveries] = useState<DeliveryRow[]>([])
  const [deliveryLines, setDeliveryLines] = useState<DeliveryLineRow[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [lineForm, setLineForm] = useState({ designation: '', quantity: '1', unit: 'u', price: '' })
  const [detailsForm, setDetailsForm] = useState({ paymentTerms: '', deliveryExpectedAt: '', negotiatedRef: '', notes: '' })
  const [invoiceForm, setInvoiceForm] = useState({ number: '', date: new Date().toISOString().slice(0, 10), ht: '', tva: '', notes: '' })
  const [payForm, setPayForm] = useState({ invoiceId: '', amount: '', method: 'bank_transfer', reference: '' })
  const [deliveryForm, setDeliveryForm] = useState({ plannedAt: '' })
  const [lineDelivery, setLineDelivery] = useState<Record<string, { designation: string; quantity: string; unit: string; receivedOk: boolean }>>({})

  useEffect(() => {
    if (!id) return
    void (async () => {
      try {
        const [row, lineRows, invoiceRows, deliveryRows] = await Promise.all([
          getPurchase(id), getPurchaseLines(id), getInvoices(id), getPurchaseDeliveries(id)])
        setPurchase(row); setLines(lineRows); setInvoices(invoiceRows); setDeliveries(deliveryRows)
        setPayments(await getInvoicePayments(invoiceRows.map(invoice => invoice.id)))
        setDeliveryLines(await getDeliveryLines(deliveryRows.map(delivery => delivery.id)))
        setDetailsForm({
          paymentTerms: row.payment_terms ?? '', deliveryExpectedAt: row.delivery_expected_at?.slice(0, 16) ?? '',
          negotiatedRef: row.negotiated_ref ?? '', notes: row.notes ?? '',
        })
      } catch (reason) { setError(reason instanceof Error ? reason.message : 'Erreur de chargement.') }
    })()
  }, [id, refresh])

  async function run(action: () => Promise<unknown>) {
    setBusy(true); setError(null)
    try { await action(); setRefresh(value => value + 1) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Action refusée.') }
    finally { setBusy(false) }
  }

  if (!purchase) return <div className="crm-page"><Link to="/achats" className="crm-back"><ArrowLeft size={16} /> Achats</Link>{error ? <div className="crm-alert" role="alert">{error}</div> : <div className="crm-empty">Chargement de la commande fournisseur…</div>}</div>

  const supplier = (purchase as unknown as { companies?: { trade_name?: string | null; legal_name?: string }[] }).companies?.[0]
  const supplierLabel = supplier?.trade_name?.trim() || supplier?.legal_name || 'Fournisseur'
  const invoiceTotal = invoices.filter(invoice => invoice.status !== 'rejected').reduce((sum, invoice) => sum + invoice.amount_ttc_xof, 0)
  const confirmedPayments = payments.filter(payment => payment.status === 'confirmed').reduce((sum, payment) => sum + payment.amount_xof, 0)
  const invoiceById = new Map(invoices.map(invoice => [invoice.id, invoice]))
  const activeTransitions = purchaseTransitions[purchase.status] ?? []
  const tva = invoiceForm.tva === '' ? null : Number(invoiceForm.tva)
  const ht = invoiceForm.ht === '' ? null : Number(invoiceForm.ht)

  return <div className="crm-page"><Link to="/achats" className="crm-back"><ArrowLeft size={16} /> Achats</Link>
    {error && <div className="crm-alert" role="alert">{error}</div>}
    <div className="crm-detail-head"><span className="detail-logo"><Truck size={25} /></span>
      <div><span className="section-kicker">ACHAT / {purchase.purchase_number}</span><h1>{supplierLabel}</h1>
        <div className="detail-sub"><span className={statusClass[purchase.status] ?? 'ach-badge'}>{purchaseStatusLabels[purchase.status]}</span><span>{xof(purchase.total_xof)}</span>
          {purchase.project_id && <Link to={`/projets/${purchase.project_id}`}>Projet rattaché</Link>}
          {purchase.order_id && <Link to={`/commandes/${purchase.order_id}`}>Commande cliente</Link>}</div></div>
    </div>
    {activeTransitions.length > 0 && <div className="crm-head-actions commercial-actions">
      {activeTransitions.map(transition => {
        const allowed = transition.validate ? canValidate : canUpdate
        if (!allowed) return null
        return <Button key={transition.to} disabled={busy} variant={transition.to === 'cancelled' ? 'secondary' : 'default'}
          onClick={() => void run(() => setPurchaseStatus(purchase.id, transition.to))}>{transition.label}</Button>
      })}
    </div>}
    <div className="crm-detail-grid"><div>
      <section className="crm-section"><h2>Conditions de la commande</h2><div className="crm-facts">
        <div><span>Référence négociée</span><strong>{purchase.negotiated_ref || '—'}</strong></div>
        <div><span>Conditions de paiement</span><strong>{purchase.payment_terms || '—'}</strong></div>
        <div><span>Livraison attendue</span><strong>{purchase.delivery_expected_at ? whenFr(purchase.delivery_expected_at) : '—'}</strong></div>
        <div><span>Notes</span><strong>{purchase.notes || 'Aucune'}</strong></div>
        <div><span>Soumise le</span><strong>{purchase.submitted_at ? whenFr(purchase.submitted_at) : '—'}</strong></div>
        <div><span>Validée le</span><strong>{purchase.confirmed_at ? whenFr(purchase.confirmed_at) : '—'}</strong></div>
        <div><span>Envoyée le</span><strong>{purchase.sent_at ? whenFr(purchase.sent_at) : '—'}</strong></div>
        <div><span>Clôturée le</span><strong>{purchase.closed_at ? whenFr(purchase.closed_at) : '—'}</strong></div>
      </div>
      {canUpdate && ['draft', 'submitted'].includes(purchase.status) && <form className="ach-inline-form" onSubmit={event => {
        event.preventDefault()
        void run(() => setPurchaseDetails(purchase.id, detailsForm.paymentTerms || null, detailsForm.deliveryExpectedAt || null, detailsForm.negotiatedRef || null, detailsForm.notes || null))
      }}>
        <input aria-label="Conditions de paiement" placeholder="Conditions de paiement (ex. 30 jours fin de mois)" value={detailsForm.paymentTerms} onChange={event => setDetailsForm({ ...detailsForm, paymentTerms: event.target.value })} />
        <input aria-label="Livraison attendue" type="datetime-local" value={detailsForm.deliveryExpectedAt} onChange={event => setDetailsForm({ ...detailsForm, deliveryExpectedAt: event.target.value })} />
        <input aria-label="Référence négociée" placeholder="Référence négociée / devis" value={detailsForm.negotiatedRef} onChange={event => setDetailsForm({ ...detailsForm, negotiatedRef: event.target.value })} />
        <input aria-label="Notes" placeholder="Notes" value={detailsForm.notes} onChange={event => setDetailsForm({ ...detailsForm, notes: event.target.value })} />
        <Button type="submit" disabled={busy}>Enregistrer les conditions</Button>
      </form>}
      </section>
      <section className="crm-section"><h2>Lignes de la commande</h2>
        <div className="crm-table-wrap"><table className="crm-table"><thead><tr><th>#</th><th>Désignation</th><th>Qté</th><th>PU</th><th>Montant</th><th /></tr></thead>
          <tbody>{lines.map(line => <tr key={line.id}><td>{line.position}</td><td>{line.designation}</td><td>{line.quantity} {line.unit ?? ''}</td><td>{xof(line.unit_price_xof)}</td><td>{xof(line.amount_xof)}</td>
            <td>{canUpdate && purchase.status === 'draft' && <Button variant="ghost" size="icon" disabled={busy} aria-label={`Supprimer ${line.designation}`} onClick={() => void run(() => removePurchaseLine(line.id))}><Trash2 size={15} /></Button>}</td></tr>)}
            {lines.length === 0 && <tr><td colSpan={6}><div className="notif-empty">Aucune ligne. Une ligne est requise avant la soumission.</div></td></tr>}
          </tbody></table></div>
        <div className="ach-total-row"><span>Total commande</span><strong>{xof(purchase.total_xof)}</strong></div>
        {canUpdate && purchase.status === 'draft' && <form className="ach-inline-form" onSubmit={event => {
          event.preventDefault()
          if (!lineForm.designation.trim() || !lineForm.price) return
          void run(async () => { await addPurchaseLine(purchase.id, lineForm.designation.trim(), Number(lineForm.quantity), lineForm.unit || null, Number(lineForm.price)); setLineForm({ designation: '', quantity: '1', unit: 'u', price: '' }) })
        }}>
          <input aria-label="Désignation de la ligne" placeholder="Désignation" value={lineForm.designation} onChange={event => setLineForm({ ...lineForm, designation: event.target.value })} />
          <input aria-label="Quantité" type="number" min={0.001} step="any" value={lineForm.quantity} onChange={event => setLineForm({ ...lineForm, quantity: event.target.value })} />
          <input aria-label="Unité" placeholder="Unité" value={lineForm.unit} onChange={event => setLineForm({ ...lineForm, unit: event.target.value })} />
          <input aria-label="Prix unitaire" type="number" min={0} placeholder="Prix unitaire (FCFA)" value={lineForm.price} onChange={event => setLineForm({ ...lineForm, price: event.target.value })} />
          <Button type="submit" disabled={busy}>Ajouter la ligne</Button>
        </form>}
      </section>
      <section className="crm-section"><h2><Receipt size={17} /> Factures fournisseurs</h2>
        <div className="crm-table-wrap"><table className="crm-table"><thead><tr><th>Facture</th><th>Date</th><th>HT</th><th>TVA</th><th>TTC</th><th>Statut</th></tr></thead>
          <tbody>{invoices.map(invoice => <tr key={invoice.id}><td><strong>{invoice.supplier_invoice_number}</strong></td><td>{dateFr(invoice.invoice_date)}</td><td>{xof(invoice.amount_ht_xof)}</td><td>{xof(invoice.amount_tva_xof)}</td><td>{xof(invoice.amount_ttc_xof)}</td>
            <td><span className={`ach-badge ${invoice.status === 'paid' ? 'ach-done' : invoice.status === 'rejected' || invoice.status === 'disputed' ? 'ach-cancelled' : 'ach-wait'}`}>{invoiceStatusLabels[invoice.status]}</span></td></tr>)}
            {invoices.length === 0 && <tr><td colSpan={6}><div className="notif-empty">Aucune facture enregistrée.</div></td></tr>}
          </tbody></table></div>
        <div className="ach-total-row"><span>Facturé (hors rejets)</span><strong>{xof(invoiceTotal)}</strong></div>
        {canUpdate && ['sent', 'partially_received', 'received', 'closed'].includes(purchase.status) && <form className="ach-inline-form" onSubmit={event => {
          event.preventDefault()
          if (!invoiceForm.number.trim() || ht === null || tva === null) return
          void run(async () => {
            await registerInvoice({ purchaseOrderId: purchase.id, supplierInvoiceNumber: invoiceForm.number.trim(), invoiceDate: invoiceForm.date, amountHt: ht, amountTva: tva, amountTtc: ht + tva, notes: invoiceForm.notes || null })
            setInvoiceForm({ number: '', date: new Date().toISOString().slice(0, 10), ht: '', tva: '', notes: '' })
          })
        }}>
          <input aria-label="Numéro de facture fournisseur" placeholder="N° facture fournisseur" value={invoiceForm.number} onChange={event => setInvoiceForm({ ...invoiceForm, number: event.target.value })} />
          <input aria-label="Date de facture" type="date" value={invoiceForm.date} onChange={event => setInvoiceForm({ ...invoiceForm, date: event.target.value })} />
          <input aria-label="Montant HT" type="number" min={0} placeholder="HT" value={invoiceForm.ht} onChange={event => setInvoiceForm({ ...invoiceForm, ht: event.target.value })} />
          <input aria-label="Montant TVA" type="number" min={0} placeholder="TVA" value={invoiceForm.tva} onChange={event => setInvoiceForm({ ...invoiceForm, tva: event.target.value })} />
          <span className="ach-hint">TTC = {ht !== null && tva !== null ? xof(ht + tva) : '—'}</span>
          <Button type="submit" disabled={busy}>Enregistrer la facture</Button>
        </form>}
      </section>
      <section className="crm-section"><h2><Wallet size={17} /> Décaissements</h2>
        {payments.length === 0 ? <div className="notif-empty">Aucun décaissement déclaré.</div> : <div className="crm-table-wrap"><table className="crm-table"><thead><tr><th>Facture</th><th>Montant</th><th>Moyen</th><th>Référence</th><th>Payé le</th><th>Statut</th><th /></tr></thead>
          <tbody>{payments.map(payment => <tr key={payment.id}><td>{invoiceById.get(payment.supplier_invoice_id)?.supplier_invoice_number ?? '—'}</td><td>{xof(payment.amount_xof)}</td><td>{paymentMethodLabels[payment.method]}</td><td>{payment.reference || '—'}</td><td>{whenFr(payment.paid_at)}</td>
            <td><span className={`ach-badge ${payment.status === 'confirmed' ? 'ach-done' : payment.status === 'rejected' ? 'ach-cancelled' : 'ach-wait'}`}>{paymentStatusLabels[payment.status]}</span></td>
            <td>{canVerify && payment.status === 'pending' && <span className="ach-verify"><Button size="sm" disabled={busy} onClick={() => void run(() => verifyPayment(payment.id, true))}>Confirmer</Button><Button size="sm" variant="secondary" disabled={busy} onClick={() => void run(() => verifyPayment(payment.id, false))}>Rejeter</Button></span>}</td></tr>)}
          </tbody></table></div>}
        <div className="ach-total-row"><span>Décaissements confirmés</span><strong>{xof(confirmedPayments)}</strong></div>
        {canPay && invoices.some(invoice => invoice.status !== 'rejected' && invoice.status !== 'disputed') && <form className="ach-inline-form" onSubmit={event => {
          event.preventDefault()
          if (!payForm.invoiceId || !payForm.amount) return
          void run(async () => {
            await declarePayment({ invoiceId: payForm.invoiceId, amount: Number(payForm.amount), method: payForm.method, reference: payForm.reference || null, paidAt: null })
            setPayForm({ invoiceId: '', amount: '', method: 'bank_transfer', reference: '' })
          })
        }}>
          <select aria-label="Facture à payer" value={payForm.invoiceId} onChange={event => setPayForm({ ...payForm, invoiceId: event.target.value })}>
            <option value="">Facture…</option>
            {invoices.filter(invoice => invoice.status !== 'rejected' && invoice.status !== 'disputed').map(invoice => <option key={invoice.id} value={invoice.id}>{invoice.supplier_invoice_number} — {xof(invoice.amount_ttc_xof)}</option>)}
          </select>
          <input aria-label="Montant du décaissement" type="number" min={1} placeholder="Montant" value={payForm.amount} onChange={event => setPayForm({ ...payForm, amount: event.target.value })} />
          <select aria-label="Moyen de paiement" value={payForm.method} onChange={event => setPayForm({ ...payForm, method: event.target.value })}>
            {Object.entries(paymentMethodLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <input aria-label="Référence du paiement" placeholder="Référence" value={payForm.reference} onChange={event => setPayForm({ ...payForm, reference: event.target.value })} />
          <Button type="submit" disabled={busy}>Déclarer le décaissement</Button>
        </form>}
        <p className="commercial-note">Une déclaration reste « à vérifier » tant qu’un vérificateur ne l’a pas confirmée.</p>
      </section>
      <EntityDocuments entityTable="purchase_orders" entityId={purchase.id} companyId={purchase.supplier_company_id} title="Documents de l’achat" />
    </div><aside>
      <section className="crm-section"><h2><PackageCheck size={17} /> Réceptions</h2>
        {deliveries.length === 0 ? <div className="notif-empty">Aucune réception planifiée.</div> : deliveries.map(delivery => <div className="ach-delivery" key={delivery.id}>
          <div className="ach-delivery-head"><strong>{delivery.delivery_number}</strong><span className={`ach-badge ${delivery.status === 'delivered' ? 'ach-done' : delivery.status === 'cancelled' ? 'ach-cancelled' : 'ach-wait'}`}>{deliveryStatusLabels[delivery.status]}</span></div>
          <small>Planifiée : {delivery.planned_at ? whenFr(delivery.planned_at) : '—'} · Livrée : {delivery.delivered_at ? whenFr(delivery.delivered_at) : '—'}{delivery.received_by_name ? ` · Reçue par ${delivery.received_by_name}` : ''}</small>
          {deliveryLines.filter(line => line.delivery_id === delivery.id).map(line => <div className="ach-delivery-line" key={line.id}><span>{line.designation} · {line.quantity} {line.unit ?? ''}</span><span>{line.received_ok ? 'Conforme' : 'Écart'}</span></div>)}
          {canDelivery && delivery.status !== 'delivered' && delivery.status !== 'cancelled' && <div className="ach-delivery-actions">
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void run(() => setDeliveryStatus({ deliveryId: delivery.id, status: 'in_transit', deliveredAt: null, receivedByName: null }))}>En transit</Button>
            <form onSubmit={event => {
              event.preventDefault()
              const name = (event.currentTarget.elements.namedItem('receiver') as HTMLInputElement).value
              void run(() => setDeliveryStatus({ deliveryId: delivery.id, status: 'delivered', deliveredAt: null, receivedByName: name || null }))
            }}><input name="receiver" aria-label="Nom du réceptionnaire" placeholder="Réceptionnaire" /><Button size="sm" type="submit" disabled={busy}>Marquer livrée</Button></form>
          </div>}
          {canDelivery && delivery.status !== 'cancelled' && <form className="ach-inline-form ach-line-form" onSubmit={event => {
            event.preventDefault()
            const draft = lineDelivery[delivery.id] ?? { designation: '', quantity: '1', unit: 'u', receivedOk: true }
            if (!draft.designation.trim()) return
            void run(async () => {
              await addDeliveryLine({ deliveryId: delivery.id, designation: draft.designation.trim(), quantity: Number(draft.quantity), unit: draft.unit || null, purchaseLineId: null, receivedOk: draft.receivedOk })
              setLineDelivery({ ...lineDelivery, [delivery.id]: { designation: '', quantity: '1', unit: 'u', receivedOk: true } })
            })
          }}>
            <input aria-label="Désignation reçue" placeholder="Ligne reçue" value={(lineDelivery[delivery.id] ?? { designation: '' }).designation} onChange={event => setLineDelivery({ ...lineDelivery, [delivery.id]: { ...(lineDelivery[delivery.id] ?? { quantity: '1', unit: 'u', receivedOk: true }), designation: event.target.value } })} />
            <input aria-label="Quantité reçue" type="number" min={0.001} step="any" value={(lineDelivery[delivery.id] ?? { quantity: '1' }).quantity} onChange={event => setLineDelivery({ ...lineDelivery, [delivery.id]: { ...(lineDelivery[delivery.id] ?? { designation: '', unit: 'u', receivedOk: true }), quantity: event.target.value } })} />
            <Button size="sm" type="submit" disabled={busy}>Ajouter</Button>
          </form>}
        </div>)}
        {canDelivery && purchase.status === 'sent' && <form className="ach-inline-form" onSubmit={event => {
          event.preventDefault()
          void run(async () => { await scheduleReception(purchase.id, deliveryForm.plannedAt || null); setDeliveryForm({ plannedAt: '' }) })
        }}>
          <input aria-label="Date de réception planifiée" type="datetime-local" value={deliveryForm.plannedAt} onChange={event => setDeliveryForm({ plannedAt: event.target.value })} />
          <Button type="submit" disabled={busy}>Planifier une réception</Button>
        </form>}
        <p className="commercial-note">Une réception livrée fait passer l’achat en « partiellement reçu » s’il était « envoyé ».</p>
      </section>
      <section className="crm-section"><h2>Synthèse</h2><div className="crm-facts">
        <div><span>Total commande</span><strong>{xof(purchase.total_xof)}</strong></div>
        <div><span>Facturé</span><strong>{xof(invoiceTotal)}</strong></div>
        <div><span>Décaissé (confirmé)</span><strong>{xof(confirmedPayments)}</strong></div>
        <div><span>Reste à décaisser</span><strong>{xof(Math.max(0, invoiceTotal - confirmedPayments))}</strong></div>
      </div><Link className="crm-quick-link" to="/bibliotheque">Documents (bibliothèque) <ArrowRight size={15} /></Link></section>
    </aside></div>
  </div>
}
