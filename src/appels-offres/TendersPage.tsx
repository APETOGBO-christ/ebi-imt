import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, BarChart3, CalendarDays, Columns3, Gavel, List, Plus, Search } from 'lucide-react'
import { Button } from '../components/ui/button'
import { usePermits } from '../lib/permissions'
import { getTenderAnalytics, listCompanyOptions, listResponsibleOptions, listTenders, type TenderAnalytics, type TenderFilters } from './api'
import { companyLabel, firstEmbed, shortDate, tenderStatusClass, tenderStatusLabels, xof, type TenderRow, type TenderStatus } from './types'

const pageSize = 20
const kanbanOrder: TenderStatus[] = ['identifie', 'a_analyser', 'en_analyse', 'decision_soumission', 'en_preparation', 'en_validation', 'attente_documents', 'pret_deposer', 'depose', 'en_evaluation', 'gagne', 'perdu', 'annule', 'abandonne']

type ViewMode = 'list' | 'kanban' | 'calendar'

function AnalysisView({ analytics, year, onYearChange }: { analytics: TenderAnalytics; year: number | null; onYearChange: (year: number | null) => void }) {
  const format = (value: number) => `${new Intl.NumberFormat('fr-TG').format(value)} FCFA`
  return <div>
    <div className="crm-toolbar" style={{ marginBottom: 15 }}>
      <select aria-label="Période d’analyse" value={year === null ? '' : String(year)} onChange={event => onYearChange(event.target.value === '' ? null : Number(event.target.value))}>
        <option value="">Toutes les années</option>
        {analytics.years.map(entry => <option key={entry} value={entry}>{entry}</option>)}
      </select>
      <span className="crm-count">Historique complet conservé — comparez les performances année par année.</span>
    </div>
    <div className="kpi-strip" aria-label="Indicateurs des appels d’offres">
      <div className="kpi-item"><span className="kpi-icon blue"><Gavel size={19} /></span><div><span className="kpi-label">Dossiers traités</span><strong className="kpi-value">{analytics.total}</strong></div><span className="kpi-divider" /></div>
      <div className="kpi-item"><span className="kpi-icon blue"><ArrowRight size={19} /></span><div><span className="kpi-label">En cours</span><strong className="kpi-value">{analytics.inCourse}</strong></div><span className="kpi-divider" /></div>
      <div className="kpi-item"><span className="kpi-icon blue"><ArrowRight size={19} /></span><div><span className="kpi-label">Déposés</span><strong className="kpi-value">{analytics.deposited}</strong></div><span className="kpi-divider" /></div>
      <div className="kpi-item"><span className="kpi-icon green"><BarChart3 size={19} /></span><div><span className="kpi-label">Taux de réussite</span><strong className="kpi-value">{analytics.successRate === null ? '—' : `${analytics.successRate} %`}</strong></div></div>
    </div>
    <div className="kpi-strip" style={{ marginBottom: 15 }} aria-label="Montants gagnés et perdus">
      <div className="kpi-item"><span className="kpi-icon green"><Gavel size={19} /></span><div><span className="kpi-label">Montants gagnés ({analytics.won})</span><strong className="kpi-value">{format(analytics.wonAmount)}</strong></div><span className="kpi-divider" /></div>
      <div className="kpi-item"><span className="kpi-icon blue"><Gavel size={19} /></span><div><span className="kpi-label">Montants perdus ({analytics.lost})</span><strong className="kpi-value">{format(analytics.lostAmount)}</strong></div></div>
    </div>
    <div className="dash-sections" style={{ marginTop: 0 }}>
      <div className="dash-card"><div className="dash-card-head"><h2>Organismes les plus fréquents</h2></div>
        {analytics.topOrganisms.length === 0 ? <div className="notif-empty">Aucun organisme.</div> : <ul className="dash-list">{analytics.topOrganisms.map(entry => <li key={entry.label}><div><strong>{entry.label}</strong></div><span className="dash-when">{entry.count} dossier(s)</span></li>)}</ul>}
      </div>
      <div className="dash-card"><div className="dash-card-head"><h2>Fournisseurs sollicités</h2></div>
        {analytics.topSuppliers.length === 0 ? <div className="notif-empty">Aucun devis fournisseur.</div> : <ul className="dash-list">{analytics.topSuppliers.map(entry => <li key={entry.label}><div><strong>{entry.label}</strong><small>{format(entry.amount)}</small></div><span className="dash-when">{entry.count} devis</span></li>)}</ul>}
      </div>
    </div>
  </div>
}

interface CalendarGroup { date: string; label: string; overdue: boolean; rows: TenderRow[] }

function CalendarView({ rows }: { rows: TenderRow[] }) {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const groups = new Map<string, CalendarGroup>()
  for (const row of rows) {
    const deadline = new Date(row.submission_deadline)
    const day = new Date(deadline); day.setHours(0, 0, 0, 0)
    if (day.getTime() < today.getTime() - 30 * 86400000) continue
    if (day.getTime() > today.getTime() + 60 * 86400000) continue
    const key = day.toISOString().slice(0, 10)
    const group = groups.get(key) ?? {
      date: key,
      label: new Intl.DateTimeFormat('fr-TG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(day),
      overdue: day.getTime() < today.getTime(),
      rows: [],
    }
    group.rows.push(row)
    groups.set(key, group)
  }
  const ordered = [...groups.values()].sort((first, second) => first.date.localeCompare(second.date))
  if (ordered.length === 0) return <div className="crm-empty">Aucune échéance de dépôt dans les 30 derniers et 60 prochains jours.</div>
  return <div className="dao-calendar">
    {ordered.map(group => <div key={group.date} className={`dao-calendar-day${group.overdue ? ' dao-calendar-overdue' : ''}`}>
      <div className="dao-calendar-head"><strong>{group.label}</strong>{group.overdue && <span className="crm-status crm-status-lost">Échéance passée</span>}</div>
      <ul className="dash-list">{group.rows.map(row => <li key={row.id}>
        <Link to={`/appels-offres/${row.id}`}><div><strong>{row.tender_number}</strong><small>{row.title}</small></div></Link>
        <span className="dash-when">{companyLabel(firstEmbed(row.companies))} · {tenderStatusLabels[row.status]}</span>
      </li>)}</ul>
    </div>)}
  </div>
}

function KanbanView({ rows }: { rows: TenderRow[] }) {
  return <div className="dao-kanban">
    {kanbanOrder.map(status => {
      const column = rows.filter(row => row.status === status)
      if (column.length === 0) return null
      return <div key={status} className="dao-kanban-col">
        <div className="dao-kanban-head">
          <span className={`crm-status ${tenderStatusClass[status]}`}>{tenderStatusLabels[status]}</span>
          <small>{column.length}</small>
        </div>
        {column.map(row => <Link key={row.id} to={`/appels-offres/${row.id}`} className="dao-kanban-card">
          <strong>{row.tender_number}</strong>
          <small>{row.title}</small>
          <span className="dao-kanban-meta">{companyLabel(firstEmbed(row.companies))} · {shortDate(row.submission_deadline)}</span>
        </Link>)}
      </div>
    })}
    {rows.length === 0 && <div className="crm-empty">Aucun dossier pour ces filtres.</div>}
  </div>
}

export function TendersPage() {
  const { can, loading: permitsLoading } = usePermits()
  const [filters, setFilters] = useState<TenderFilters>({ search: '', status: '', organism: '', responsible: '', period: '', sort: 'deadline', dir: 'asc', page: 0, pageSize })
  const [rows, setRows] = useState<TenderRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<ViewMode>('list')
  const [showAnalysis, setShowAnalysis] = useState(false)
  const [analysisYear, setAnalysisYear] = useState<number | null>(null)
  const [analytics, setAnalytics] = useState<TenderAnalytics | null>(null)
  const [analyticsError, setAnalyticsError] = useState<string | null>(null)
  const [organisms, setOrganisms] = useState<{ id: string; label: string }[]>([])
  const [people, setPeople] = useState<{ id: string; label: string }[]>([])

  useEffect(() => {
    listCompanyOptions().then(rows2 => setOrganisms(rows2.map(option => ({ id: option.id, label: option.trade_name?.trim() || option.legal_name })))).catch(() => undefined)
    listResponsibleOptions().then(rows2 => setPeople(rows2.map(option => ({ id: option.id, label: option.full_name })))).catch(() => undefined)
  }, [])

  useEffect(() => {
    let active = true
    const handle = setTimeout(() => {
      setLoading(true)
      const query = view === 'list' ? filters : { ...filters, page: 0, pageSize: 200 }
      listTenders(query)
        .then(result => { if (active) { setRows(result.rows); setTotal(result.total); setError(null) } })
        .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Chargement impossible.') })
        .finally(() => { if (active) setLoading(false) })
    }, 200)
    return () => { active = false; clearTimeout(handle) }
  }, [filters, view])

  useEffect(() => {
    if (!showAnalysis) return
    let active = true
    setAnalyticsError(null)
    getTenderAnalytics(analysisYear)
      .then(result => { if (active) setAnalytics(result) })
      .catch(reason => { if (active) setAnalyticsError(reason instanceof Error ? reason.message : 'Analyse indisponible.') })
    return () => { active = false }
  }, [showAnalysis, analysisYear])

  const pages = Math.max(1, Math.ceil(total / pageSize))
  const canCreate = !permitsLoading && can('appels_offres', 'insert')

  return <div className="crm-page">
    <div className="crm-page-head"><div><span className="section-kicker">APPELS D’OFFRES</span><h1>Appels d’offres</h1><p>Suivi des dossiers : identification, analyse, préparation, dépôt, résultat, comparaison des fournisseurs — historique conservé pour l’analyse annuelle.</p></div>
      <div className="crm-head-actions">
        <Button variant="secondary" onClick={() => setShowAnalysis(value => !value)}>{showAnalysis ? <><List size={16} /> Liste</> : <><BarChart3 size={16} /> Analyse</>}</Button>
        {canCreate && <Button asChild><Link to="/appels-offres/nouveau"><Plus size={17} /> Nouvel appel d’offres</Link></Button>}
      </div>
    </div>
    {showAnalysis ? (analyticsError ? <div className="crm-alert" role="alert">{analyticsError}</div> : analytics ? <AnalysisView analytics={analytics} year={analysisYear} onYearChange={setAnalysisYear} /> : <div className="crm-empty">Calcul des indicateurs…</div>) : <>
      <div className="crm-toolbar">
        <div className="crm-search"><Search size={17} /><input aria-label="Rechercher un appel d’offres" placeholder="Numéro ou intitulé du dossier." value={filters.search} onChange={event => setFilters(old => ({ ...old, search: event.target.value, page: 0 }))} /></div>
        <select aria-label="Filtrer par statut" value={filters.status} onChange={event => setFilters(old => ({ ...old, status: event.target.value as TenderFilters['status'], page: 0 }))}>
          <option value="">Tous les statuts</option>
          {Object.entries(tenderStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select aria-label="Filtrer par organisme" value={filters.organism} onChange={event => setFilters(old => ({ ...old, organism: event.target.value, page: 0 }))}>
          <option value="">Tous les organismes</option>
          {organisms.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
        <select aria-label="Filtrer par responsable" value={filters.responsible} onChange={event => setFilters(old => ({ ...old, responsible: event.target.value, page: 0 }))}>
          <option value="">Tous les responsables</option>
          {people.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
        <select aria-label="Filtrer par période d’échéance" value={filters.period} onChange={event => setFilters(old => ({ ...old, period: event.target.value as TenderFilters['period'], page: 0 }))}>
          <option value="">Toutes les échéances</option>
          <option value="7d">Dépôt sous 7 jours</option>
          <option value="30d">Dépôt sous 30 jours</option>
          <option value="90d">Dépôt sous 90 jours</option>
        </select>
        <select aria-label="Trier" value={`${filters.sort}:${filters.dir}`} onChange={event => { const [sort, dir] = event.target.value.split(':') as [TenderFilters['sort'], TenderFilters['dir']]; setFilters(old => ({ ...old, sort, dir, page: 0 })) }}>
          <option value="deadline:asc">Échéance (prochaine d’abord)</option>
          <option value="deadline:desc">Échéance (plus lointaine)</option>
          <option value="created:desc">Création (récente d’abord)</option>
          <option value="created:asc">Création (ancienne d’abord)</option>
          <option value="number:asc">Numéro de dossier</option>
        </select>
        <div className="dao-view-switch" role="tablist" aria-label="Mode d’affichage">
          <Button variant={view === 'list' ? 'default' : 'ghost'} size="sm" onClick={() => setView('list')}><List size={15} /> Liste</Button>
          <Button variant={view === 'kanban' ? 'default' : 'ghost'} size="sm" onClick={() => setView('kanban')}><Columns3 size={15} /> Kanban</Button>
          <Button variant={view === 'calendar' ? 'default' : 'ghost'} size="sm" onClick={() => setView('calendar')}><CalendarDays size={15} /> Calendrier</Button>
        </div>
        <span className="crm-count">{total} dossier(s){view !== 'list' ? ' (200 max affichés)' : ''}</span>
      </div>
      {error && <div className="crm-alert" role="alert">{error}</div>}
      {loading ? <div className="crm-empty">Chargement des dossiers.</div>
        : view === 'kanban' ? <KanbanView rows={rows} />
        : view === 'calendar' ? <CalendarView rows={rows} />
        : <div className="crm-table-wrap">
          <table className="crm-table">
            <thead><tr><th>Dossier</th><th>Organisme</th><th>Responsable</th><th>Notre offre</th><th>Échéance de dépôt</th><th>Statut</th><th /></tr></thead>
            <tbody>{rows.map(row => <tr key={row.id}>
              <td><Link to={`/appels-offres/${row.id}`} className="crm-company">
                <span className="company-avatar dao-avatar"><Gavel size={16} /></span>
                <span><strong>{row.tender_number}</strong><small>{row.title}</small></span>
              </Link></td>
              <td>{companyLabel(firstEmbed(row.companies))}</td>
              <td>{firstEmbed(row.profiles)?.full_name ?? '—'}</td>
              <td>{xof(row.our_amount_xof)}</td>
              <td>{shortDate(row.submission_deadline)}</td>
              <td><span className={`crm-status ${tenderStatusClass[row.status]}`}>{tenderStatusLabels[row.status]}</span></td>
              <td><Link to={`/appels-offres/${row.id}`} aria-label={`Ouvrir ${row.tender_number}`}><ArrowRight size={16} /></Link></td>
            </tr>)}
            </tbody>
          </table>
          {rows.length === 0 && <div className="crm-empty"><Gavel size={22} /> Aucun appel d’offres ne correspond à ces filtres.</div>}
        </div>}
      {view === 'list' && pages > 1 && <div className="dao-pagination">
        <Button variant="secondary" size="sm" disabled={filters.page === 0} onClick={() => setFilters(old => ({ ...old, page: old.page - 1 }))}>Précédent</Button>
        <span>Page {filters.page + 1} / {pages}</span>
        <Button variant="secondary" size="sm" disabled={filters.page >= pages - 1} onClick={() => setFilters(old => ({ ...old, page: old.page + 1 }))}>Suivant</Button>
      </div>}
    </>}
  </div>
}
