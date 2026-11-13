import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Gavel, Plus, Search } from 'lucide-react'
import { Button } from '../components/ui/button'
import { usePermits } from '../lib/permissions'
import { listTenders, type TenderFilters } from './api'
import { companyLabel, tenderStatusClass, tenderStatusLabels, type TenderRow } from './types'

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-TG', { day: '2-digit', month: 'short', year: 'numeric' })
}

const pageSize = 20

export function TendersPage() {
  const { can, loading: permitsLoading } = usePermits()
  const [filters, setFilters] = useState<TenderFilters>({ search: '', status: '', sort: 'deadline', dir: 'asc', page: 0, pageSize })
  const [rows, setRows] = useState<TenderRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    const handle = setTimeout(() => {
      setLoading(true)
      listTenders(filters)
        .then(result => { if (active) { setRows(result.rows); setTotal(result.total); setError(null) } })
        .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Chargement impossible.') })
        .finally(() => { if (active) setLoading(false) })
    }, 200)
    return () => { active = false; clearTimeout(handle) }
  }, [filters])

  const pages = Math.max(1, Math.ceil(total / pageSize))
  const canCreate = !permitsLoading && can('appels_offres', 'insert')

  return <div className="crm-page">
    <div className="crm-page-head"><div><span className="section-kicker">APPELS D’OFFRES</span><h1>Appels d’offres</h1><p>Suivi des dossiers d’appel d’offres : préparation, dépôt, résultat et lignes chiffrées.</p></div>
      {canCreate && <div className="crm-head-actions"><Button asChild><Link to="/appels-offres/nouveau"><Plus size={17} /> Nouvel appel d’offres</Link></Button></div>}
    </div>
    <div className="crm-toolbar">
      <div className="crm-search"><Search size={17} /><input aria-label="Rechercher un appel d’offres" placeholder="Numéro ou intitulé du dossier." value={filters.search} onChange={event => setFilters(old => ({ ...old, search: event.target.value, page: 0 }))} /></div>
      <select aria-label="Filtrer par statut" value={filters.status} onChange={event => setFilters(old => ({ ...old, status: event.target.value as TenderFilters['status'], page: 0 }))}>
        <option value="">Tous les statuts</option>
        {Object.entries(tenderStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <select aria-label="Trier" value={`${filters.sort}:${filters.dir}`} onChange={event => { const [sort, dir] = event.target.value.split(':') as [TenderFilters['sort'], TenderFilters['dir']]; setFilters(old => ({ ...old, sort, dir, page: 0 })) }}>
        <option value="deadline:asc">Échéance (prochaine d’abord)</option>
        <option value="deadline:desc">Échéance (plus lointaine)</option>
        <option value="created:desc">Création (récente d’abord)</option>
        <option value="created:asc">Création (ancienne d’abord)</option>
        <option value="number:asc">Numéro de dossier</option>
      </select>
      <span className="crm-count">{total} dossier(s)</span>
    </div>
    {error && <div className="crm-alert" role="alert">{error}</div>}
    {loading ? <div className="crm-empty">Chargement des dossiers.</div> : <div className="crm-table-wrap">
      <table className="crm-table">
        <thead><tr><th>Dossier</th><th>Organisme</th><th>Échéance de dépôt</th><th>Statut</th><th /></tr></thead>
        <tbody>{rows.map(row => <tr key={row.id}>
          <td><Link to={`/appels-offres/${row.id}`} className="crm-company">
            <span className="company-avatar dao-avatar"><Gavel size={16} /></span>
            <span><strong>{row.tender_number}</strong><small>{row.title}</small></span>
          </Link></td>
          <td>{companyLabel(row.companies)}</td>
          <td>{shortDate(row.submission_deadline)}</td>
          <td><span className={`crm-status ${tenderStatusClass[row.status]}`}>{tenderStatusLabels[row.status]}</span></td>
          <td><Link to={`/appels-offres/${row.id}`} aria-label={`Ouvrir ${row.tender_number}`}><ArrowRight size={16} /></Link></td>
        </tr>)}
        </tbody>
      </table>
      {rows.length === 0 && <div className="crm-empty"><Gavel size={22} /> Aucun appel d’offres ne correspond à ces filtres.</div>}
    </div>}
    {pages > 1 && <div className="dao-pagination">
      <Button variant="secondary" size="sm" disabled={filters.page === 0} onClick={() => setFilters(old => ({ ...old, page: old.page - 1 }))}>Précédent</Button>
      <span>Page {filters.page + 1} / {pages}</span>
      <Button variant="secondary" size="sm" disabled={filters.page >= pages - 1} onClick={() => setFilters(old => ({ ...old, page: old.page + 1 }))}>Suivant</Button>
    </div>}
  </div>
}
