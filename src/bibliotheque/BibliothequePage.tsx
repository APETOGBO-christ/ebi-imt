import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Eye, FileText, FolderOpen, History, RefreshCw, Search, Trash2, Undo2, Upload } from 'lucide-react'
import { Button } from '../components/ui/button'
import { useAuth } from '../lib/auth'
import { usePermits } from '../lib/permissions'
import { supabase } from '../lib/supabase'
import { listCompanies } from '../societes/api'
import {
  deleteDocument, downloadUrl, listDocuments, restoreDocument, runReconcile, uploadDocument,
  type DocumentFilters,
} from './api'
import { displayTitle, formatBytes, imageMimeTypes, type CompanyOption, type DocumentRow } from './types'

function formatDate(value: string | null): string {
  if (!value) return '-'
  return new Date(value).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
}

interface PreviewState { row: DocumentRow; url: string; hash: string | null; mime: string | null }

export function BibliothequePage() {
  const { profile } = useAuth()
  const { can, loading: permitsLoading } = usePermits()
  const canUpload = !permitsLoading && can('bibliotheque', 'insert')
  const canDelete = !permitsLoading && can('bibliotheque', 'delete')
  const isAdmin = profile?.role === 'admin'
  const [filters, setFilters] = useState<DocumentFilters>({ search: '', companyId: '', deleted: false })
  const [familyView, setFamilyView] = useState<{ familyKey: string; title: string } | null>(null)
  const [rows, setRows] = useState<DocumentRow[]>([])
  const [companies, setCompanies] = useState<CompanyOption[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadTitle, setUploadTitle] = useState('')
  const [uploadCompanyId, setUploadCompanyId] = useState('')
  const [uploadSupersedes, setUploadSupersedes] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<DocumentRow | null>(null)
  const [deleteReason, setDeleteReason] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await listDocuments({ ...filters, familyKey: familyView?.familyKey })
      setRows(result)
      setError(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Chargement impossible.')
    } finally {
      setLoading(false)
    }
  }, [filters, familyView])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    listCompanies({})
      .then(result => setCompanies(result.map(row => ({ id: row.id, legal_name: row.legal_name, trade_name: row.trade_name }))))
      .catch(() => setCompanies([]))
  }, [])

  function openPreview(row: DocumentRow) {
    setBusy(true); setError(null)
    downloadUrl(row.id)
      .then(signed => setPreview({ row, url: signed.url, hash: signed.content_hash, mime: signed.mime_type }))
      .catch(reason => setError(reason instanceof Error ? reason.message : 'Ouverture impossible.'))
      .finally(() => setBusy(false))
  }

  // Lien profond ?doc=… : ouvre l'aperçu du document demandé.
  useEffect(() => {
    const documentId = new URLSearchParams(window.location.search).get('doc')
    if (!documentId || !supabase) return
    let active = true
    void (async () => {
      try {
        const { data } = await supabase.from('documents')
          .select('id,document_type,storage_path,content_hash,metadata,family_key,document_version,supersedes_id,issued_at,created_at,deleted_at,deleted_by,deleted_reason,created_by')
          .eq('id', documentId).maybeSingle()
        if (active && data) openPreview(data as DocumentRow)
      } catch { /* lien profond silencieux */ }
    })()
    return () => { active = false }
  }, [])

  async function submitUpload(event: React.FormEvent) {
    event.preventDefault()
    if (!uploadFile) return
    setBusy(true); setError(null)
    try {
      const result = await uploadDocument(uploadFile, {
        title: uploadTitle, companyId: uploadCompanyId === '' ? null : uploadCompanyId,
        supersedesId: uploadSupersedes === '' ? null : uploadSupersedes,
      })
      setNotice(`Document enregistré (version ${result.document_version}, ${result.verify_mode === 'server_sha256' ? 'empreinte vérifiée par le serveur' : 'empreinte déclarée par le navigateur'}).`)
      setUploadOpen(false); setUploadFile(null); setUploadTitle(''); setUploadSupersedes('')
      if (fileInputRef.current) fileInputRef.current.value = ''
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Dépôt impossible.')
    } finally {
      setBusy(false)
    }
  }

  async function submitDelete(event: React.FormEvent) {
    event.preventDefault()
    if (!deleteTarget) return
    setBusy(true); setError(null)
    try {
      await deleteDocument(deleteTarget.id, deleteReason)
      setNotice('Document mis à la corbeille.')
      setDeleteTarget(null); setDeleteReason('')
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Suppression impossible.')
    } finally {
      setBusy(false)
    }
  }

  async function restore(row: DocumentRow) {
    setBusy(true); setError(null)
    try {
      await restoreDocument(row.id)
      setNotice('Document restauré.')
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Restauration impossible.')
    } finally {
      setBusy(false)
    }
  }

  async function reconcile() {
    setBusy(true); setError(null)
    try {
      const result = await runReconcile()
      setNotice(`Réconciliation : ${result.objects_scanned} objet(s) analysé(s), ${result.missing} manquant(s), ${result.orphans} orphelin(s), ${result.size_mismatches} incohérence(s), ${result.stale_staged} dépôt(s) périmé(s).`)
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Réconciliation impossible.')
    } finally {
      setBusy(false)
    }
  }

  const activeRows = rows.filter(row => filters.deleted || row.deleted_at === null)

  return <div className="crm-page">
    <div className="crm-page-head"><div><span className="section-kicker">DOCUMENTS</span><h1>Bibliothèque</h1><p>Dépôts vérifiés par empreinte SHA-256, versions, corbeille et rattachement aux sociétés.</p></div>
      <div className="crm-head-actions">
        {isAdmin && canDelete && <Button variant="secondary" onClick={() => void reconcile()} disabled={busy}><RefreshCw size={15} /> Réconcilier le stock</Button>}
        {canUpload && <Button onClick={() => setUploadOpen(true)}><Upload size={16} /> Déposer un document</Button>}
      </div>
    </div>
    <div className="crm-toolbar">
      <div className="crm-search"><Search size={17} /><input aria-label="Rechercher un document" placeholder="Titre ou nom de fichier." value={filters.search ?? ''} onChange={event => setFilters(old => ({ ...old, search: event.target.value }))} /></div>
      <select aria-label="Filtrer par société rattachée" value={filters.companyId ?? ''} onChange={event => setFilters(old => ({ ...old, companyId: event.target.value }))}>
        <option value="">Toutes les sociétés</option>
        {companies.map(company => <option key={company.id} value={company.id}>{company.trade_name ?? company.legal_name}</option>)}
      </select>
      {canDelete && <select aria-label="Afficher la corbeille" value={filters.deleted ? 'corbeille' : 'actifs'} onChange={event => setFilters(old => ({ ...old, deleted: event.target.value === 'corbeille' }))}>
        <option value="actifs">Documents actifs</option>
        <option value="corbeille">Corbeille</option>
      </select>}
    </div>
    {familyView && <div className="crm-alert crm-alert-info" role="status">Famille de versions : <strong>{familyView.title}</strong>
      <button className="crm-link" onClick={() => setFamilyView(null)}>Revenir à la vue complète</button>
    </div>}
    {notice && <div className="crm-alert crm-alert-info" role="status">{notice}</div>}
    {error && <div className="crm-alert" role="alert">{error}</div>}
    {loading ? <div className="crm-empty">Chargement de la bibliothèque.</div> : <div className="crm-table-wrap">
      <table className="crm-table">
        <thead><tr><th>Document</th><th>Rattachement</th><th>Déposé le</th><th>Version</th><th>Statut</th><th /></tr></thead>
        <tbody>{activeRows.map(row => {
          const companyLink = (row.document_links ?? []).find(link => link.entity_table === 'companies')
          const company = companyLink ? companies.find(item => item.id === companyLink.entity_id) : null
          const isImage = typeof row.metadata?.mime_type === 'string' && imageMimeTypes.includes(row.metadata.mime_type as string)
          const isPdf = row.metadata?.mime_type === 'application/pdf'
          return <tr key={row.id} className={row.deleted_at ? 'crm-row-muted' : ''}>
            <td><span className="crm-company"><span className="company-avatar"><FileText size={15} /></span>
              <span><strong>{displayTitle(row)}</strong><small>{formatBytes(Number(row.metadata?.size_bytes ?? 0))}</small></span></span></td>
            <td>{company ? (company.trade_name ?? company.legal_name) : '-'}</td>
            <td>{formatDate(row.created_at)}</td>
            <td>{row.document_version ?? '-'}</td>
            <td>{row.deleted_at ? `Corbeille — ${row.deleted_reason ?? 'sans motif'}` : row.metadata?.verify_mode === 'server_sha256' ? 'Vérifié' : 'Empreinte déclarée'}</td>
            <td className="crm-row-actions">
              {!row.deleted_at && (isImage || isPdf) && <button aria-label={`Aperçu de ${displayTitle(row)}`} onClick={() => openPreview(row)}><Eye size={16} /></button>}
              {!row.deleted_at && <a href="#" aria-label={`Télécharger ${displayTitle(row)}`} onClick={event => { event.preventDefault(); openPreview(row) }}><FolderOpen size={16} /></a>}
              {row.family_key && <button aria-label={`Versions de ${displayTitle(row)}`} onClick={() => setFamilyView({ familyKey: row.family_key!, title: displayTitle(row) })}><History size={16} /></button>}
              {canDelete && row.deleted_at && <button aria-label={`Restaurer ${displayTitle(row)}`} onClick={() => void restore(row)} disabled={busy}><Undo2 size={16} /></button>}
              {canDelete && !row.deleted_at && <button aria-label={`Mettre à la corbeille ${displayTitle(row)}`} onClick={() => { setDeleteTarget(row); setDeleteReason('') }}><Trash2 size={16} /></button>}
            </td>
          </tr>
        })}
        </tbody>
      </table>
      {activeRows.length === 0 && <div className="crm-empty"><FolderOpen size={22} /> {filters.deleted ? 'La corbeille est vide.' : 'Aucun document ne correspond à ces filtres.'}</div>}
    </div>}

    {uploadOpen && <div className="crm-modal-backdrop" role="presentation" onClick={() => setUploadOpen(false)}>
      <form className="crm-modal" role="dialog" aria-modal="true" aria-label="Déposer un document" onClick={event => event.stopPropagation()} onSubmit={event => void submitUpload(event)}>
        <h2>Déposer un document</h2>
        <p>Le fichier est envoyé directement vers le stock de l'entreprise ; son empreinte SHA-256 est calculée dans votre navigateur puis vérifiée par le serveur.</p>
        <label className="crm-field">Fichier *<input ref={fileInputRef} type="file" required onChange={event => setUploadFile(event.target.files?.[0] ?? null)} /></label>
        {uploadFile && <p className="crm-hint">{uploadFile.name} — {formatBytes(uploadFile.size)}</p>}
        <label className="crm-field">Titre<input value={uploadTitle} onChange={event => setUploadTitle(event.target.value)} placeholder="Contrat cadre 2026…" /></label>
        <label className="crm-field">Rattacher à une société<select value={uploadCompanyId} onChange={event => setUploadCompanyId(event.target.value)}>
          <option value="">Aucun rattachement</option>
          {companies.map(company => <option key={company.id} value={company.id}>{company.trade_name ?? company.legal_name}</option>)}
        </select></label>
        <label className="crm-field">Nouvelle version de<select value={uploadSupersedes} onChange={event => setUploadSupersedes(event.target.value)}>
          <option value="">Document indépendant</option>
          {rows.filter(row => row.deleted_at === null).map(row => <option key={row.id} value={row.id}>{displayTitle(row)} (v{row.document_version ?? 1})</option>)}
        </select></label>
        {error && <div className="crm-alert" role="alert">{error}</div>}
        <div className="crm-form-actions">
          <Button type="button" variant="secondary" onClick={() => setUploadOpen(false)}>Annuler</Button>
          <Button type="submit" disabled={busy || !uploadFile}>{busy ? 'Dépôt en cours…' : 'Téléverser'}</Button>
        </div>
      </form>
    </div>}

    {deleteTarget && <div className="crm-modal-backdrop" role="presentation" onClick={() => setDeleteTarget(null)}>
      <form className="crm-modal" role="dialog" aria-modal="true" aria-label="Mettre à la corbeille" onClick={event => event.stopPropagation()} onSubmit={event => void submitDelete(event)}>
        <h2>Mettre à la corbeille</h2>
        <p>Le document reste restaurable. Motif exigé et journalisé.</p>
        <label className="crm-field">Motif *<input required maxLength={500} value={deleteReason} onChange={event => setDeleteReason(event.target.value)} /></label>
        <div className="crm-form-actions">
          <Button type="button" variant="secondary" onClick={() => setDeleteTarget(null)}>Annuler</Button>
          <Button type="submit" disabled={busy || deleteReason.trim() === ''}>Mettre à la corbeille</Button>
        </div>
      </form>
    </div>}

    {preview && <div className="crm-modal-backdrop" role="presentation" onClick={() => setPreview(null)}>
      <div className="crm-modal crm-modal-wide" role="dialog" aria-modal="true" aria-label="Aperçu du document" onClick={event => event.stopPropagation()}>
        <h2>{displayTitle(preview.row)}</h2>
        <p className="crm-hint">
          Version {preview.row.document_version ?? '-'} · Empreinte {preview.hash ?? 'indisponible'} · Déposé le {formatDate(preview.row.created_at)}
        </p>
        {preview.mime === 'application/pdf' && <iframe src={preview.url} title={`Aperçu de ${displayTitle(preview.row)}`} />}
        {preview.mime && imageMimeTypes.includes(preview.mime) && <img src={preview.url} alt={displayTitle(preview.row)} />}
        {(!preview.mime || (!imageMimeTypes.includes(preview.mime) && preview.mime !== 'application/pdf')) && <p>Aperçu non disponible pour ce type de fichier.</p>}
        <div className="crm-form-actions">
          <Button type="button" variant="secondary" onClick={() => setPreview(null)}>Fermer</Button>
          <Button asChild><a href={preview.url} target="_blank" rel="noreferrer">Ouvrir le fichier</a></Button>
        </div>
      </div>
    </div>}

    <p className="crm-hint crm-page-foot">
      Besoin d'un rattachement supplémentaire ? <Link to="/societes">Ouvrir le référentiel des sociétés</Link>.
    </p>
  </div>
}
