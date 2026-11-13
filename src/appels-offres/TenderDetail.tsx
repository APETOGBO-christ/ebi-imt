import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowRight, Download, Plus, Trash2 } from 'lucide-react'
import { Button } from '../components/ui/button'
import { downloadUrl } from '../bibliotheque/api'
import { usePermits } from '../lib/permissions'
import {
  addTenderComment, addTenderItem, addTenderReminder, addTenderTask, attachTenderDocument,
  getTender, linkOrder, linkProposal, listCompanyOptions, listLinkableOrders, listLinkableProposals,
  listResponsibleOptions, removeTenderDocument, removeTenderItem, removeTenderTask,
  setTenderQuote, setTenderReminderDone, setTenderStatus, setTenderTaskDone, type TenderDetail,
} from './api'
import {
  allowedTransitions, companyLabel, firstEmbed, shortDate, tenderCategoryLabels, tenderEventLabels,
  tenderStatusClass, tenderStatusLabels, terminalStatuses, xof, type TenderCategory, type TenderStatus,
} from './types'

const editablesStatuses: TenderStatus[] = ['identifie', 'a_analyser', 'en_preparation', 'attente_documents', 'pret_deposer']
const orderStatusLabels: Record<string, string> = { draft: 'Brouillon', confirmed: 'Confirmée', cancelled: 'Annulée', completed: 'Terminée' }
const proposalStatusLabels: Record<string, string> = { draft: 'Brouillon', pending_approval: 'À valider', approved: 'Validée', sent: 'Envoyée', accepted: 'Acceptée', rejected: 'Refusée', cancelled: 'Annulée' }

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
  const [newItem, setNewItem] = useState({ designation: '', quantity: '1', unit: '', unitPrice: '', notes: '' })
  const [quoteDraft, setQuoteDraft] = useState<{ itemId: string; supplier: string; amount: string } | null>(null)
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
    Promise.all([getTender(id), listCompanyOptions(), listResponsibleOptions(), listLinkableOrders(), listLinkableProposals()])
      .then(([detail, options, persons, orders, proposals]) => {
        setDetail(detail)
        setSuppliers(options.map(option => ({ id: option.id, label: option.trade_name?.trim() || option.legal_name })))
        setPeople(persons.map(option => ({ id: option.id, label: option.full_name })))
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
      })
      setNewItem({ designation: '', quantity: '1', unit: '', unitPrice: '', notes: '' })
    }, 'Ligne ajoutée.')
  }

  function submitQuote(event: FormEvent) {
    event.preventDefault()
    if (!quoteDraft || !quoteDraft.supplier || !quoteDraft.amount) { setError('Fournisseur et montant obligatoires.'); return }
    void act(async () => {
      await setTenderQuote(quoteDraft.itemId, quoteDraft.supplier, Number(quoteDraft.amount), null, null)
      setQuoteDraft(null)
    }, 'Devis fournisseur enregistré.')
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
          {tender.lost_reason && <div className="dao-fact-wide"><span>Motif de l’échec</span><strong>{tender.lost_reason}</strong></div>}
        </div>
        {tender.description && <p className="dao-notes"><strong>Description.</strong> {tender.description}</p>}
        {tender.observations && <p className="dao-notes"><strong>Observations.</strong> {tender.observations}</p>}
      </section>

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
            <tbody>{detail.items.map(item => <tr key={item.id}>
              <td>{item.position}</td>
              <td><strong>{item.designation}</strong>{item.notes && <small>{item.notes}</small>}</td>
              <td>{item.quantity} {item.unit ?? ''}</td>
              <td>{xof(item.unit_price_xof)}</td>
              <td>{xof(item.amount_xof)}</td>
              {canItems && canEdit && <td><button aria-label={`Retirer ${item.designation}`} onClick={() => void act(() => removeTenderItem(item.id), 'Ligne retirée.')}><Trash2 size={15} /></button></td>}
            </tr>)}
            </tbody>
          </table>
          {detail.items.length === 0 && <div className="crm-empty">Aucune ligne enregistrée.</div>}
        </div>
        {canItems && canEdit && <form className="crm-inline-form" onSubmit={submitItem}>
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
            <thead><tr><th>Fournisseur</th><th>Ligne</th><th>Montant</th>{canItems && canEdit && <th />}</tr></thead>
            <tbody>{detail.quotes.map(quote => {
              const item = detail.items.find(candidate => candidate.id === quote.tender_item_id)
              return <tr key={quote.id}>
                <td><strong>{companyLabel(firstEmbed(quote.companies))}</strong></td>
                <td>{item?.designation ?? '—'}</td>
                <td>{xof(quote.quote_xof)}</td>
                {canItems && canEdit && <td><button aria-label="Remplacer ce devis" onClick={() => setQuoteDraft({ itemId: quote.tender_item_id, supplier: quote.supplier_company_id, amount: String(quote.quote_xof) })}>Modifier</button></td>}
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
              <input required inputMode="numeric" placeholder="Montant du devis (FCFA)" value={quoteDraft.amount} onChange={event => setQuoteDraft(old => old && { ...old, amount: event.target.value })} />
              <Button type="submit" disabled={pending}>Enregistrer</Button>
              <Button type="button" variant="ghost" onClick={() => setQuoteDraft(null)}>Annuler</Button>
            </form>
          : <form onSubmit={event => { event.preventDefault(); if (detail.items[0]) setQuoteDraft({ itemId: detail.items[0].id, supplier: '', amount: '' }) }}>
              <Button type="submit" variant="secondary" disabled={detail.items.length === 0}><Plus size={15} /> Ajouter un devis</Button>
            </form>)}
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
