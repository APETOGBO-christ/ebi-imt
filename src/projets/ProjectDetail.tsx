import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, CheckCircle2, CircleDot, ListPlus, Loader2, Lock, PencilLine, Trash2 } from 'lucide-react'
import { Button } from '../components/ui/button'
import { useAuth } from '../lib/auth'
import { usePermits } from '../lib/permissions'
import { getProject, getProjectEvents, getProjectSteps, listPersonOptions, addStep, removeStep, setStepStatus, setProgress } from './api'
import { dateFr, projectSourceLabels, projectStatusLabels, stepStatusLabels, whenFr, xof, type ProjectRow, type ProjectStepRow } from './types'

const stepIcons: Record<string, typeof CircleDot> = { a_faire: CircleDot, en_cours: Loader2, termine: CheckCircle2, bloque: Lock }

export function ProjectDetail() {
  const { id } = useParams()
  const { profile } = useAuth()
  const { can } = usePermits()
  const editable = can('projets', 'update')
  const [project, setProject] = useState<ProjectRow | null>(null)
  const [steps, setSteps] = useState<ProjectStepRow[]>([])
  const [events, setEvents] = useState<{ id: string; actor_id: string; event_type: string; details: Record<string, unknown>; created_at: string }[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [stepTitle, setStepTitle] = useState('')
  const [stepDue, setStepDue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    if (!id) return
    void (async () => {
      try {
        const [row, stepRows, eventRows, people] = await Promise.all([
          getProject(id), getProjectSteps(id), getProjectEvents(id), listPersonOptions()])
        setProject(row); setSteps(stepRows); setEvents(eventRows)
        setNames(Object.fromEntries(people.map(person => [person.id, person.full_name])))
      } catch (reason) { setError(reason instanceof Error ? reason.message : 'Erreur de chargement.') }
    })()
  }, [id, refresh])

  async function run(action: () => Promise<void>) {
    setBusy(true); setError(null)
    try { await action(); setRefresh(value => value + 1) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Action refusée.') }
    finally { setBusy(false) }
  }

  const client = (project as unknown as { companies?: { trade_name?: string | null; legal_name?: string }[] } | null)?.companies?.[0]
  const clientLabel = client?.trade_name?.trim() || client?.legal_name
  const closable = project && project.status !== 'completed' && project.status !== 'cancelled'

  return <div className="crm-page"><Link to="/projets" className="crm-back"><ArrowLeft size={16} /> Projets</Link>
    {error && <div className="crm-alert" role="alert">{error}</div>}
    {!project ? <div className="crm-empty">Chargement du projet…</div> : <>
      <div className="crm-detail-head"><span className="detail-logo"><span className="proj-progress-ring" aria-hidden="true">{project.progress_pct}<small>%</small></span></span>
        <div><span className="section-kicker">PROJET / {project.project_number}</span><h1>{project.title}</h1>
          <div className="detail-sub"><span className={`proj-badge ${project.status === 'completed' ? 'proj-done' : project.status === 'cancelled' ? 'proj-cancelled' : 'proj-active'}`}>{projectStatusLabels[project.status] ?? project.status}</span>
            <span>{projectSourceLabels[project.source as keyof typeof projectSourceLabels] ?? 'Provenance inconnue'}</span>
            {project.tender_id && <Link to={`/appels-offres/${project.tender_id}`}>Dossier DAO</Link>}</div></div>
        {editable && closable && <Link to={`/projets/${project.id}/modifier`} className="crm-quick-link"><PencilLine size={15} /> Modifier</Link>}
      </div>
      <div className="crm-detail-grid"><div>
        <section className="crm-section"><h2>Informations du projet</h2><div className="crm-facts">
          <div><span>Client</span><strong>{clientLabel ?? '—'}</strong></div>
          <div><span>Responsable</span><strong>{project.manager_id ? names[project.manager_id] ?? '—' : 'Non affecté'}</strong></div>
          <div><span>Montant contractuel</span><strong>{xof(project.contract_amount_xof)}</strong></div>
          <div><span>Budget</span><strong>{xof(project.budget_xof)}</strong></div>
          <div><span>Début</span><strong>{dateFr(project.start_date)}</strong></div>
          <div><span>Fin prévue</span><strong>{dateFr(project.planned_end_date)}</strong></div>
          <div><span>Fin réelle</span><strong>{dateFr(project.actual_end_date)}</strong></div>
          <div><span>Notes</span><strong>{project.notes || 'Aucune'}</strong></div>
        </div></section>
        <section className="crm-section"><h2>Étapes de travail</h2>
          {steps.map(step => {
            const Icon = stepIcons[step.status] ?? CircleDot
            return <div className="proj-step" key={step.id}>
              <Icon size={17} className={step.status === 'en_cours' ? 'proj-spin' : ''} />
              <div><strong>{step.title}</strong><small>{stepStatusLabels[step.status]} · position {step.position}{step.due_date ? ` · échéance ${dateFr(step.due_date)}` : ''}{step.completed_at ? ` · terminée ${whenFr(step.completed_at)}` : ''}</small></div>
              {editable && <div className="proj-step-actions">
                <select aria-label={`Statut de l’étape ${step.title}`} value={step.status} disabled={busy} onChange={event => { const value = event.target.value as typeof step.status; void run(() => setStepStatus(step.id, value)) }}>
                  {Object.entries(stepStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
                <Button variant="ghost" size="icon" disabled={busy} aria-label={`Supprimer l’étape ${step.title}`} onClick={() => void run(() => removeStep(step.id))}><Trash2 size={15} /></Button>
              </div>}
            </div>
          })}
          {steps.length === 0 && <div className="notif-empty">Aucune étape enregistrée.</div>}
          {editable && <form className="proj-step-form" onSubmit={event => { event.preventDefault(); if (!stepTitle.trim()) return; void run(async () => { await addStep(project.id, stepTitle.trim(), stepDue || null, null); setStepTitle(''); setStepDue('') }) }}>
            <ListPlus size={16} />
            <input aria-label="Intitulé de la nouvelle étape" placeholder="Nouvelle étape…" value={stepTitle} onChange={event => setStepTitle(event.target.value)} />
            <input type="date" aria-label="Échéance de l’étape" value={stepDue} onChange={event => setStepDue(event.target.value)} />
            <Button type="submit" disabled={busy || !stepTitle.trim()}>Ajouter</Button>
          </form>}
          <p className="commercial-note">L’avancement se recalcule automatiquement à chaque étape terminée.</p>
        </section>
      </div>
      <aside>
        <section className="crm-section"><h2>Avancement</h2>
          <div className="proj-progress-block"><strong>{project.progress_pct} %</strong>
            <div className="proj-progress-bar" role="progressbar" aria-valuenow={project.progress_pct} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${project.progress_pct}%` }} /></div>
          </div>
          {editable && <form className="proj-progress-form" onSubmit={event => { event.preventDefault(); const input = event.currentTarget.elements.namedItem('pct') as HTMLInputElement; void run(() => setProgress(project.id, Number(input.value))) }}>
            <label htmlFor="pct">Avancement manuel (0 à 100)</label>
            <input id="pct" name="pct" type="number" min={0} max={100} defaultValue={project.progress_pct} />
            <Button type="submit" disabled={busy}>Enregistrer</Button>
          </form>}
        </section>
        <section className="crm-section"><h2>Historique</h2>
          {events.length === 0 ? <div className="notif-empty">Aucune modification enregistrée.</div> :
            <ul className="dash-list">{events.map(event => <li key={event.id}><div><strong>{event.event_type.replace(/_/g, ' ')}</strong><small>{whenFr(event.created_at)} · {names[event.actor_id] ?? 'Système'}</small></div></li>)}</ul>}
        </section>
        {profile && <section className="crm-section"><h2>Achats et réceptions</h2><p className="commercial-note">Les commandes fournisseurs rattachées à ce projet sont suivies dans le module Achats.</p><Link className="crm-quick-link" to="/achats">Ouvrir les achats <ArrowRight size={15} /></Link></section>}
      </aside></div>
    </>}
  </div>
}
