import { supabase } from '../lib/supabase'
import type { ConfirmUploadResult, DocumentRow, InitUploadResult, ReconcileResult } from './types'

export interface DocumentFilters { search?: string; companyId?: string; familyKey?: string; deleted?: boolean }

async function extractMessage(error: unknown, fallback: string): Promise<string> {
  const name = (error as { name?: string } | null)?.name
  if (name === 'FunctionsFetchError') {
    const cause = (error as { context?: unknown }).context
    const detail = cause instanceof Error && cause.message ? cause.message : 'raison inconnue'
    return `${fallback} (réseau : ${detail})`
  }
  if (error && typeof error === 'object' && 'context' in error) {
    const context = (error as { context: Response }).context
    try {
      const body = await context.json() as { error?: string }
      if (body?.error) return body.error
    } catch { /* corps non JSON : on garde le message générique */ }
  }
  if (error instanceof Error && error.message) return error.message
  return fallback
}

export async function listDocuments(filters: DocumentFilters): Promise<DocumentRow[]> {
  if (!supabase) throw new Error('Connexion Supabase non configurée.')
  let query = supabase.from('documents')
    .select('id,document_type,storage_path,content_hash,metadata,family_key,document_version,supersedes_id,issued_at,created_at,deleted_at,deleted_by,deleted_reason,created_by,document_links(entity_table,entity_id)')
    .eq('document_type', 'library_document')
    .order('created_at', { ascending: false })
    .limit(200)
  if (filters.deleted !== undefined) {
    query = filters.deleted ? query.not('deleted_at', 'is', null) : query.is('deleted_at', null)
  }
  if (filters.familyKey) query = query.eq('family_key', filters.familyKey)
  if (filters.companyId) {
    query = query.eq('document_links.entity_table', 'companies').eq('document_links.entity_id', filters.companyId)
  }
  const search = filters.search?.replace(/[,%()]/g, ' ').trim()
  if (search) query = query.or(`storage_path.ilike.%${search}%,metadata->>title.ilike.%${search}%`)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []) as DocumentRow[]
}

export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  if (!crypto?.subtle) throw new Error('Votre navigateur ne prend pas en charge le calcul SHA-256.')
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/** Flux complet : empreinte locale, staging, PUT R2, confirmation vérifiée. */
export async function uploadDocument(file: File, meta: {
  title: string; companyId: string | null; supersedesId: string | null
}): Promise<ConfirmUploadResult> {
  if (!supabase) throw new Error('Connexion Supabase non configurée.')
  const buffer = await file.arrayBuffer()
  const sha256 = await sha256Hex(buffer)
  const { data: init, error: initError } = await supabase.functions.invoke<InitUploadResult>('document-upload-init', {
    body: {
      file_name: file.name,
      content_type: file.type || 'application/octet-stream',
      size_bytes: file.size,
      sha256,
    },
  })
  if (initError) throw new Error(await extractMessage(initError, 'Ouverture du dépôt impossible.'))
  if (!init) throw new Error('Ouverture du dépôt impossible.')
  const putResponse = await fetch(init.upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: buffer,
  })
  if (!putResponse.ok) throw new Error(`Téléversement refusé par le stock (${putResponse.status}).`)
  const { data: confirmed, error: confirmError } = await supabase.functions.invoke<ConfirmUploadResult>('document-upload-confirm', {
    body: {
      upload_id: init.upload_id,
      title: meta.title || null,
      company_id: meta.companyId,
      supersedes_id: meta.supersedesId,
    },
  })
  if (confirmError) throw new Error(await extractMessage(confirmError, 'Confirmation du dépôt impossible.'))
  if (!confirmed) throw new Error('Confirmation du dépôt impossible.')
  return confirmed
}

export interface SignedDownload { url: string; content_hash: string | null; mime_type: string | null; expires_at: string }

export async function downloadUrl(documentId: string): Promise<SignedDownload> {
  if (!supabase) throw new Error('Connexion Supabase non configurée.')
  const { data, error } = await supabase.functions.invoke<SignedDownload>('document-download-url', {
    body: { document_id: documentId },
  })
  if (error) throw new Error(await extractMessage(error, 'Ouverture du document impossible.'))
  if (!data) throw new Error('Ouverture du document impossible.')
  return data
}

export async function deleteDocument(documentId: string, reason: string): Promise<void> {
  if (!supabase) throw new Error('Connexion Supabase non configurée.')
  const { error } = await supabase.functions.invoke('document-delete', { body: { document_id: documentId, reason } })
  if (error) throw new Error(await extractMessage(error, 'Suppression impossible.'))
}

export async function restoreDocument(documentId: string): Promise<void> {
  if (!supabase) throw new Error('Connexion Supabase non configurée.')
  const { error } = await supabase.functions.invoke('document-restore', { body: { document_id: documentId } })
  if (error) throw new Error(await extractMessage(error, 'Restauration impossible.'))
}

export async function runReconcile(): Promise<ReconcileResult> {
  if (!supabase) throw new Error('Connexion Supabase non configurée.')
  const { data, error } = await supabase.functions.invoke<ReconcileResult>('r2-reconcile', { body: {} })
  if (error) throw new Error(await extractMessage(error, 'Réconciliation impossible.'))
  if (!data) throw new Error('Réconciliation impossible.')
  return data
}
