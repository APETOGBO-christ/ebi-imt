import { useEffect, useState } from 'react'
import { Download, FileText, Paperclip, Trash2, Upload } from 'lucide-react'
import { Button } from './ui/button'
import { usePermits } from '../lib/permissions'
import { attachEntityDocument, entityDocumentUrl, listEntityDocuments, unlinkEntityDocument, type EntityDocumentRow } from '../bibliotheque/links'

export function EntityDocuments({ entityTable, entityId, companyId, title = 'Documents' }: {
  entityTable: string; entityId: string; companyId: string | null; title?: string
}) {
  const { can } = usePermits()
  const canAttach = can('bibliotheque', 'insert')
  const [rows, setRows] = useState<EntityDocumentRow[]>([])
  const [documentTitle, setDocumentTitle] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    let active = true
    void listEntityDocuments(entityTable, entityId)
      .then(result => { if (active) setRows(result) })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Documents indisponibles.') })
    return () => { active = false }
  }, [entityTable, entityId, refresh])

  async function run(action: () => Promise<unknown>) {
    setBusy(true); setError(null)
    try { await action(); setRefresh(value => value + 1) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Action refusée.') }
    finally { setBusy(false) }
  }

  return <section className="crm-section">
    <h2><Paperclip size={17} /> {title}</h2>
    {error && <div className="crm-alert" role="alert">{error}</div>}
    {rows.length === 0 ? <div className="notif-empty">Aucun document rattaché.</div> :
      <ul className="dash-list">{rows.map(row => <li key={row.link_id}>
        <div><strong><FileText size={14} /> {row.title || row.storage_path}</strong><small>Rôle : {row.link_role} · {new Date(row.issued_at).toLocaleDateString('fr-TG')}</small></div>
        <span className="ach-verify">
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void run(async () => { const url = await entityDocumentUrl(row.document_id); window.open(url, '_blank', 'noopener') })}><Download size={14} /> Ouvrir</Button>
          {canAttach && <Button size="sm" variant="ghost" disabled={busy} aria-label="Détacher le document" onClick={() => void run(() => unlinkEntityDocument(row.link_id))}><Trash2 size={14} /></Button>}
        </span>
      </li>)}</ul>}
    {canAttach && <form key={refresh} className="ach-inline-form" onSubmit={event => {
      event.preventDefault()
      if (!file) return
      void run(async () => { await attachEntityDocument({ entityTable, entityId, file, title: documentTitle, companyId }); setFile(null); setDocumentTitle('') })
    }}>
      <input aria-label="Intitulé du document" placeholder="Intitulé du document" value={documentTitle} onChange={event => setDocumentTitle(event.target.value)} />
      <input aria-label="Fichier à déposer" type="file" onChange={event => setFile(event.target.files?.[0] ?? null)} />
      <Button type="submit" disabled={busy || !file}><Upload size={15} /> {busy ? 'Dépôt…' : 'Déposer et rattacher'}</Button>
    </form>}
    <p className="commercial-note">Les documents passent par la bibliothèque (empreinte SHA-256, versionnement et journal d’accès).</p>
  </section>
}
