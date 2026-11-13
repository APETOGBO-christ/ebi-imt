import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { Button } from '../components/ui/button'
import { createTender, getTender, listCompanyOptions, listResponsibleOptions, updateTender, type CompanyOption, type PersonOption, type TenderPayload } from './api'
import { usePermits } from '../lib/permissions'

function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  const offset = date.getTimezoneOffset()
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 16)
}

function toDateInput(iso: string | null): string {
  return iso ? iso.slice(0, 10) : ''
}

interface FormState {
  p_title: string
  p_organism_company_id: string
  p_sector: string
  p_source: string
  p_submission_deadline: string
  p_opening_at: string
  p_observations: string
  p_description: string
  p_publication_date: string
  p_estimated_amount_xof: string
  p_our_amount_xof: string
  p_responsible_id: string
}

const empty: FormState = { p_title: '', p_organism_company_id: '', p_sector: '', p_source: '', p_submission_deadline: '', p_opening_at: '', p_observations: '', p_description: '', p_publication_date: '', p_estimated_amount_xof: '', p_our_amount_xof: '', p_responsible_id: '' }

export function TenderForm() {
  const { id } = useParams()
  const editing = Boolean(id)
  const navigate = useNavigate()
  const { can, loading: permitsLoading } = usePermits()
  const [companies, setCompanies] = useState<CompanyOption[]>([])
  const [people, setPeople] = useState<PersonOption[]>([])
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(empty)

  useEffect(() => {
    let active = true
    const jobs: Promise<void>[] = [
      listCompanyOptions().then(rows => { if (active) setCompanies(rows) }),
      listResponsibleOptions().then(rows => { if (active) setPeople(rows) }),
    ]
    if (id) jobs.push(getTender(id).then(detail => {
      if (!active) return
      const tender = detail.tender
      setForm({
        p_title: tender.title,
        p_organism_company_id: tender.organism_company_id,
        p_sector: tender.sector ?? '',
        p_source: tender.source ?? '',
        p_submission_deadline: toLocalInput(tender.submission_deadline),
        p_opening_at: toLocalInput(tender.opening_at),
        p_observations: tender.observations ?? '',
        p_description: tender.description ?? '',
        p_publication_date: toDateInput(tender.publication_date),
        p_estimated_amount_xof: tender.estimated_amount_xof != null ? String(tender.estimated_amount_xof) : '',
        p_our_amount_xof: tender.our_amount_xof != null ? String(tender.our_amount_xof) : '',
        p_responsible_id: tender.responsible_id ?? '',
      })
    }))
    Promise.all(jobs).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Chargement impossible.') }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [id])

  if (!permitsLoading && !can('appels_offres', 'insert')) return <div className="crm-page"><div className="crm-alert" role="alert">Votre rôle ne permet pas de gérer les appels d’offres.</div></div>
  if (loading) return <div className="crm-page"><div className="crm-empty">Chargement.</div></div>

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!form.p_title.trim() || !form.p_organism_company_id || !form.p_submission_deadline) { setError('Intitulé, organisme et date limite sont obligatoires.'); return }
    setPending(true); setError(null)
    const payload: TenderPayload = {
      p_title: form.p_title.trim(),
      p_organism_company_id: form.p_organism_company_id,
      p_submission_deadline: new Date(form.p_submission_deadline).toISOString(),
      p_sector: form.p_sector.trim() || null,
      p_source: form.p_source.trim() || null,
      p_opening_at: form.p_opening_at ? new Date(form.p_opening_at).toISOString() : null,
      p_observations: form.p_observations.trim() || null,
      p_description: form.p_description.trim() || null,
      p_publication_date: form.p_publication_date || null,
      p_estimated_amount_xof: form.p_estimated_amount_xof ? Number(form.p_estimated_amount_xof.replace(/\s/g, '')) : null,
      p_our_amount_xof: form.p_our_amount_xof ? Number(form.p_our_amount_xof.replace(/\s/g, '')) : null,
      p_responsible_id: form.p_responsible_id || null,
    }
    try {
      if (editing && id) { await updateTender(id, payload); navigate(`/appels-offres/${id}`) }
      else { const created = await createTender(payload); navigate(`/appels-offres/${created}`) }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Enregistrement impossible.')
      setPending(false)
    }
  }

  return <div className="crm-page">
    <div className="crm-page-head"><div><span className="section-kicker">APPELS D’OFFRES</span><h1>{editing ? 'Modifier le dossier' : 'Nouvel appel d’offres'}</h1><p>{editing ? 'Ajustez le dossier ; un dossier clos (gagné, perdu, annulé) n’est plus modifiable.' : 'Enregistrez l’avis, son échéance de dépôt et le responsable interne.'}</p></div></div>
    {error && <div className="crm-alert" role="alert">{error}</div>}
    <form className="crm-form" onSubmit={submit}>
      <div className="crm-form-section"><h2>Identification</h2><div className="crm-form-grid">
        <label className="crm-field crm-field-wide">Intitulé du marché
          <input required maxLength={200} value={form.p_title} onChange={event => setForm(old => ({ ...old, p_title: event.target.value }))} placeholder="Ex. Construction du bâtiment administratif" /></label>
        <label className="crm-field">Organisme émetteur (société du référentiel)
          <select required value={form.p_organism_company_id} onChange={event => setForm(old => ({ ...old, p_organism_company_id: event.target.value }))}>
            <option value="">Sélectionner un organisme</option>
            {companies.map(option => <option key={option.id} value={option.id}>{option.trade_name?.trim() || option.legal_name}</option>)}
          </select></label>
        <label className="crm-field">Responsable interne
          <select value={form.p_responsible_id} onChange={event => setForm(old => ({ ...old, p_responsible_id: event.target.value }))}>
            <option value="">Non désigné</option>
            {people.map(option => <option key={option.id} value={option.id}>{option.full_name}</option>)}
          </select></label>
        <label className="crm-field">Secteur
          <input value={form.p_sector} onChange={event => setForm(old => ({ ...old, p_sector: event.target.value }))} placeholder="Ex. BTP, énergie, télécoms" /></label>
        <label className="crm-field">Source de l’avis
          <input value={form.p_source} onChange={event => setForm(old => ({ ...old, p_source: event.target.value }))} placeholder="Ex. Presse, portail, contact direct" /></label>
      </div></div>
      <div className="crm-form-section"><h2>Dates</h2><div className="crm-form-grid">
        <label className="crm-field">Date de publication de l’avis
          <input type="date" value={form.p_publication_date} onChange={event => setForm(old => ({ ...old, p_publication_date: event.target.value }))} /></label>
        <label className="crm-field">Date limite de dépôt *
          <input required type="datetime-local" value={form.p_submission_deadline} onChange={event => setForm(old => ({ ...old, p_submission_deadline: event.target.value }))} /></label>
        <label className="crm-field">Ouverture des plis
          <input type="datetime-local" value={form.p_opening_at} onChange={event => setForm(old => ({ ...old, p_opening_at: event.target.value }))} /></label>
      </div></div>
      <div className="crm-form-section"><h2>Montants</h2><div className="crm-form-grid">
        <label className="crm-field">Montant estimatif du marché (FCFA)
          <input inputMode="numeric" value={form.p_estimated_amount_xof} onChange={event => setForm(old => ({ ...old, p_estimated_amount_xof: event.target.value }))} placeholder="Ex. 25000000" /></label>
        <label className="crm-field">Montant de notre offre (FCFA)
          <input inputMode="numeric" value={form.p_our_amount_xof} onChange={event => setForm(old => ({ ...old, p_our_amount_xof: event.target.value }))} placeholder="Ex. 23800000" /></label>
      </div></div>
      <div className="crm-form-section"><h2>Description et observations</h2><div className="crm-form-grid">
        <label className="crm-field crm-field-wide">Description de l’objet du marché
          <textarea rows={4} value={form.p_description} onChange={event => setForm(old => ({ ...old, p_description: event.target.value }))} placeholder="Objet, périmètre, exigences principales de l’avis." /></label>
        <label className="crm-field crm-field-wide">Observations
          <textarea rows={4} value={form.p_observations} onChange={event => setForm(old => ({ ...old, p_observations: event.target.value }))} placeholder="Points de vigilance, pièces à réunir, interlocuteurs." /></label>
      </div></div>
      <div className="crm-form-actions">
        <Button type="submit" disabled={pending}>{pending ? 'Enregistrement…' : 'Enregistrer'} <ArrowRight size={16} /></Button>
        <Button type="button" variant="secondary" asChild><Link to={editing && id ? `/appels-offres/${id}` : '/appels-offres'}>Annuler</Link></Button>
      </div>
    </form>
  </div>
}
