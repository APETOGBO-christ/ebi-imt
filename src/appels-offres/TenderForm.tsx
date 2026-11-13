import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { Button } from '../components/ui/button'
import { createTender, getTender, listCompanyOptions, updateTender, type CompanyOption, type TenderPayload } from './api'
import { usePermits } from '../lib/permissions'

function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  const offset = date.getTimezoneOffset()
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 16)
}

export function TenderForm() {
  const { id } = useParams()
  const editing = Boolean(id)
  const navigate = useNavigate()
  const { can, loading: permitsLoading } = usePermits()
  const [companies, setCompanies] = useState<CompanyOption[]>([])
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({ p_title: '', p_organism_company_id: '', p_sector: '', p_source: '', p_submission_deadline: '', p_opening_at: '', p_notes: '' })

  useEffect(() => {
    let active = true
    const jobs: Promise<void>[] = [listCompanyOptions().then(rows => { if (active) setCompanies(rows) })]
    if (id) jobs.push(getTender(id).then(detail => {
      if (!active) return
      setForm({
        p_title: detail.tender.title,
        p_organism_company_id: detail.tender.organism_company_id,
        p_sector: detail.tender.sector ?? '',
        p_source: detail.tender.source ?? '',
        p_submission_deadline: toLocalInput(detail.tender.submission_deadline),
        p_opening_at: toLocalInput(detail.tender.opening_at),
        p_notes: detail.tender.preparation_notes ?? '',
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
      p_sector: form.p_sector.trim() || null,
      p_source: form.p_source.trim() || null,
      p_submission_deadline: new Date(form.p_submission_deadline).toISOString(),
      p_opening_at: form.p_opening_at ? new Date(form.p_opening_at).toISOString() : null,
      p_notes: form.p_notes.trim() || null,
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
    <div className="crm-page-head"><div><span className="section-kicker">APPELS D’OFFRES</span><h1>{editing ? 'Modifier le dossier' : 'Nouvel appel d’offres'}</h1><p>{editing ? 'Seules les informations du dossier en préparation peuvent être ajustées.' : 'Enregistrez un dossier d’appel d’offres et son échéance de dépôt.'}</p></div></div>
    {error && <div className="crm-alert" role="alert">{error}</div>}
    <form className="crm-form" onSubmit={submit}>
      <div className="crm-form-section"><h2>Dossier</h2><div className="crm-form-grid">
        <label className="crm-field crm-field-wide">Intitulé du marché
          <input required maxLength={200} value={form.p_title} onChange={event => setForm(old => ({ ...old, p_title: event.target.value }))} placeholder="Ex. Construction du bâtiment administratif" /></label>
        <label className="crm-field">Organisme (société du référentiel)
          <select required value={form.p_organism_company_id} onChange={event => setForm(old => ({ ...old, p_organism_company_id: event.target.value }))}>
            <option value="">Sélectionner un organisme</option>
            {companies.map(option => <option key={option.id} value={option.id}>{option.trade_name?.trim() || option.legal_name}</option>)}
          </select></label>
        <label className="crm-field">Secteur
          <input value={form.p_sector ?? ''} onChange={event => setForm(old => ({ ...old, p_sector: event.target.value }))} placeholder="Ex. BTP, énergie, télécoms" /></label>
        <label className="crm-field">Source de l’avis
          <input value={form.p_source ?? ''} onChange={event => setForm(old => ({ ...old, p_source: event.target.value }))} placeholder="Ex. Presse, portail, contact direct" /></label>
      </div></div>
      <div className="crm-form-section"><h2>Calendrier</h2><div className="crm-form-grid">
        <label className="crm-field">Date limite de dépôt *
          <input required type="datetime-local" value={form.p_submission_deadline} onChange={event => setForm(old => ({ ...old, p_submission_deadline: event.target.value }))} /></label>
        <label className="crm-field">Ouverture des plis
          <input type="datetime-local" value={form.p_opening_at ?? ''} onChange={event => setForm(old => ({ ...old, p_opening_at: event.target.value }))} /></label>
      </div></div>
      <div className="crm-form-section"><h2>Notes de préparation</h2>
        <label className="crm-field crm-field-wide">Notes internes
          <textarea rows={4} value={form.p_notes ?? ''} onChange={event => setForm(old => ({ ...old, p_notes: event.target.value }))} placeholder="Points de vigilance, pièces à réunir, interlocuteurs." /></label></div>
      <div className="crm-form-actions">
        <Button type="submit" disabled={pending}>{pending ? 'Enregistrement…' : 'Enregistrer'} <ArrowRight size={16} /></Button>
        <Button type="button" variant="secondary" asChild><Link to={editing && id ? `/appels-offres/${id}` : '/appels-offres'}>Annuler</Link></Button>
      </div>
    </form>
  </div>
}
