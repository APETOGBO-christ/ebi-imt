import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, FolderOpen, Plus, Search } from 'lucide-react'
import { Button } from '../components/ui/button'
import { usePermits } from '../lib/permissions'
import { listProjects, listPersonOptions } from './api'
import { dateFr, projectSourceLabels, projectStatusLabels, xof, type ProjectRow } from './types'

const statusClass: Record<string, string> = {
  active: 'proj-badge proj-active', in_progress: 'proj-badge proj-active', paused: 'proj-badge proj-paused',
  completed: 'proj-badge proj-done', cancelled: 'proj-badge proj-cancelled',
}

export function ProjectsPage() {
  const { can } = usePermits()
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [source, setSource] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const [rows, people] = await Promise.all([listProjects(), listPersonOptions()])
        setProjects(rows)
        setNames(Object.fromEntries(people.map(person => [person.id, person.full_name])))
      } catch (reason) { setError(reason instanceof Error ? reason.message : 'Erreur de chargement.') }
      finally { setLoading(false) }
    })()
  }, [])

  const shown = projects.filter(item =>
    (!status || item.status === status) && (!source || item.source === source) &&
    (!search || `${item.project_number} ${item.title}`.toLowerCase().includes(search.toLowerCase())))

  return <div className="crm-page">
    <div className="crm-page-head">
      <div><span className="section-kicker">PROJETS</span><h1>Projets</h1><p>Chaque projet suit ses étapes, son avancement et son montant contractuel, issu d’un DAO, d’une commande directe ou d’une opération commerciale.</p></div>
      {can('projets', 'insert') && <Button asChild><Link to="/projets/nouveau"><Plus size={16} /> Nouveau projet</Link></Button>}
    </div>
    {error && <div className="crm-alert" role="alert">{error}</div>}
    <div className="crm-toolbar">
      <div className="crm-search"><Search size={16} /><input aria-label="Rechercher un projet" placeholder="Numéro ou intitulé…" value={search} onChange={event => setSearch(event.target.value)} /></div>
      <select aria-label="Filtrer par statut" value={status} onChange={event => setStatus(event.target.value)}>
        <option value="">Tous les statuts</option>{Object.entries(projectStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <select aria-label="Filtrer par provenance" value={source} onChange={event => setSource(event.target.value)}>
        <option value="">Toutes les provenances</option>{Object.entries(projectSourceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </div>
    <div className="crm-table-wrap"><table className="crm-table">
      <thead><tr><th>Projet</th><th>Client</th><th>Provenance</th><th>Avancement</th><th>Montant contractuel</th><th>Responsable</th><th>Échéance</th><th /></tr></thead>
      <tbody>{loading ? <tr><td colSpan={8}>Chargement…</td></tr> : shown.map(item => <tr key={item.id}>
        <td><strong>{item.project_number}</strong><small>{item.title}</small></td>
        <td>{clientName(item)}</td>
        <td>{item.source ? projectSourceLabels[item.source] : '—'}</td>
        <td><span className={statusClass[item.status] ?? 'proj-badge'}>{projectStatusLabels[item.status] ?? item.status}</span><small>{item.progress_pct} %</small></td>
        <td>{xof(item.contract_amount_xof)}</td>
        <td>{item.manager_id ? names[item.manager_id] ?? '—' : 'Non affecté'}</td>
        <td>{dateFr(item.planned_end_date)}</td>
        <td><Link to={`/projets/${item.id}`} aria-label={`Ouvrir ${item.project_number}`}><ArrowRight size={16} /></Link></td>
      </tr>)}
      {!loading && shown.length === 0 && <tr><td colSpan={8}><div className="crm-empty">Aucun projet correspondant. Un projet naît d’un DAO gagné, d’une commande directe ou d’une opération commerciale.</div></td></tr>}</tbody>
    </table></div>
    <p className="proj-foot"><FolderOpen size={14} /> Les projets issus d’un appel d’offres sont créés automatiquement depuis le dossier DAO gagné.</p>
  </div>
}

function clientName(item: ProjectRow) {
  const company = (item as unknown as { companies?: { trade_name?: string | null; legal_name?: string }[] }).companies
  return company?.[0]?.trade_name?.trim() || company?.[0]?.legal_name || '—'
}
