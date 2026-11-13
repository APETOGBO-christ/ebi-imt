import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, FileText, Pencil, Plus } from 'lucide-react'
import { Button } from '../components/ui/button'
import { usePermits } from '../lib/permissions'
import {
  addActivity, addContact, getCompany, listActivities, listCompanyDocuments, updateContact, updateCompany,
  type CompanyDocumentRow,
} from './api'
import {
  activityTypeLabels, displayCompany, roleCodeLabels, type ActivityRow, type CompanyRow,
} from './types'

function date(value: string | null): string {
  if (!value) return '-'
  return new Date(value).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
}

const tabs = [
  { id: 'infos', label: 'Informations' },
  { id: 'contacts', label: 'Contacts' },
  { id: 'historique', label: 'Historique' },
  { id: 'documents', label: 'Documents' },
] as const
type TabId = (typeof tabs)[number]['id']

interface DocumentTitle { id: string; title: string; version: number | null; deleted: boolean; type: string }

function docTitle(row: NonNullable<CompanyDocumentRow['documents']>): DocumentTitle {
  const metadata = row.metadata ?? {}
  return {
    id: row.id,
    title: typeof metadata.title === 'string' && metadata.title ? metadata.title : row.storage_path.split('/').pop() ?? row.storage_path,
    version: row.document_version,
    deleted: row.deleted_at !== null,
    type: row.document_type,
  }
}

export function CompanyDetail() {
  const { id } = useParams()
  const { can, loading: permitsLoading } = usePermits()
  const canWrite = !permitsLoading && (can('clients', 'update') || can('fournisseurs', 'update') || can('partenaires', 'update'))
  const canInsert = !permitsLoading && (can('clients', 'insert') || can('fournisseurs', 'insert') || can('partenaires', 'insert'))
  const [company, setCompany] = useState<CompanyRow | null>(null)
  const [activities, setActivities] = useState<ActivityRow[]>([])
  const [documents, setDocuments] = useState<DocumentTitle[]>([])
  const [tab, setTab] = useState<TabId>('infos')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Nouveau contact / nouvel échange
  const [contactForm, setContactForm] = useState({ full_name: '', job_title: '', email: '', phone: '', is_primary: false })
  const [activityForm, setActivityForm] = useState({ contactId: '', activityType: 'call', subject: '', body: '' })
  const [showContactForm, setShowContactForm] = useState(false)
  const [showActivityForm, setShowActivityForm] = useState(false)

  const reload = useCallback(async () => {
    if (!id) return
    try {
      const row = await getCompany(id)
      setCompany(row)
      const [activityRows, documentRows] = await Promise.all([listActivities(id), listCompanyDocuments(id)])
      setActivities(activityRows)
      setDocuments(documentRows.map(row => row.documents ? docTitle(row.documents) : null).filter(Boolean) as DocumentTitle[])
      setError(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Chargement impossible.')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { setLoading(true); void reload() }, [reload])

  if (loading) return <div className="crm-page"><div className="crm-empty">Chargement de la fiche.</div></div>
  if (!company) return <div className="crm-page"><div className="crm-alert" role="alert">{error ?? 'Société introuvable.'}</div><Link className="crm-back" to="/societes"><ArrowLeft size={16} /> Sociétés</Link></div>

  async function toggleCompanyActive() {
    if (!company) return
    setBusy(true); setError(null)
    try {
      await updateCompany(company.id, { is_active: !company.is_active })
      await reload()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Modification impossible.')
    } finally { setBusy(false) }
  }

  async function submitContact(event: React.FormEvent) {
    event.preventDefault()
    if (!company || contactForm.full_name.trim() === '') return
    setBusy(true); setError(null)
    try {
      await addContact(company.id, {
        full_name: contactForm.full_name, job_title: contactForm.job_title,
        email: contactForm.email, phone: contactForm.phone,
        is_primary: contactForm.is_primary, notes: null,
      })
      setContactForm({ full_name: '', job_title: '', email: '', phone: '', is_primary: false })
      setShowContactForm(false)
      await reload()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Ajout impossible.')
    } finally { setBusy(false) }
  }

  async function toggleContact(contactId: string, is_active: boolean) {
    setBusy(true); setError(null)
    try {
      await updateContact(contactId, { is_active })
      await reload()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Modification impossible.')
    } finally { setBusy(false) }
  }

  async function submitActivity(event: React.FormEvent) {
    event.preventDefault()
    if (!company) return
    setBusy(true); setError(null)
    try {
      await addActivity(company.id, {
        contactId: activityForm.contactId === '' ? null : activityForm.contactId,
        activityType: activityForm.activityType,
        subject: activityForm.subject, body: activityForm.body,
      })
      setActivityForm({ contactId: '', activityType: 'call', subject: '', body: '' })
      setShowActivityForm(false)
      await reload()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Ajout impossible.')
    } finally { setBusy(false) }
  }

  const contacts = company.contacts ?? []
  const roles = (company.company_roles ?? []).map(role => roleCodeLabels[role.role_code] ?? role.role_code)

  return <div className="crm-page">
    <Link className="crm-back" to="/societes"><ArrowLeft size={16} /> Sociétés</Link>
    <div className="crm-detail-head">
      <div>
        <span className="company-avatar big">{displayCompany(company).slice(0, 1).toUpperCase()}</span>
        <div>
          <h1>{displayCompany(company)}</h1>
          <p>{[company.industry, company.city].filter(Boolean).join(' — ') || 'Informations à compléter'}</p>
          <div className="crm-badges">
            {roles.length > 0 ? roles.map(role => <span className="crm-badge" key={role}>{role}</span>) : <span className="crm-badge">Référentiel</span>}
            <span className={`crm-badge ${company.is_active ? 'ok' : 'warn'}`}>{company.is_active ? 'Active' : 'Inactive'}</span>
          </div>
        </div>
      </div>
      <div className="crm-detail-actions">
        {canWrite && <Button variant="secondary" asChild><Link to={`/societes/${company.id}/modifier`}><Pencil size={15} /> Modifier</Link></Button>}
        {canWrite && <Button variant="secondary" onClick={() => void toggleCompanyActive()} disabled={busy}>
          {company.is_active ? 'Désactiver' : 'Réactiver'}
        </Button>}
      </div>
    </div>
    {error && <div className="crm-alert" role="alert">{error}</div>}
    <div className="crm-tabs" role="tablist" aria-label="Sections de la fiche">
      {tabs.map(item => <button key={item.id} role="tab" aria-selected={tab === item.id}
        className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}>{item.label}</button>)}
    </div>

    {tab === 'infos' && <div className="crm-detail-grid">
      <div className="crm-section"><h2>Identité</h2>
        <dl className="crm-kv">
          <div><dt>Raison sociale</dt><dd>{company.legal_name}</dd></div>
          <div><dt>Nom commercial</dt><dd>{company.trade_name ?? '-'}</dd></div>
          <div><dt>Secteur</dt><dd>{company.industry ?? '-'}</dd></div>
          <div><dt>Registre</dt><dd>{company.registration_number ?? '-'}</dd></div>
          <div><dt>Contribuable</dt><dd>{company.tax_number ?? '-'}</dd></div>
        </dl>
      </div>
      <div className="crm-section"><h2>Coordonnées</h2>
        <dl className="crm-kv">
          <div><dt>Adresse</dt><dd>{company.address ?? '-'}</dd></div>
          <div><dt>Ville</dt><dd>{company.city ?? '-'}</dd></div>
          <div><dt>Téléphone</dt><dd>{company.phone ?? '-'}</dd></div>
          <div><dt>E-mail</dt><dd>{company.email ?? '-'}</dd></div>
          <div><dt>Site web</dt><dd>{company.website ? <a href={company.website} target="_blank" rel="noreferrer">{company.website}</a> : '-'}</dd></div>
        </dl>
      </div>
      {company.notes && <div className="crm-section crm-wide"><h2>Notes</h2><p>{company.notes}</p></div>}
    </div>}

    {tab === 'contacts' && <div className="crm-section">
      <div className="crm-section-head"><h2>Contacts ({contacts.length})</h2>
        {canInsert && <Button size="sm" onClick={() => setShowContactForm(value => !value)}><Plus size={15} /> Ajouter</Button>}
      </div>
      {showContactForm && <form className="crm-form crm-inline" onSubmit={event => void submitContact(event)}>
        <div className="crm-form-grid">
          <label className="crm-field">Nom complet *<input required value={contactForm.full_name} onChange={event => setContactForm(old => ({ ...old, full_name: event.target.value }))} /></label>
          <label className="crm-field">Fonction<input value={contactForm.job_title} onChange={event => setContactForm(old => ({ ...old, job_title: event.target.value }))} /></label>
          <label className="crm-field">Téléphone<input value={contactForm.phone} onChange={event => setContactForm(old => ({ ...old, phone: event.target.value }))} /></label>
          <label className="crm-field">E-mail<input type="email" value={contactForm.email} onChange={event => setContactForm(old => ({ ...old, email: event.target.value }))} /></label>
          <label className="crm-check"><input type="checkbox" checked={contactForm.is_primary} onChange={event => setContactForm(old => ({ ...old, is_primary: event.target.checked }))} />Contact principal</label>
        </div>
        <div className="crm-form-actions"><Button type="submit" disabled={busy}>Enregistrer</Button></div>
      </form>}
      <div className="crm-table-wrap"><table className="crm-table">
        <thead><tr><th>Nom</th><th>Fonction</th><th>Téléphone</th><th>E-mail</th><th>Statut</th><th /></tr></thead>
        <tbody>{contacts.map(contact => <tr key={contact.id}>
          <td><strong>{contact.full_name}</strong>{contact.is_primary && <small className="crm-badge ok">Principal</small>}</td>
          <td>{contact.job_title ?? '-'}</td>
          <td>{contact.phone ?? '-'}</td>
          <td>{contact.email ?? '-'}</td>
          <td><span className={`crm-status ${contact.is_active ? 'crm-status-nouveau' : 'crm-status-perdu'}`}>{contact.is_active ? 'Actif' : 'Inactif'}</span></td>
          <td>{canWrite && <button className="crm-link" onClick={() => void toggleContact(contact.id, !contact.is_active)} disabled={busy}>
            {contact.is_active ? 'Désactiver' : 'Activer'}
          </button>}</td>
        </tr>)}
        </tbody>
      </table>
      {contacts.length === 0 && <div className="crm-empty">Aucun contact enregistré.</div>}
      </div>
    </div>}

    {tab === 'historique' && <div className="crm-section">
      <div className="crm-section-head"><h2>Échanges ({activities.length})</h2>
        {canInsert && <Button size="sm" onClick={() => setShowActivityForm(value => !value)}><Plus size={15} /> Ajouter</Button>}
      </div>
      {showActivityForm && <form className="crm-form crm-inline" onSubmit={event => void submitActivity(event)}>
        <div className="crm-form-grid">
          <label className="crm-field">Type d'échange<select value={activityForm.activityType} onChange={event => setActivityForm(old => ({ ...old, activityType: event.target.value }))}>
            {Object.entries(activityTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
          <label className="crm-field">Contact associé<select value={activityForm.contactId} onChange={event => setActivityForm(old => ({ ...old, contactId: event.target.value }))}>
            <option value="">Aucun</option>
            {contacts.filter(contact => contact.is_active).map(contact => <option key={contact.id} value={contact.id}>{contact.full_name}</option>)}
          </select></label>
          <label className="crm-field crm-field-wide">Objet<input value={activityForm.subject} onChange={event => setActivityForm(old => ({ ...old, subject: event.target.value }))} /></label>
          <label className="crm-field crm-field-wide">Compte rendu<textarea rows={3} value={activityForm.body} onChange={event => setActivityForm(old => ({ ...old, body: event.target.value }))} /></label>
        </div>
        <div className="crm-form-actions"><Button type="submit" disabled={busy}>Enregistrer l'échange</Button></div>
      </form>}
      <div className="crm-timeline">{activities.map(activity => <article key={activity.id} className="crm-timeline-item">
        <header><span className="crm-badge">{activityTypeLabels[activity.activity_type] ?? activity.activity_type}</span>
          <time>{date(activity.occurred_at)}</time></header>
        <strong>{activity.subject ?? 'Sans objet'}</strong>
        {activity.body && <p>{activity.body}</p>}
        {activity.contact_id && <small>Contact : {contacts.find(contact => contact.id === activity.contact_id)?.full_name ?? 'contact associé'}</small>}
      </article>)}
      {activities.length === 0 && <div className="crm-empty">Aucun échange enregistré.</div>}
      </div>
    </div>}

    {tab === 'documents' && <div className="crm-section">
      <div className="crm-section-head"><h2>Documents rattachés ({documents.filter(document => !document.deleted).length})</h2>
        <Button size="sm" asChild><Link to="/bibliotheque">Ouvrir la bibliothèque <ArrowRight size={14} /></Link></Button>
      </div>
      <div className="crm-table-wrap"><table className="crm-table">
        <thead><tr><th>Document</th><th>Type</th><th>Version</th><th>Statut</th><th /></tr></thead>
        <tbody>{documents.map(document => <tr key={document.id} className={document.deleted ? 'crm-row-muted' : ''}>
          <td><span className="crm-company"><span className="company-avatar"><FileText size={15} /></span><strong>{document.title}</strong></span></td>
          <td>{document.type}</td>
          <td>{document.version ?? '-'}</td>
          <td>{document.deleted ? 'Corbeille' : 'Disponible'}</td>
          <td><Link to={`/bibliotheque?doc=${document.id}`} aria-label="Ouvrir dans la bibliothèque"><ArrowRight size={16} /></Link></td>
        </tr>)}
        </tbody>
      </table>
      {documents.length === 0 && <div className="crm-empty">Aucun document rattaché à cette société.</div>}
      </div>
    </div>}
  </div>
}
