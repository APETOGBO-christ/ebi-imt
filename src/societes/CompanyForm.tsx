import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Button } from '../components/ui/button'
import { createCompany, getCompany, updateCompany } from './api'
import { emptyCompany, roleCodeLabels, type CompanyInput, type CompanyRow } from './types'

export function CompanyForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const editing = Boolean(id)
  const [form, setForm] = useState<CompanyInput>(emptyCompany)
  const [isActive, setIsActive] = useState(true)
  const [company, setCompany] = useState<CompanyRow | null>(null)
  const [loading, setLoading] = useState(editing)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    let active = true
    getCompany(id)
      .then(row => {
        if (!active) return
        setCompany(row)
        setForm({
          legal_name: row.legal_name, trade_name: row.trade_name ?? '', role_codes: (row.company_roles ?? []).map(role => role.role_code),
          industry: row.industry ?? '', address: row.address ?? '', city: row.city ?? '',
          phone: row.phone ?? '', email: row.email ?? '', website: row.website ?? '',
          registration_number: row.registration_number ?? '', tax_number: row.tax_number ?? '', notes: row.notes ?? '',
        })
        setIsActive(row.is_active)
      })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Chargement impossible.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [id])

  function field(key: keyof CompanyInput, label: string, required = false, type = 'text') {
    return <label className="crm-field">{label}
      <input type={type} required={required} value={form[key] as string}
        onChange={event => setForm(old => ({ ...old, [key]: event.target.value }))} />
    </label>
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true); setError(null)
    try {
      if (editing && id) {
        await updateCompany(id, {
          legal_name: form.legal_name.trim(), trade_name: form.trade_name.trim() || null,
          industry: form.industry.trim() || null, address: form.address.trim() || null,
          city: form.city.trim() || null, phone: form.phone.trim() || null,
          email: form.email.trim() || null, website: form.website.trim() || null,
          registration_number: form.registration_number.trim() || null,
          tax_number: form.tax_number.trim() || null, notes: form.notes.trim() || null,
          is_active: isActive,
        })
        navigate(`/societes/${id}`)
      } else {
        const created = await createCompany(form)
        navigate(`/societes/${created}`)
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Enregistrement impossible.')
      setBusy(false)
    }
  }

  return <div className="crm-page">
    <Link className="crm-back" to={editing && id ? `/societes/${id}` : '/societes'}><ArrowLeft size={16} /> Sociétés</Link>
    <div className="crm-page-head"><div><span className="section-kicker">RÉFÉRENTIEL / FICHE</span>
      <h1>{editing ? 'Modifier la société' : 'Nouvelle société'}</h1>
      <p>{editing ? 'Complétez la fiche. Les rôles (client, fournisseur…) se gèrent depuis le détail.' : 'Commencez par la raison sociale. Les rôles cumulables seront posés à la création.'}</p></div></div>
    {loading ? <div className="crm-empty">Chargement.</div> : <form className="crm-form" onSubmit={event => void submit(event)}>
      <div className="crm-form-section"><h2>Identité</h2><div className="crm-form-grid">
        {field('legal_name', 'Raison sociale *', true)}
        {field('trade_name', 'Nom commercial')}
        {field('industry', 'Secteur d\'activité')}
        {field('registration_number', 'N° registre (RCCM)')}
        {field('tax_number', 'N° contribuable')}
      </div></div>
      {!editing && <div className="crm-form-section"><h2>Rôles cumulables</h2>
        <div className="crm-check-row" role="group" aria-label="Rôles de la société">
          {Object.entries(roleCodeLabels).map(([value, label]) => <label key={value} className="crm-check">
            <input type="checkbox" checked={form.role_codes.includes(value)}
              onChange={event => setForm(old => ({
                ...old,
                role_codes: event.target.checked ? [...old.role_codes, value] : old.role_codes.filter(code => code !== value),
              }))} />
            {label}
          </label>)}
        </div>
      </div>}
      <div className="crm-form-section"><h2>Coordonnées</h2><div className="crm-form-grid">
        {field('address', 'Adresse')}
        {field('city', 'Ville')}
        {field('phone', 'Téléphone')}
        {field('email', 'E-mail', false, 'email')}
        {field('website', 'Site web', false, 'url')}
      </div></div>
      <div className="crm-form-section"><h2>Notes</h2>
        <label className="crm-field crm-field-wide">Notes internes
          <textarea rows={4} value={form.notes} onChange={event => setForm(old => ({ ...old, notes: event.target.value }))} />
        </label>
        {editing && <label className="crm-check crm-field-wide">
          <input type="checkbox" checked={isActive} onChange={event => setIsActive(event.target.checked)} />
          Société active
        </label>}
      </div>
      {error && <div className="crm-alert" role="alert">{error}</div>}
      <div className="crm-form-actions">
        <Button variant="secondary" asChild><Link to={editing && id ? `/societes/${id}` : '/societes'}>Annuler</Link></Button>
        <Button type="submit" disabled={busy}>{busy ? 'Enregistrement…' : editing ? 'Enregistrer les modifications' : 'Créer la société'}</Button>
      </div>
      {editing && company && <p className="crm-hint">Les rôles actuels : {((company.company_roles ?? []).map(role => roleCodeLabels[role.role_code] ?? role.role_code).join(', ')) || 'aucun'} (gestion réservée à l'administration).</p>}
    </form>}
  </div>
}
