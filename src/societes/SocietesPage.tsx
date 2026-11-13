import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Building2, Plus, Search } from 'lucide-react'
import { Button } from '../components/ui/button'
import { usePermits } from '../lib/permissions'
import { listCompanies, type CompanyFilters } from './api'
import { displayCompany, roleCodeLabels, type CompanyRow } from './types'

function formatRole(roles: CompanyRow['company_roles']): string {
  const codes = (roles ?? []).map(role => roleCodeLabels[role.role_code] ?? role.role_code)
  return codes.length > 0 ? codes.join(' · ') : 'Référentiel'
}

export function SocietesPage() {
  const { can, loading: permitsLoading } = usePermits()
  const canCreate = !permitsLoading && (can('clients', 'insert') || can('fournisseurs', 'insert') || can('partenaires', 'insert'))
  const [filters, setFilters] = useState<CompanyFilters>({ search: '', roleCode: '', status: '' })
  const [rows, setRows] = useState<CompanyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    const handle = setTimeout(() => {
      setLoading(true)
      listCompanies(filters)
        .then(result => { if (active) { setRows(result); setError(null) } })
        .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Chargement impossible.') })
        .finally(() => { if (active) setLoading(false) })
    }, 200)
    return () => { active = false; clearTimeout(handle) }
  }, [filters])

  const counts = useMemo(() => ({
    total: rows.length,
    active: rows.filter(row => row.is_active).length,
  }), [rows])

  return <div className="crm-page">
    <div className="crm-page-head"><div><span className="section-kicker">RÉFÉRENTIEL</span><h1>Sociétés</h1><p>Le point d'entrée unique : clients, fournisseurs, partenaires et organismes d'appels d'offres, dans une même fiche.</p></div>
      {canCreate && <div className="crm-head-actions"><Button asChild><Link to="/societes/nouveau"><Plus size={17} /> Nouvelle société</Link></Button></div>}
    </div>
    <div className="crm-toolbar">
      <div className="crm-search"><Search size={17} /><input aria-label="Rechercher une société" placeholder="Raison sociale ou nom commercial." value={filters.search ?? ''} onChange={event => setFilters(old => ({ ...old, search: event.target.value }))} /></div>
      <select aria-label="Filtrer par rôle" value={filters.roleCode ?? ''} onChange={event => setFilters(old => ({ ...old, roleCode: event.target.value }))}>
        <option value="">Tous les rôles</option>
        {Object.entries(roleCodeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <select aria-label="Filtrer par statut" value={filters.status ?? ''} onChange={event => setFilters(old => ({ ...old, status: event.target.value as CompanyFilters['status'] }))}>
        <option value="">Actives et inactives</option>
        <option value="active">Actives uniquement</option>
        <option value="inactive">Inactives uniquement</option>
      </select>
      <span className="crm-count">{counts.total} société(s) · {counts.active} active(s)</span>
    </div>
    {error && <div className="crm-alert" role="alert">{error}</div>}
    {loading ? <div className="crm-empty">Chargement des sociétés.</div> : <div className="crm-table-wrap">
      <table className="crm-table">
        <thead><tr><th>Société</th><th>Rôles</th><th>Ville</th><th>Téléphone</th><th>Statut</th><th /></tr></thead>
        <tbody>{rows.map(row => <tr key={row.id}>
          <td><Link to={`/societes/${row.id}`} className="crm-company">
            <span className="company-avatar">{displayCompany(row).slice(0, 1).toUpperCase()}</span>
            <span><strong>{displayCompany(row)}</strong><small>{[row.industry, row.city].filter(Boolean).join(' — ') || 'Informations à compléter'}</small></span>
          </Link></td>
          <td>{formatRole(row.company_roles)}</td>
          <td>{row.city ?? '-'}</td>
          <td>{row.phone ?? '-'}</td>
          <td><span className={`crm-status ${row.is_active ? 'crm-status-nouveau' : 'crm-status-perdu'}`}>{row.is_active ? 'Active' : 'Inactive'}</span></td>
          <td><Link to={`/societes/${row.id}`} aria-label={`Ouvrir ${displayCompany(row)}`}><ArrowRight size={16} /></Link></td>
        </tr>)}
        </tbody>
      </table>
      {rows.length === 0 && <div className="crm-empty"><Building2 size={22} /> Aucune société ne correspond à ces filtres.</div>}
    </div>}
  </div>
}
