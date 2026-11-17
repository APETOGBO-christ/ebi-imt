import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowRight, Download, Plus, Trash2 } from 'lucide-react'
import { Button } from '../components/ui/button'
import { downloadUrl } from '../bibliotheque/api'
import { usePermits } from '../lib/permissions'
import {
  addTenderComment, addTenderItem, addTenderReminder, addTenderTask, attachTenderDocument,
  createProjectFromTender, getTender, linkOrder, linkProposal, listCompanyOptions, listLinkableOrders,
  listLinkableProposals, listProductOptions, listResponsibleOptions, removeTenderDocument, removeTenderItem,
  removeTenderTask, selectTenderSupplier, setTenderQuote, setTenderReminderDone, setTenderStatus,
  setTenderTaskDone, type ProductOption, type TenderDetail,
} from './api'
import { fetchAppSettings } from '../settings/api'
import {
  allowedTransitions, availabilityLabels, companyLabel, firstEmbed, shortDate, tenderCategoryLabels,
  tenderEventLabels, tenderItemCategoryLabels, tenderStatusClass, tenderStatusLabels, tenderTotals,
  terminalStatuses, xof, type TenderCategory, type TenderStatus,
} from './types'

const editablesStatuses: TenderStatus[] = ['identifie', 'a_analyser', 'en_analyse', 'decision_soumission', 'en_preparation', 'en_validation', 'attente_documents', 'pret_deposer']
const orderStatusLabels: Record<string, string> = { draft: 'Brouillon', confirmed: 'Confirmée', cancelled: 'Annulée', completed: 'Terminée' }
const proposalStatusLabels: Record<string, string> = { draft: 'Brouillon', pending_approval: 'À valider', approved: 'Validée', sent: 'Envoyée', accepted: 'Acceptée', rejected: 'Refusée', cancelled: 'Annulée' }
const deliveryStatusLabels: Record<string, string> = { planned: 'Planifiée', in_transit: 'En transit', delivered: 'Livrée', partial: 'Partielle', cancelled: 'Annulée' }

export function TenderDetail() {
  const { id } = useParams()
  const { can } = usePermits()
  const [detail, setDetail] = useState<TenderDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [wonAmount, setWonAmount] = useState('')
  const [lostReason, setLostReason] = useState('')
  const [targetStatus, setTargetStatus] = useState<TenderStatus | ''>('')
  const [newItem, setNewItem] = useState({ product: '', designation: '', quantity: '1', unit: '', unitPrice: '', notes: '', category: '' })
  const [quoteDraft, setQuoteDraft] = useState<{ itemId: string; supplier: string; amount: string; brand: string; transport: string; lead: string; warranty: string; availability: string; source: string; notes: string } | null>(null)
  const [selectDraft, setSelectDraft] = useState<{ itemId: string; supplier: string; reason: string } | null>(null)
  const [projectDraft, setProjectDraft] = useState<{ title: string; budget: string; start: string; plannedEnd: string } | null>(null)
  const [vatRate, setVatRate] = useState(18)
  const [suppliers, setSuppliers] = useState<{ id: string; label: string }[]>([])
  const [people, setPeople] = useState<{ id: string; label: string }[]>([])
  const [docDraft, setDocDraft] = useState<{ category: TenderCategory; title: string; file: File | null }>({ category: 'dao', title: '', file: null })
  const [taskDraft, setTaskDraft] = useState({ title: '', due: '', assignee: '' })
  const [reminderDraft, setReminderDraft] = useState({ when: '', note: '' })
  const [commentDraft, setCommentDraft] = useState('')
  const [orderDraft, setOrderDraft] = useState('')
  const [proposalDraft, setProposalDraft] = useState('')

  const refresh = useCallback(() => {
    if (!id) return
    setLoading(true)
    fetchAppSettings().then(settings => {
      const vat = settings?.finance?.default_vat_pct
      if (typeof vat === 'number' && vat >= 0) setVatRate(vat)
    }).catch(() => undefined)
    Promise.all([getTender(id), listCompanyOptions(), listResponsibleOptions(), listLinkableOrders(), listLinkableProposals(), listProductOptions()])
      .then(([detail, options, persons, orders, proposals, products]) => {
        setDetail(detail)
        setSuppliers(options.map(option => ({ id: option.id, label: option.trade_name?.trim() || option.legal_name })))
        setPeople(persons.map(option => ({ id: option.id, label: option.full_name })))
        setProducts(products)
        setOrderCandidates(orders.filter(order => order.id !== detail.tender.id && order.tender_id !== detail.tender.id))
        setProposalCandidates(proposals.filter(proposal => proposal.tender_id !== detail.tender.id))
        setWonAmount(detail.tender.awarded_amount_xof != null ? String(detail.tender.awarded_amount_xof) : detail.tender.our_amount_xof != null ? String(detail.tender.our_amount_xof) : '')
        setError(null)
      })
      .catch(reason => setError(reason instanceof Error ? reason.message : 'Chargement impossible.'))
      .finally(() => setLoading(false))
  }, [id])
  useEffect(refresh, [refresh])

  const [orderCandidates, setOrderCandidates] = useState<{ id: string; order_number: string }[]>([])
  const [proposalCandidates, setProposalCandidates] = useState<{ id: string; proposal_number: string }[]>([])
  const [products, setProducts] = useState<ProductOption[]>([])

  if (loading) return <div className="crm-page"><div className="crm-empty">Chargement du dossier.</div></div>
  if (!detail) return <div className="crm-page"><div className="crm-alert" role="alert">{error ?? 'Dossier introuvable.'}</div></div>

  const tender = detail.tender
  const status: TenderStatus = tender.status
  const isTerminal = terminalStatuses.includes(status)
  const canItems = editablesStatuses.includes(status)
  const canEdit = can('appels_offres', 'update')
  const canAct = canEdit || can('appels_offres', 'validate')
  const transitions = allowedTransitions[status]
  const totalItems = detail.items.reduce((sum, item) => sum + Number(item.amount_xof), 0)
  const totals = tenderTotals(detail.items, vatRate)
  const responsible = firstEmbed(tender.profiles)

  async function act(action: () => Promise<void>, message: string) {
    setPending(true); setError(null); setNotice(null)
    try { await action(); setNotice(message); refresh() } catch (reason) { setError(reason instanceof Error ? reason.message : 'Action impossible.') } finally { setPending(false) }
  }

  function changeStatus(event: FormEvent) {
    event.preventDefault()
    if (!targetStatus) { setError('Choisissez un nouveau statut.'); return }
    if (targetStatus === 'gagne') {
      const amount = Number(wonAmount.replace(/\s/g, ''))
      if (!amount || amount <= 0) { setError('Montant du marché requis (> 0) pour marquer gagné.'); return }
      void act(() => setTenderStatus(tender.id, 'gagne', { p_awarded_amount_xof: amount }), 'Appel d’offres gagné.')
      return
    }
    if (targetStatus === 'perdu') {
      if (!lostReason.trim()) { setError('Motif de l’échec requis pour marquer perdu.'); return }
      void act(() => setTenderStatus(tender.id, 'perdu', { p_lost_reason: lostReason }), 'Appel d’offres perdu.')
      return
    }
    void act(() => setTenderStatus(tender.id, targetStatus, {}), `Statut : ${tenderStatusLabels[targetStatus]}.`)
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
        p_offer_template_id: newItem.product || null,
        p_item_category: newItem.category || null,
        p_specs: null,
      })
      setNewItem({ product: '', designation: '', quantity: '1', unit: '', unitPrice: '', notes: '', category: '' })
    }, 'Ligne ajoutée.')
  }

  function pickProduct(templateId: string) {
    const product = products.find(option => option.id === templateId)
    setNewItem(old => ({
      ...old,
      product: templateId,
      designation: old.designation.trim() || product?.name || '',
      unitPrice: old.unitPrice.trim() || (product?.price_xof != null ? String(product.price_xof) : ''),
    }))
  }

  function submitQuote(event: FormEvent) {
    event.preventDefault()
    if (!quoteDraft || !quoteDraft.supplier || !quoteDraft.amount) { setError('Fournisseur et montant obligatoires.'); return }
    const amount = Number(quoteDraft.amount)
    if (!Number.isFinite(amount) || amount <= 0) { setError('Montant du devis invalide.'); return }
    void act(async () => {
      await setTenderQuote(quoteDraft.itemId, quoteDraft.supplier, amount, {
        p_source: quoteDraft.source.trim() || null,
        p_notes: quoteDraft.notes.trim() || null,
        p_brand_model: quoteDraft.brand.trim() || null,
        p_transport_cost_xof: quoteDraft.transport ? Number(quoteDraft.transport) : 0,
        p_lead_time_days: quoteDraft.lead ? Number(quoteDraft.lead) : null,
        p_warranty_months: quoteDraft.warranty ? Number(quoteDraft.warranty) : null,
        p_availability: quoteDraft.availability || null,
      })
      setQuoteDraft(null)
    }, 'Devis fournisseur enregistré.')
  }

  function submitSelection(event: FormEvent) {
    event.preventDefault()
    if (!selectDraft || !selectDraft.supplier) { setError('Choisissez le fournisseur à retenir.'); return }
    if (!selectDraft.reason.trim() || selectDraft.reason.trim().length < 10) { setError('Justifiez le choix (10 caractères minimum).'); return }
    void act(async () => {
      await selectTenderSupplier(selectDraft.itemId, selectDraft.supplier, selectDraft.reason.trim())
      setSelectDraft(null)
    }, 'Fournisseur retenu.')
  }

  function openProjectForm() {
    const organism = firstEmbed(tender.companies)
    setProjectDraft({
      title: tender.title,
      budget: tender.awarded_amount_xof != null ? String(tender.awarded_amount_xof) : '',
      start: '',
      plannedEnd: '',
    })
    void organism
  }

  function submitProject(event: FormEvent) {
    event.preventDefault()
    if (!projectDraft || !projectDraft.title.trim()) { setError('Titre du projet requis.'); return }
    const organism = firstEmbed(tender.companies)
    if (!organism || !tender.organism_company_id) { setError('Organisme du DAO inconnu : impossible de rattacher un client au projet.'); return }
    void act(async () => {
      await createProjectFromTender({
        p_title: projectDraft.title.trim(),
        p_client_company_id: tender.organism_company_id,
        p_tender_id: tender.id,
        p_manager_id: tender.responsible_id,
        p_budget_xof: projectDraft.budget ? Number(projectDraft.budget.replace(/\s/g, '')) : null,
        p_start_date: projectDraft.start || null,
        p_planned_end_date: projectDraft.plannedEnd || null,
      })
      setProjectDraft(null)
    }, 'Projet créé à partir de l’appel d’offres gagné.')
  }

  function submitDocument(event: FormEvent) {
    event.preventDefault()
    if (!docDraft.file) { setError('Choisissez un fichier à déposer.'); return }
    const title = docDraft.title.trim() || docDraft.file.name
    void act(async () => {
      await attachTenderDocument(tender.id, docDraft.file!, docDraft.category, title)
      setDocDraft({ category: docDraft.category, title: '', file: null })
    }, 'Document rattaché au dossier.')
  }

  async function download(documentId: string) {
    try {
      const signed = await downloadUrl(documentId)
      window.open(signed.url, '_blank', 'noopener')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Téléchargement impossible.')
    }
  }

  return <div className="crm-page">
    <div className="crm-detail-head"><div>
      <span className="section-kicker">APPEL D’OFFRES {tender.tender_number}</span>
      <h1>{tender.title}</h1>
      <p>{companyLabel(firstEmbed(tender.companies))} · Dépôt : {shortDate(tender.submission_deadline)}{responsible ? ` · Responsable : ${responsible.full_name}` : ''}</p>
    </div><div className="crm-detail-actions">
      <span className={`crm-status ${tenderStatusClass[status]}`}>{tenderStatusLabels[status]}</span>
      {!isTerminal && canEdit && <Button asChild><Link to={`/appels-offres/${tender.id}/modifier`}>Modifier</Link></Button>}
    </div></div>
    {error && <div className="crm-alert" role="alert">{error}</div>}
    {notice && <div className="form-success" role="status">{notice}</div>}
    {pending && <div className="crm-empty">Traitement en cours…</div>}

    {canAct && !isTerminal && <form className="crm-toolbar dao-actions" onSubmit={changeStatus}>
      <select aria-label="Nouveau statut" value={targetStatus} onChange={event => setTargetStatus(event.target.value as TenderStatus | '')}>
        <option value="">Changer le statut…</option>
        {transitions.map(candidate => <option key={candidate} value={candidate}>{tenderStatusLabels[candidate]}</option>)}
      </select>
      {targetStatus === 'gagne' && <span className="dao-inline-field"><input inputMode="numeric" placeholder="Montant du marché (FCFA)" value={wonAmount} onChange={event => setWonAmount(event.target.value)} /></span>}
      {targetStatus === 'perdu' && <span className="dao-inline-field"><input placeholder="Motif de l’échec" value={lostReason} onChange={event => setLostReason(event.target.value)} /></span>}
      <Button type="submit" disabled={pending || !targetStatus}>Appliquer</Button>
    </form>}

    <div className="dao-grid">
      <section className="dao-panel">
        <h2>Détails</h2>
        <div className="dao-facts">
          <div><span>Secteur</span><strong>{tender.sector || '—'}</strong></div>
          <div><span>Source</span><strong>{tender.source || '—'}</strong></div>
          <div><span>Publication de l’avis</span><strong>{shortDate(tender.publication_date)}</strong></div>
          <div><span>Ouverture des plis</span><strong>{shortDate(tender.opening_at)}</strong></div>
          <div><span>Montant estimatif</span><strong>{xof(tender.estimated_amount_xof)}</strong></div>
          <div><span>Notre offre</span><strong>{xof(tender.our_amount_xof)}</strong></div>
          {tender.awarded_amount_xof != null && <div><span>Montant du marché</span><strong>{xof(tender.awarded_amount_xof)}</strong></div>}
          <div><span>Total des lignes</span><strong>{xof(totalItems)}</strong></div>
          <div><span>Total HT</span><strong>{xof(totals.ht)}</strong></div>
          <div><span>TVA ({vatRate} %)</span><strong>{xof(totals.tva)}</strong></div>
          <div><span>Total TTC</span><strong>{xof(totals.ttc)}</strong></div>
          {tender.announcement_url && <div className="dao-fact-wide"><span>Annonce</span><strong><a href={tender.announcement_url} target="_blank" rel="noopener noreferrer">Consulter l’annonce</a></strong></div>}
          {tender.submission_location && <div className="dao-fact-wide"><span>Lieu / plateforme de dépôt</span><strong>{tender.submission_location}</strong></div>}
          {tender.lost_reason && <div className="dao-fact-wide"><span>Motif de l’échec</span><strong>{tender.lost_reason}</strong></div>}
        </div>
        {tender.description && <p className="dao-notes"><strong>Description.</strong> {tender.description}</p>}
        {tender.observations && <p className="dao-notes"><strong>Observations.</strong> {tender.observations}</p>}
      </section>

      {status === 'gagne' && canEdit && <section className="dao-panel">
        <h2>Projet issu du marché</h2>
        {projectDraft
          ? <form className="crm-inline-form" onSubmit={submitProject}>
              <input required placeholder="Titre du projet" value={projectDraft.title} onChange={event => setProjectDraft(old => old && { ...old, title: event.target.value })} />
              <input inputMode="numeric" placeholder="Budget (FCFA)" value={projectDraft.budget} onChange={event => setProjectDraft(old => old && { ...old, budget: event.target.value })} />
              <input type="date" aria-label="Date de début" value={projectDraft.start} onChange={event => setProjectDraft(old => old && { ...old, start: event.target.value })} />
              <input type="date" aria-label="Fin prévue" value={projectDraft.plannedEnd} onChange={event => setProjectDraft(old => old && { ...old, plannedEnd: event.target.value })} />
              <Button type="submit" disabled={pending}>Créer le projet</Button>
              <Button type="button" variant="ghost" onClick={() => setProjectDraft(null)}>Annuler</Button>
            </form>
          : <Button variant="secondary" onClick={openProjectForm}><Plus size={15} /> Créer un projet depuis ce marché</Button>}
        {detail.linkedOrders.length > 0 && <p className="dao-notes" style={{ marginTop: 8 }}><strong>Commandes liées :</strong> {detail.linkedOrders.map(order => order.order_number).join(', ')} — le suivi opérationnel est déjà ouvert.</p>}
      </section>}

      <section className="dao-panel">
        <h2>Documents du dossier</h2>
        <div className="crm-table-wrap">
          <table className="crm-table">
            <thead><tr><th>Catégorie</th><th>Document</th><th>Ajouté</th><th /></tr></thead>
            <tbody>{detail.documents.map(row => <tr key={row.id}>
              <td><strong>{tenderCategoryLabels[row.category]}</strong></td>
              <td>{row.title}</td>
              <td>{shortDate(row.created_at)}</td>
              <td className="prod-actions">
                <button aria-label={`Télécharger ${row.title}`} onClick={() => void download(row.document_id)}><Download size={15} /></button>
                {canEdit && <button aria-label={`Retirer ${row.title}`} onClick={() => void act(() => removeTenderDocument(row.id), 'Document retiré du dossier (conservé en bibliothèque).')}><Trash2 size={15} /></button>}
              </td>
            </tr>)}
            </tbody>
          </table>
          {detail.documents.length === 0 && <div className="crm-empty">Aucun document rattaché.</div>}
        </div>
        {canEdit && <form className="crm-inline-form" onSubmit={submitDocument}>
          <select aria-label="Catégorie de document" value={docDraft.category} onChange={event => setDocDraft(old => ({ ...old, category: event.target.value as TenderCategory }))}>
            {Object.entries(tenderCategoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <input placeholder="Titre du document" value={docDraft.title} onChange={event => setDocDraft(old => ({ ...old, title: event.target.value }))} />
          <input type="file" aria-label="Fichier" onChange={event => setDocDraft(old => ({ ...old, file: event.target.files?.[0] ?? null }))} />
          <Button type="submit" disabled={pending || !docDraft.file}><Plus size={15} /> Déposer</Button>
        </form>}
      </section>

      <section className="dao-panel">
        <h2>Lignes du dossier</h2>
        <div className="crm-table-wrap">
          <table className="crm-table">
            <thead><tr><th>#</th><th>Désignation</th><th>Qté</th><th>Prix unitaire</th><th>Montant</th>{canItems && canEdit && <th />}</tr></thead>
            <tbody>{detail.items.map(item => {
              const selected = item.selected_supplier ? firstEmbed(item.selected_supplier) : null
              return <tr key={item.id}>
              <td>{item.position}</td>
              <td><strong>{item.designation}</strong>
                {item.item_category && <small>Catégorie : {tenderItemCategoryLabels[item.item_category] ?? item.item_category}</small>}
                {firstEmbed(item.offer_templates)?.name && <small>Produit : {firstEmbed(item.offer_templates)!.name}</small>}
                {item.notes && <small>{item.notes}</small>}
                {selected && <small>Fournisseur retenu : {companyLabel(selected)}{item.selected_reason ? ` — ${item.selected_reason}` : ''}</small>}
              </td>
              <td>{item.quantity} {item.unit ?? ''}</td>
              <td>{xof(item.unit_price_xof)}</td>
              <td>{xof(item.amount_xof)}</td>
              {canItems && canEdit && <td><button aria-label={`Retirer ${item.designation}`} onClick={() => void act(() => removeTenderItem(item.id), 'Ligne retirée.')}><Trash2 size={15} /></button></td>}
            </tr>})}
            </tbody>
          </table>
          {detail.items.length === 0 && <div className="crm-empty">Aucune ligne enregistrée.</div>}
        </div>
        {canItems && canEdit && <form className="crm-inline-form" onSubmit={submitItem}>
          <select aria-label="Produit du catalogue (optionnel)" value={newItem.product} onChange={event => pickProduct(event.target.value)}>
            <option value="">Produit libre…</option>
            {products.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
          </select>
          <input required placeholder="Désignation" value={newItem.designation} onChange={event => setNewItem(old => ({ ...old, designation: event.target.value }))} />
          <select aria-label="Catégorie de ligne" value={newItem.category} onChange={event => setNewItem(old => ({ ...old, category: event.target.value }))}>
            <option value="">Catégorie…</option>
            {Object.entries(tenderItemCategoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
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
            <thead><tr><th>Fournisseur</th><th>Ligne</th><th>Montant</th><th>Marque / modèle</th><th>Transport</th><th>Délai</th><th>Garantie</th><th>Dispo.</th>{canItems && canEdit && <th />}</tr></thead>
            <tbody>{detail.quotes.map(quote => {
              const item = detail.items.find(candidate => candidate.id === quote.tender_item_id)
              return <tr key={quote.id}>
                <td><strong>{companyLabel(firstEmbed(quote.companies))}</strong>{quote.quote_document_id && <small>Devis joint en bibliothèque</small>}</td>
                <td>{item?.designation ?? '—'}</td>
                <td>{xof(quote.quote_xof)}</td>
                <td>{quote.brand_model ?? '—'}</td>
                <td>{quote.transport_cost_xof != null && Number(quote.transport_cost_xof) > 0 ? xof(quote.transport_cost_xof) : '—'}</td>
                <td>{quote.lead_time_days != null ? `${quote.lead_time_days} j` : '—'}</td>
                <td>{quote.warranty_months != null ? `${quote.warranty_months} mois` : '—'}</td>
                <td>{quote.availability ? (availabilityLabels[quote.availability] ?? quote.availability) : '—'}</td>
                {canItems && canEdit && <td><button aria-label="Remplacer ce devis" onClick={() => setQuoteDraft({ itemId: quote.tender_item_id, supplier: quote.supplier_company_id, amount: String(quote.quote_xof), brand: quote.brand_model ?? '', transport: quote.transport_cost_xof != null ? String(quote.transport_cost_xof) : '', lead: quote.lead_time_days != null ? String(quote.lead_time_days) : '', warranty: quote.warranty_months != null ? String(quote.warranty_months) : '', availability: quote.availability ?? '', source: quote.source ?? '', notes: quote.notes ?? '' })}>Modifier</button></td>}
              </tr>
            })}
            </tbody>
          </table>
          {detail.quotes.length === 0 && <div className="crm-empty">Aucun devis enregistré.</div>}
        </div>
        {canItems && canEdit && (quoteDraft
          ? <form className="crm-inline-form" onSubmit={submitQuote}>
              <select required value={quoteDraft.supplier} onChange={event => setQuoteDraft(old => old && { ...old, supplier: event.target.value })}>
                <option value="">Fournisseur</option>
                {suppliers.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
              <select required aria-label="Ligne concernée" value={quoteDraft.itemId} onChange={event => setQuoteDraft(old => old && { ...old, itemId: event.target.value })}>
                {detail.items.map(item => <option key={item.id} value={item.id}>#{item.position} — {item.designation}</option>)}
              </select>
              <input required inputMode="numeric" placeholder="Montant du devis (FCFA)" value={quoteDraft.amount} onChange={event => setQuoteDraft(old => old && { ...old, amount: event.target.value })} />
              <input placeholder="Marque / modèle" value={quoteDraft.brand} onChange={event => setQuoteDraft(old => old && { ...old, brand: event.target.value })} />
              <input inputMode="numeric" placeholder="Transport (FCFA)" value={quoteDraft.transport} onChange={event => setQuoteDraft(old => old && { ...old, transport: event.target.value })} />
              <input inputMode="numeric" placeholder="Délai (jours)" value={quoteDraft.lead} onChange={event => setQuoteDraft(old => old && { ...old, lead: event.target.value })} />
              <input inputMode="numeric" placeholder="Garantie (mois)" value={quoteDraft.warranty} onChange={event => setQuoteDraft(old => old && { ...old, warranty: event.target.value })} />
              <select aria-label="Disponibilité" value={quoteDraft.availability} onChange={event => setQuoteDraft(old => old && { ...old, availability: event.target.value })}>
                <option value="">Disponibilité…</option>
                {Object.entries(availabilityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <input placeholder="Source du devis" value={quoteDraft.source} onChange={event => setQuoteDraft(old => old && { ...old, source: event.target.value })} />
              <input placeholder="Notes" value={quoteDraft.notes} onChange={event => setQuoteDraft(old => old && { ...old, notes: event.target.value })} />
              <Button type="submit" disabled={pending}>Enregistrer</Button>
              <Button type="button" variant="ghost" onClick={() => setQuoteDraft(null)}>Annuler</Button>
            </form>
          : <form onSubmit={event => { event.preventDefault(); if (detail.items[0]) setQuoteDraft({ itemId: detail.items[0].id, supplier: '', amount: '', brand: '', transport: '', lead: '', warranty: '', availability: '', source: '', notes: '' }) }}>
              <Button type="submit" variant="secondary" disabled={detail.items.length === 0}><Plus size={15} /> Ajouter un devis</Button>
            </form>)}
      </section>

      <section className="dao-panel">
        <h2>Comparaison des fournisseurs</h2>
        {detail.items.length === 0 ? <div className="crm-empty">Ajoutez des lignes pour comparer les offres.</div> : detail.items.map(item => {
          const quotes = detail.quotes.filter(quote => quote.tender_item_id === item.id)
          const best = quotes.reduce((lowest, quote) => Number(quote.quote_xof) < Number(lowest.quote_xof) ? quote : lowest, quotes[0])
          const selected = item.selected_supplier ? firstEmbed(item.selected_supplier) : null
          return <div key={item.id} className="dao-subhead" style={{ marginBottom: 8 }}>
            <strong>#{item.position} — {item.designation}</strong>
            {selected && <small style={{ marginLeft: 6 }}>Fournisseur retenu : {companyLabel(selected)}</small>}
            {quotes.length === 0 ? <div className="crm-empty" style={{ marginTop: 6 }}>Aucun devis pour cette ligne.</div> : <div className="crm-table-wrap" style={{ marginTop: 6 }}>
              <table className="crm-table">
                <thead><tr><th>Fournisseur</th><th>Montant</th><th>Marque / modèle</th><th>Transport</th><th>Délai</th><th>Garantie</th><th>Dispo.</th><th>Notes</th>{canItems && canEdit && <th />}</tr></thead>
                <tbody>{quotes.map(quote => <tr key={quote.id}>
                  <td><strong>{companyLabel(firstEmbed(quote.companies))}</strong>{best && quote.id === best.id && <small>Moins-disant</small>}</td>
                  <td>{xof(quote.quote_xof)}</td>
                  <td>{quote.brand_model ?? '—'}</td>
                  <td>{quote.transport_cost_xof != null && Number(quote.transport_cost_xof) > 0 ? xof(quote.transport_cost_xof) : '—'}</td>
                  <td>{quote.lead_time_days != null ? `${quote.lead_time_days} j` : '—'}</td>
                  <td>{quote.warranty_months != null ? `${quote.warranty_months} mois` : '—'}</td>
                  <td>{quote.availability ? (availabilityLabels[quote.availability] ?? quote.availability) : '—'}</td>
                  <td>{quote.notes ?? quote.source ?? '—'}</td>
                  {canItems && canEdit && <td>{selectDraft?.itemId === item.id
                    ? <form className="dao-select-form" onSubmit={submitSelection}>
                        <select required aria-label={`Fournisseur à retenir pour ${item.designation}`} value={selectDraft.supplier} onChange={event => setSelectDraft(old => old && { ...old, supplier: event.target.value })}>
                          <option value="">Fournisseur…</option>
                          {quotes.map(quote2 => <option key={quote2.id} value={quote2.supplier_company_id}>{companyLabel(firstEmbed(quote2.companies))}</option>)}
                        </select>
                        <input required placeholder="Justification du choix (10 car. min)" value={selectDraft.reason} onChange={event => setSelectDraft(old => old && { ...old, reason: event.target.value })} />
                        <Button type="submit" disabled={pending}>Retenir</Button>
                        <Button type="button" variant="ghost" onClick={() => setSelectDraft(null)}>Annuler</Button>
                      </form>
                    : <button onClick={() => setSelectDraft({ itemId: item.id, supplier: '', reason: '' })}>Retenir…</button>}</td>}
                </tr>)}
                </tbody>
              </table>
            </div>}
          </div>
        })}
      </section>

      <section className="dao-panel">
        <h2>Tâches et rappels</h2>
        <div className="crm-table-wrap">
          <table className="crm-table">
            <thead><tr><th>Tâche</th><th>Échéance</th><th>Assignée à</th><th>Fait</th><th /></tr></thead>
            <tbody>{detail.tasks.map(task => {
              const assignee = firstEmbed(task.profiles)
              return <tr key={task.id}>
                <td><strong style={task.is_done ? { textDecoration: 'line-through', opacity: 0.6 } : undefined}>{task.title}</strong></td>
                <td>{shortDate(task.due_date)}</td>
                <td>{assignee?.full_name ?? '—'}</td>
                <td><input type="checkbox" aria-label={`Tâche faite : ${task.title}`} checked={task.is_done} onChange={event => void act(() => setTenderTaskDone(task.id, event.target.checked), 'Tâche mise à jour.')} /></td>
                <td><button aria-label={`Supprimer ${task.title}`} onClick={() => void act(() => removeTenderTask(task.id), 'Tâche supprimée.')}><Trash2 size={15} /></button></td>
              </tr>
            })}
            </tbody>
          </table>
          {detail.tasks.length === 0 && <div className="crm-empty">Aucune tâche enregistrée.</div>}
        </div>
        <form className="crm-inline-form" onSubmit={event => { event.preventDefault(); if (!taskDraft.title.trim()) { setError('Titre de la tâche requis.'); return } void act(async () => { await addTenderTask(tender.id, taskDraft.title, taskDraft.due || null, taskDraft.assignee || null); setTaskDraft({ title: '', due: '', assignee: '' }) }, 'Tâche ajoutée.') }}>
          <input placeholder="Nouvelle tâche" value={taskDraft.title} onChange={event => setTaskDraft(old => ({ ...old, title: event.target.value }))} />
          <input type="date" aria-label="Échéance de la tâche" value={taskDraft.due} onChange={event => setTaskDraft(old => ({ ...old, due: event.target.value }))} />
          <select aria-label="Assignée à" value={taskDraft.assignee} onChange={event => setTaskDraft(old => ({ ...old, assignee: event.target.value }))}>
            <option value="">Non assignée</option>
            {people.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
          <Button type="submit" disabled={pending}><Plus size={15} /> Ajouter</Button>
        </form>
        <div className="crm-table-wrap" style={{ marginTop: 12 }}>
          <table className="crm-table">
            <thead><tr><th>Rappel</th><th>Quand</th><th>Fait</th></tr></thead>
            <tbody>{detail.reminders.map(reminder => <tr key={reminder.id}>
              <td><strong style={reminder.is_done ? { textDecoration: 'line-through', opacity: 0.6 } : undefined}>{reminder.note || 'Rappel'}</strong></td>
              <td>{new Date(reminder.remind_at).toLocaleString('fr-TG', { dateStyle: 'medium', timeStyle: 'short' })}</td>
              <td><input type="checkbox" aria-label="Rappel traité" checked={reminder.is_done} onChange={event => void act(() => setTenderReminderDone(reminder.id, event.target.checked), 'Rappel mis à jour.')} /></td>
            </tr>)}
            </tbody>
          </table>
          {detail.reminders.length === 0 && <div className="crm-empty">Aucun rappel programmé.</div>}
        </div>
        <form className="crm-inline-form" onSubmit={event => { event.preventDefault(); if (!reminderDraft.when) { setError('Choisissez la date du rappel.'); return } void act(async () => { await addTenderReminder(tender.id, new Date(reminderDraft.when).toISOString(), reminderDraft.note); setReminderDraft({ when: '', note: '' }) }, 'Rappel programmé.') }}>
          <input type="datetime-local" aria-label="Date du rappel" value={reminderDraft.when} onChange={event => setReminderDraft(old => ({ ...old, when: event.target.value }))} />
          <input placeholder="Note du rappel" value={reminderDraft.note} onChange={event => setReminderDraft(old => ({ ...old, note: event.target.value }))} />
          <Button type="submit" disabled={pending}><Plus size={15} /> Programmer</Button>
        </form>
      </section>

      <section className="dao-panel">
        <h2>Relations</h2>
        <h3 className="dao-subhead">Commandes liées</h3>
        {detail.linkedOrders.length === 0 ? <div className="crm-empty">Aucune commande rattachée.</div> : <ul className="dao-timeline">{detail.linkedOrders.map(order => (
          <li key={order.id}><strong><Link to={`/commandes/${order.id}`}>{order.order_number}</Link></strong><small>{orderStatusLabels[order.order_status] ?? order.order_status} · {xof(order.amount_xof)}</small></li>
        ))}</ul>}
        {can('commandes', 'update') && <form className="crm-inline-form" onSubmit={event => { event.preventDefault(); if (!orderDraft) return; void act(async () => { await linkOrder(orderDraft, tender.id); setOrderDraft('') }, 'Commande rattachée.') }}>
          <select aria-label="Commande à rattacher" value={orderDraft} onChange={event => setOrderDraft(event.target.value)}>
            <option value="">Rattacher une commande…</option>
            {orderCandidates.map(order => <option key={order.id} value={order.id}>{order.order_number}</option>)}
          </select>
          <Button type="submit" disabled={pending || !orderDraft}>Rattacher</Button>
        </form>}
        <h3 className="dao-subhead">Propositions liées</h3>
        {detail.linkedProposals.length === 0 ? <div className="crm-empty">Aucune proposition rattachée.</div> : <ul className="dao-timeline">{detail.linkedProposals.map(proposal => (
          <li key={proposal.id}><strong><Link to={`/propositions/${proposal.id}`}>{proposal.proposal_number}</Link></strong><small>{proposalStatusLabels[proposal.status] ?? proposal.status}</small></li>
        ))}</ul>}
        {can('propositions', 'update') && <form className="crm-inline-form" onSubmit={event => { event.preventDefault(); if (!proposalDraft) return; void act(async () => { await linkProposal(proposalDraft, tender.id); setProposalDraft('') }, 'Proposition rattachée.') }}>
          <select aria-label="Proposition à rattacher" value={proposalDraft} onChange={event => setProposalDraft(event.target.value)}>
            <option value="">Rattacher une proposition…</option>
            {proposalCandidates.map(proposal => <option key={proposal.id} value={proposal.id}>{proposal.proposal_number}</option>)}
          </select>
          <Button type="submit" disabled={pending || !proposalDraft}>Rattacher</Button>
        </form>}
        <h3 className="dao-subhead">Livraisons des commandes liées</h3>
        {detail.linkedDeliveries.length === 0 ? <div className="crm-empty">Aucune livraison pour ces commandes.</div> : <ul className="dao-timeline">{detail.linkedDeliveries.map(delivery => (
          <li key={delivery.id}><strong>{delivery.delivery_number}</strong><small>{delivery.kind === 'client_delivery' ? 'Livraison client' : 'Réception fournisseur'} · {deliveryStatusLabels[delivery.status] ?? delivery.status}{delivery.delivered_at ? ` · ${shortDate(delivery.delivered_at)}` : ''}</small></li>
        ))}</ul>}
      </section>

      <section className="dao-panel">
        <h2>Commentaires</h2>
        {detail.comments.length === 0 ? <div className="crm-empty">Aucun commentaire.</div> : <ul className="dao-timeline">{detail.comments.map(comment => {
          const author = firstEmbed(comment.profiles)
          return <li key={comment.id}><strong>{author?.full_name ?? 'Utilisateur'}</strong><small>{new Date(comment.created_at).toLocaleString('fr-TG', { dateStyle: 'medium', timeStyle: 'short' })}</small><p style={{ margin: '4px 0 0', fontSize: 12, color: '#4e6982' }}>{comment.body}</p></li>
        })}</ul>}
        <form className="crm-inline-form" onSubmit={event => { event.preventDefault(); if (!commentDraft.trim()) { setError('Écrivez un commentaire.'); return } void act(async () => { await addTenderComment(tender.id, commentDraft); setCommentDraft('') }, 'Commentaire publié.') }}>
          <input placeholder="Ajouter un commentaire…" value={commentDraft} onChange={event => setCommentDraft(event.target.value)} />
          <Button type="submit" disabled={pending}>Publier</Button>
        </form>
      </section>

      <section className="dao-panel">
        <h2>Historique des modifications</h2>
        {detail.events.length === 0 ? <div className="crm-empty">Aucun événement.</div> : <ul className="dao-timeline">{detail.events.map(event => (
          <li key={event.id}>
            <strong>{tenderEventLabels[event.event_type] ?? event.event_type}</strong>
            <small>{new Date(event.created_at).toLocaleString('fr-TG', { dateStyle: 'medium', timeStyle: 'short' })}{firstEmbed(event.profiles)?.full_name ? ` · ${firstEmbed(event.profiles)!.full_name}` : ''}</small>
          </li>
        ))}</ul>}
      </section>
    </div>
    <div className="crm-form-actions"><Button variant="ghost" asChild><Link to="/appels-offres">Retour à la liste <ArrowRight size={15} /></Link></Button></div>
  </div>
}
