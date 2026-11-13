import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowRight, Plus, Trash2 } from 'lucide-react'
import { Button } from '../components/ui/button'
import { usePermits } from '../lib/permissions'
import { addTenderItem, getTender, listCompanyOptions, removeTenderItem, setTenderQuote, setTenderStatus, type TenderDetail } from './api'
import { companyLabel, tenderEventLabels, tenderStatusClass, tenderStatusLabels, xof, type TenderStatus } from './types'

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('fr-TG', { dateStyle: 'medium', timeStyle: 'short' })
}

export function TenderDetail() {
  const { id } = useParams()
  const { can, loading: permitsLoading } = usePermits()
  const [detail, setDetail] = useState<TenderDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [wonAmount, setWonAmount] = useState('')
  const [lostReason, setLostReason] = useState('')
  const [newItem, setNewItem] = useState({ designation: '', quantity: '1', unit: '', unitPrice: '', notes: '' })
  const [quoteDraft, setQuoteDraft] = useState<{ itemId: string; supplier: string; amount: string } | null>(null)
  const [suppliers, setSuppliers] = useState<{ id: string; label: string }[]>([])

  const refresh = useCallback(() => {
    if (!id) return
    setLoading(true)
    Promise.all([getTender(id), listCompanyOptions()])
      .then(([detail, options]) => {
        setDetail(detail)
        setSuppliers(options.map(option => ({ id: option.id, label: option.trade_name?.trim() || option.legal_name })))
        setWonAmount(detail.tender.awarded_amount_xof ? String(detail.tender.awarded_amount_xof) : '')
        setError(null)
      })
      .catch(reason => setError(reason instanceof Error ? reason.message : 'Chargement impossible.'))
      .finally(() => setLoading(false))
  }, [id])
  useEffect(refresh, [refresh])

  if (loading) return <div className="crm-page"><div className="crm-empty">Chargement du dossier.</div></div>
  if (!detail) return <div className="crm-page"><div className="crm-alert" role="alert">{error ?? 'Dossier introuvable.'}</div></div>

  const tender = detail.tender
  const status: TenderStatus = tender.status
  const isPreparing = status === 'preparing'
  const canAct = !permitsLoading && (can('appels_offres', 'update') || can('appels_offres', 'validate'))
  const totalItems = detail.items.reduce((sum, item) => sum + Number(item.amount_xof), 0)

  async function act(action: () => Promise<void>, message: string) {
    setPending(true); setError(null); setNotice(null)
    try { await action(); setNotice(message); refresh() } catch (reason) { setError(reason instanceof Error ? reason.message : 'Action impossible.') } finally { setPending(false) }
  }

  function submitItem(event: FormEvent) {
    event.preventDefault()
    if (!newItem.designation.trim() || !newItem.unitPrice) { setError('Désignation et prix unitaire obligatoires.'); return }
    void act(async () => {
      await addTenderItem(tender.id, {
        p_designation: newItem.designation.trim(),
        p_quantity: Number(newItem.quantity) || 1,
        p_unit: newItem.unit.trim() || null,
        p_unit_price_xof: Number(newItem.unitPrice),
        p_notes: newItem.notes.trim() || null,
      })
      setNewItem({ designation: '', quantity: '1', unit: '', unitPrice: '', notes: '' })
    }, 'Ligne ajoutée.')
  }

  function submitQuote(event: FormEvent) {
    event.preventDefault()
    if (!quoteDraft || !quoteDraft.supplier || !quoteDraft.amount) { setError('Fournisseur et montant obligatoires.'); return }
    void act(async () => {
      await setTenderQuote(tender.id, quoteDraft.itemId, quoteDraft.supplier, Number(quoteDraft.amount), null, null)
      setQuoteDraft(null)
    }, 'Devis fournisseur enregistré.')
  }

  return <div className="crm-page">
    <div className="crm-detail-head"><div>
      <span className="section-kicker">APPEL D’OFFRES {tender.tender_number}</span>
      <h1>{tender.title}</h1>
      <p>{companyLabel(tender.companies)} · Dépôt : {formatDate(tender.submission_deadline)}</p>
    </div><div className="crm-detail-actions">
      <span className={`crm-status ${tenderStatusClass[status]}`}>{tenderStatusLabels[status]}</span>
      {isPreparing && can('appels_offres', 'update') && <Button asChild><Link to={`/appels-offres/${tender.id}/modifier`}>Modifier</Link></Button>}
    </div></div>
    {error && <div className="crm-alert" role="alert">{error}</div>}
    {notice && <div className="form-success" role="status">{notice}</div>}
    {pending && <div className="crm-empty">Traitement en cours…</div>}

    {canAct && status !== 'won' && status !== 'cancelled' && <div className="crm-toolbar dao-actions">
      {isPreparing && <Button variant="secondary" onClick={() => void act(() => setTenderStatus(tender.id, 'submitted', {}), 'Dossier marqué soumis.')} disabled={pending}>Soumettre le dossier</Button>}
      {status === 'submitted' && can('appels_offres', 'validate') && <>
        <span className="dao-inline-field"><input inputMode="numeric" placeholder="Montant du marché (FCFA)" value={wonAmount} onChange={event => setWonAmount(event.target.value)} /><Button variant="secondary" onClick={() => void act(() => setTenderStatus(tender.id, 'won', { p_awarded_amount_xof: Number(wonAmount.replace(/\s/g, '')) }), 'Appel d’offres gagné.')} disabled={pending}>Marquer gagné</Button></span>
        <span className="dao-inline-field"><input placeholder="Motif de la perte" value={lostReason} onChange={event => setLostReason(event.target.value)} /><Button variant="secondary" onClick={() => void act(() => setTenderStatus(tender.id, 'lost', { p_lost_reason: lostReason }), 'Appel d’offres perdu.')} disabled={pending || !lostReason.trim()}>Marquer perdu</Button></span>
        <Button variant="ghost" onClick={() => void act(() => setTenderStatus(tender.id, 'cancelled', {}), 'Appel d’offres annulé.')} disabled={pending}>Annuler le dossier</Button>
      </>}
    </div>}

    <div className="dao-grid">
      <section className="dao-panel">
        <h2>Détails</h2>
        <div className="dao-facts">
          <div><span>Secteur</span><strong>{tender.sector || '—'}</strong></div>
          <div><span>Source</span><strong>{tender.source || '—'}</strong></div>
          <div><span>Ouverture des plis</span><strong>{formatDate(tender.opening_at)}</strong></div>
          {tender.awarded_amount_xof != null && <div><span>Montant du marché</span><strong>{xof(tender.awarded_amount_xof)}</strong></div>}
          {tender.lost_reason && <div><span>Motif de la perte</span><strong>{tender.lost_reason}</strong></div>}
          <div><span>Total des lignes</span><strong>{xof(totalItems)}</strong></div>
        </div>
        {tender.preparation_notes && <p className="dao-notes">{tender.preparation_notes}</p>}
      </section>

      <section className="dao-panel">
        <h2>Lignes du dossier</h2>
        <div className="crm-table-wrap">
          <table className="crm-table">
            <thead><tr><th>#</th><th>Désignation</th><th>Qté</th><th>Prix unitaire</th><th>Montant</th>{isPreparing && can('appels_offres', 'update') && <th />}</tr></thead>
            <tbody>{detail.items.map(item => <tr key={item.id}>
              <td>{item.position}</td>
              <td><strong>{item.designation}</strong>{item.notes && <small>{item.notes}</small>}</td>
              <td>{item.quantity} {item.unit ?? ''}</td>
              <td>{xof(item.unit_price_xof)}</td>
              <td>{xof(item.amount_xof)}</td>
              {isPreparing && can('appels_offres', 'update') && <td><button aria-label={`Retirer ${item.designation}`} onClick={() => void act(() => removeTenderItem(item.id), 'Ligne retirée.')}><Trash2 size={15} /></button></td>}
            </tr>)}
            </tbody>
          </table>
          {detail.items.length === 0 && <div className="crm-empty">Aucune ligne enregistrée.</div>}
        </div>
        {isPreparing && can('appels_offres', 'update') && <form className="crm-inline-form" onSubmit={submitItem}>
          <input required placeholder="Désignation" value={newItem.designation} onChange={event => setNewItem(old => ({ ...old, designation: event.target.value }))} />
          <input inputMode="decimal" placeholder="Qté" value={newItem.quantity} onChange={event => setNewItem(old => ({ ...old, quantity: event.target.value }))} />
          <input placeholder="Unité" value={newItem.unit} onChange={event => setNewItem(old => ({ ...old, unit: event.target.value }))} />
          <input required inputMode="numeric" placeholder="Prix unitaire (FCFA)" value={newItem.unitPrice} onChange={event => setNewItem(old => ({ ...old, unitPrice: event.target.value }))} />
          <Button type="submit" disabled={pending}><Plus size={15} /> Ajouter</Button>
        </form>}
      </section>

      <section className="dao-panel">
        <h2>Devis fournisseurs</h2>
        <div className="crm-table-wrap">
          <table className="crm-table">
            <thead><tr><th>Fournisseur</th><th>Montant</th><th>Source</th><th /></tr></thead>
            <tbody>{detail.quotes.map(quote => {
              const item = detail.items.find(candidate => candidate.id === quote.tender_item_id)
              return <tr key={quote.id}>
                <td><strong>{companyLabel(quote.companies)}</strong><small>{item?.designation ?? ''}</small></td>
                <td>{xof(quote.quote_xof)}</td>
                <td>{quote.source ?? '—'}</td>
                {isPreparing && can('appels_offres', 'update') && <td><button aria-label="Remplacer ce devis" onClick={() => setQuoteDraft({ itemId: quote.tender_item_id, supplier: quote.supplier_company_id, amount: String(quote.quote_xof) })}>Modifier</button></td>}
              </tr>
            })}
            </tbody>
          </table>
          {detail.quotes.length === 0 && <div className="crm-empty">Aucun devis enregistré.</div>}
        </div>
        {isPreparing && can('appels_offres', 'update') && (quoteDraft
          ? <form className="crm-inline-form" onSubmit={submitQuote}>
              <select required value={quoteDraft.supplier} onChange={event => setQuoteDraft(old => old && { ...old, supplier: event.target.value })}>
                <option value="">Fournisseur</option>
                {suppliers.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
              <input required inputMode="numeric" placeholder="Montant du devis (FCFA)" value={quoteDraft.amount} onChange={event => setQuoteDraft(old => old && { ...old, amount: event.target.value })} />
              <Button type="submit" disabled={pending}>Enregistrer</Button>
              <Button type="button" variant="ghost" onClick={() => setQuoteDraft(null)}>Annuler</Button>
            </form>
          : <form onSubmit={event => { event.preventDefault(); if (detail.items[0]) setQuoteDraft({ itemId: detail.items[0].id, supplier: '', amount: '' }) }}>
              <Button type="submit" variant="secondary" disabled={detail.items.length === 0}><Plus size={15} /> Ajouter un devis</Button>
            </form>)}
      </section>

      <section className="dao-panel">
        <h2>Historique</h2>
        {detail.events.length === 0 ? <div className="crm-empty">Aucun événement.</div> : <ul className="dao-timeline">{detail.events.map(event => (
          <li key={event.id}>
            <strong>{tenderEventLabels[event.event_type] ?? event.event_type}</strong>
            <small>{formatDate(event.created_at)}{event.profiles?.full_name ? ` · ${event.profiles.full_name}` : ''}</small>
          </li>
        ))}</ul>}
      </section>
    </div>
    <div className="crm-form-actions"><Button variant="ghost" asChild><Link to="/appels-offres">Retour à la liste <ArrowRight size={15} /></Link></Button></div>
  </div>
}
