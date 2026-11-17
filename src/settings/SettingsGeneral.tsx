import { useCallback, useEffect, useState } from 'react'
import { fetchAppSettings, listCategories, createCategory, deleteCategory, updateAppSettings, emptySettings, type AppSettings, type LibraryCategory } from './api'
import { modules } from '../lib/modules'

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function SettingsGeneral({ editable }: { editable: boolean }) {
  const [form, setForm] = useState<AppSettings>(emptySettings)
  const [categories, setCategories] = useState<LibraryCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [category, setCategory] = useState({ code: '', label: '' })

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [settings, cats] = await Promise.all([fetchAppSettings(), listCategories().catch(() => [])])
      setForm(settings); setCategories(cats); setError(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Chargement impossible.')
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { void refresh() }, [refresh])

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true); setError(null); setNotice(null)
    try {
      await updateAppSettings({
        legal_name: form.legal_name, trade_name: form.trade_name, address: form.address, city: form.city,
        phone: form.phone, email: form.email, website: form.website, logo_url: form.logo_url,
        display_prefs: form.display_prefs, retention: form.retention, finance: form.finance,
        enabled_modules: form.enabled_modules ?? [],
      })
      setNotice('Paramètres enregistrés. Modification journalisée dans le journal d’activité.')
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Enregistrement impossible.')
    } finally { setBusy(false) }
  }

  async function addCategory(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true); setError(null); setNotice(null)
    try {
      await createCategory(category.code, category.label)
      setCategory({ code: '', label: '' })
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Catégorie impossible.')
    } finally { setBusy(false) }
  }

  async function removeCategory(id: string) {
    setBusy(true); setError(null)
    try {
      await deleteCategory(id)
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Suppression impossible.')
    } finally { setBusy(false) }
  }

  const setField = (field: keyof AppSettings, value: string) => setForm(old => ({ ...old, [field]: value }))
  const scene3d = form.display_prefs?.scene3d !== false

  return <div className="set-general">
    {error && <div className="crm-alert" role="alert">{error}</div>}
    {notice && <div className="form-success" role="status">{notice}</div>}
    {loading ? <div className="crm-empty">Chargement des paramètres.</div> : <form onSubmit={save}>
      <div className="set-grid">
        <label className="crm-field">Raison sociale<input required value={form.legal_name} onChange={event => setField('legal_name', event.target.value)} disabled={!editable} /></label>
        <label className="crm-field">Nom commercial<input value={form.trade_name ?? ''} onChange={event => setField('trade_name', event.target.value)} disabled={!editable} /></label>
        <label className="crm-field">Adresse<input value={form.address ?? ''} onChange={event => setField('address', event.target.value)} disabled={!editable} /></label>
        <label className="crm-field">Ville<input value={form.city ?? ''} onChange={event => setField('city', event.target.value)} disabled={!editable} /></label>
        <label className="crm-field">Téléphone<input value={form.phone ?? ''} onChange={event => setField('phone', event.target.value)} disabled={!editable} /></label>
        <label className="crm-field">E-mail officiel<input type="email" value={form.email ?? ''} onChange={event => setField('email', event.target.value)} disabled={!editable} /></label>
        <label className="crm-field">Site web<input value={form.website ?? ''} onChange={event => setField('website', event.target.value)} disabled={!editable} /></label>
        <label className="crm-field">Logo (URL)<input value={form.logo_url ?? ''} onChange={event => setField('logo_url', event.target.value)} disabled={!editable} /></label>
      </div>
      <p className="crm-hint">Devise fixée par l’architecture : <strong>FCFA (XOF)</strong>.</p>
      <div className="set-grid">
        <label className="crm-check"><input type="checkbox" checked={scene3d} disabled={!editable} onChange={event => setForm(old => ({ ...old, display_prefs: { ...old.display_prefs, scene3d: event.target.checked } }))} /> Préférence d’affichage : scène 3D du tableau de bord</label>
        <label className="crm-field">Conservation des documents (années)<input type="number" min={1} max={50} value={asNumber(form.retention?.library_years, 5)} disabled={!editable} onChange={event => setForm(old => ({ ...old, retention: { ...old.retention, library_years: Number(event.target.value) } }))} /></label>
        <label className="crm-field">Conservation du journal (années)<input type="number" min={1} max={50} value={asNumber(form.retention?.audit_years, 10)} disabled={!editable} onChange={event => setForm(old => ({ ...old, retention: { ...old.retention, audit_years: Number(event.target.value) } }))} /></label>
        <label className="crm-field">TVA par défaut (%)<input type="number" min={0} max={30} value={asNumber(form.finance?.default_vat_pct, 18)} disabled={!editable} onChange={event => setForm(old => ({ ...old, finance: { ...old.finance, default_vat_pct: Number(event.target.value) } }))} /></label>
        <label className="crm-field">Pénalité de retard (%)<input type="number" min={0} max={10} value={asNumber(form.finance?.late_fee_pct, 1)} disabled={!editable} onChange={event => setForm(old => ({ ...old, finance: { ...old.finance, late_fee_pct: Number(event.target.value) } }))} /></label>
      </div>
      <fieldset className="set-modules" disabled={!editable}>
        <legend>Gestion des modules (modules visibles dans la navigation ; aucun coché = tous actifs)</legend>
        <div className="crm-check-row" role="group" aria-label="Modules visibles">
          {modules.filter(module => module.id !== 'settings').map(module => {
            const enabled = (form.enabled_modules ?? []).length === 0 || (form.enabled_modules ?? []).includes(module.id)
            return <label className="crm-check" key={module.id}>
              <input type="checkbox" checked={enabled} onChange={event => setForm(old => {
                const current = (old.enabled_modules ?? []).length === 0 ? modules.filter(item => item.id !== 'settings').map(item => item.id) : [...(old.enabled_modules ?? [])]
                const next = event.target.checked ? [...new Set([...current, module.id])] : current.filter(id => id !== module.id)
                return { ...old, enabled_modules: next.length >= current.length ? [] : next }
              })} /> {module.label}
            </label>
          })}
        </div>
      </fieldset>
      {editable && <button type="submit" className="button button-secondary" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer les paramètres'}</button>}
    </form>}
    <div className="crm-section-head"><h2>Catégories documentaires ({categories.length})</h2></div>
    {editable && <form className="crm-inline-form" onSubmit={addCategory}>
      <input required aria-label="Code de catégorie" placeholder="code (ex. contrat)" value={category.code} onChange={event => setCategory(old => ({ ...old, code: event.target.value }))} />
      <input required aria-label="Libellé de catégorie" placeholder="Libellé" value={category.label} onChange={event => setCategory(old => ({ ...old, label: event.target.value }))} />
      <button type="submit" className="button button-secondary" disabled={busy}>Ajouter</button>
    </form>}
    <div className="crm-table-wrap">
      <table className="crm-table">
        <thead><tr><th>Code</th><th>Libellé</th>{editable && <th />}</tr></thead>
        <tbody>{categories.map(row => <tr key={row.id}>
          <td><strong>{row.code}</strong></td><td>{row.label}</td>
          {editable && <td><button type="button" disabled={busy} onClick={() => void removeCategory(row.id)}>Supprimer</button></td>}
        </tr>)}
        </tbody>
      </table>
      {categories.length === 0 && <div className="crm-empty">Aucune catégorie documentaire.</div>}
    </div>
  </div>
}
