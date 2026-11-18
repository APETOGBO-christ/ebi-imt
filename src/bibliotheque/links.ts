import { supabase } from '../lib/supabase'
import { uploadDocument } from './api'

export interface EntityDocumentRow {
  link_id: string; document_id: string; link_role: string; created_at: string;
  title: string | null; storage_path: string; content_hash: string | null; issued_at: string
}

function db() { if (!supabase) throw new Error('Connexion Supabase non configurée.'); return supabase }

export async function listEntityDocuments(entityTable: string, entityId: string): Promise<EntityDocumentRow[]> {
  const { data, error } = await db().from('document_links')
    .select('id,link_role,created_at,document_id,documents(id,storage_path,content_hash,issued_at,metadata,deleted_at)')
    .eq('entity_table', entityTable).eq('entity_id', entityId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? [])
    .filter(row => {
      const document = Array.isArray(row.documents) ? row.documents[0] : row.documents
      return document && !document.deleted_at
    })
    .map(row => {
      const document = (Array.isArray(row.documents) ? row.documents[0] : row.documents) as {
        id: string; storage_path: string; content_hash: string | null; issued_at: string;
        metadata: Record<string, unknown> | null
      }
      return {
        link_id: row.id, document_id: row.document_id, link_role: row.link_role, created_at: row.created_at,
        title: (document.metadata?.title as string | undefined) ?? null,
        storage_path: document.storage_path, content_hash: document.content_hash, issued_at: document.issued_at,
      }
    })
}

export async function attachEntityDocument(input: {
  entityTable: string; entityId: string; file: File; title: string; companyId: string | null
}): Promise<void> {
  const uploaded = await uploadDocument(input.file, {
    title: input.title.trim() || input.file.name, companyId: input.companyId, supersedesId: null,
  })
  const { error } = await db().rpc('document_link_entity', {
    p_document_id: uploaded.document_id, p_entity_table: input.entityTable,
    p_entity_id: input.entityId, p_link_role: 'attachment',
  })
  if (error) throw new Error(error.message)
}

export async function unlinkEntityDocument(linkId: string): Promise<void> {
  const { error } = await db().rpc('document_unlink_entity', { p_link_id: linkId })
  if (error) throw new Error(error.message)
}

export async function entityDocumentUrl(documentId: string): Promise<string> {
  const { data, error } = await db().functions.invoke<{ url: string }>('document-download-url', { body: { document_id: documentId } })
  if (error || !data?.url) throw new Error('Lien de téléchargement indisponible.')
  return data.url
}
