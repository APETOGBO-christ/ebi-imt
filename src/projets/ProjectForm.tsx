import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Button } from '../components/ui/button'
import { getProject, listClientCompanies, listPersonOptions, createProjectDirect, updateProject, type ProjectInput } from './api'

type FormState = { title: string; client_company_id: string; manager_id: string; start_date: string; planned_end_date: string; budget_xof: number | null; contract_amount_xof: number | null; notes: string; source: string }

export function ProjectForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const editing = Boolean(id)
  const [companies, setCompanies] = useState<{ id: string; label: string }[]>([])
  const [people, setPeople] = useState<{ id: string; full_name: string }[]>([])
  const [form, setForm] = useState<FormState>({ title: '', client_company_id: '', manager_id: '', source: 'commande_directe', start_date: '', planned_end_date: '', budget_xof: null, contract_amount_xof: null, notes: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    void (async () => {
      try {
        const [clients, persons] = await Promise.all([listClientCompanies(), listPersonOptions()])
        setCompanies(clients); setPeople(persons)
        if (id) {
          const row = await getProject(id)
          setForm({
            title: row.title, client_company_id: row.client_company_id,
            manager_id: row.manager_id ?? '', start_date: row.start_date ?? '', planned_end_date: row.planned_end_date ?? '',
            budget_xof: row.budget_xof ?? null, contract_amount_xof: row.contract_amount_xof ?? null, notes: row.notes ?? '',
            source: row.source ?? 'commande_directe',
          })
        }
      } catch (reason) { setError(reason instanceof Error ? reason.message : 'Erreur de chargement.') }
    })()
  }, [id])

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(null)
    try {
      const input: ProjectInput = {
        title: form.title.trim(), client_company_id: form.client_company_id,
        manager_id: form.manager_id || null,
        start_date: form.start_date || null, planned_end_date: form.planned_end_date || null,
        budget_xof: form.budget_xof, contract_amount_xof: form.contract_amount_xof, notes: form.notes.trim() || null,
      }
      if (editing && id) await updateProject(id, input)
      else await createProjectDirect(input, form.source === 'operation_commerciale' ? 'operation_commerciale' : 'commande_directe')
      navigate('/projets')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Enregistrement refusé.') }
    finally { setBusy(false) }
  }

  return <div className="crm-page"><Link to="/projets" className="crm-back"><ArrowLeft size={16} /> Projets</Link>
    <div className="crm-page-head"><div><span className="section-kicker">PROJETS</span><h1>{editing ? 'Modifier le projet' : 'Nouveau projet'}</h1>
      <p>{editing ? 'Les projets clos ne sont plus modifiables.' : 'Projet issu d’une commande directe ou d’une opération commerciale. Les projets DAO naissent depuis le dossier gagné.'}</p></div></div>
    {error && <div className="crm-alert" role="alert">{error}</div>}
    <form className="crm-form" onSubmit={submit}>
      <label htmlFor="p-title">Intitulé (200 caractères maximum)</label>
      <input id="p-title" required maxLength={200} value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} />
      <label htmlFor="p-client">Client</label>
      <select id="p-client" required value={form.client_company_id} onChange={event => setForm({ ...form, client_company_id: event.target.value })}>
        <option value="">Sélectionner une société…</option>
        {companies.map(company => <option key={company.id} value={company.id}>{company.label}</option>)}
      </select>
      {!editing && <>
        <label htmlFor="p-source">Provenance</label>
        <select id="p-source" value={form.source} onChange={event => setForm({ ...form, source: event.target.value })}>
          <option value="commande_directe">Commande directe</option>
          <option value="operation_commerciale">Opération commerciale</option>
        </select>
      </>}
      <label htmlFor="p-manager">Responsable interne</label>
      <select id="p-manager" value={form.manager_id} onChange={event => setForm({ ...form, manager_id: event.target.value })}>
        <option value="">Non affecté</option>
        {people.map(person => <option key={person.id} value={person.id}>{person.full_name}</option>)}
      </select>
      <div className="proj-form-grid">
        <div><label htmlFor="p-start">Date de début</label><input id="p-start" type="date" value={form.start_date} onChange={event => setForm({ ...form, start_date: event.target.value })} /></div>
        <div><label htmlFor="p-end">Fin prévue</label><input id="p-end" type="date" value={form.planned_end_date} onChange={event => setForm({ ...form, planned_end_date: event.target.value })} /></div>
        <div><label htmlFor="p-budget">Budget (FCFA)</label><input id="p-budget" type="number" min={0} value={form.budget_xof ?? ''} onChange={event => setForm({ ...form, budget_xof: event.target.value === '' ? null : Number(event.target.value) })} /></div>
        <div><label htmlFor="p-contract">Montant contractuel (FCFA)</label><input id="p-contract" type="number" min={0} value={form.contract_amount_xof ?? ''} onChange={event => setForm({ ...form, contract_amount_xof: event.target.value === '' ? null : Number(event.target.value) })} /></div>
      </div>
      <label htmlFor="p-notes">Notes</label>
      <textarea id="p-notes" rows={3} value={form.notes} onChange={event => setForm({ ...form, notes: event.target.value })} />
      <div className="crm-form-actions"><Button type="submit" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer le projet'}</Button></div>
    </form>
  </div>
}
