// Émission d'une URL pré-signée GET après contrôle dans le contexte
// utilisateur, avec journalisation de l'accès (architecture v2 § 5).
import { corsHeaders, jsonResponse, makeClients, bearerToken, requireUser, userClient, r2Config } from '../_shared/edge.ts'
import { presignGet, type R2Config } from '../_shared/r2client.ts'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.3'

interface Payload { document_id?: string }

interface DocumentRow {
  id: string
  storage_path: string
  deleted_at: string | null
  content_hash: string | null
  metadata: Record<string, unknown> | null
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse(405, { error: 'Méthode non autorisée.' })
  const token = bearerToken(request)
  if (!token) return jsonResponse(401, { error: 'Session requise.' })
  let admin: SupabaseClient
  let url: string
  let anonKey: string
  let config: R2Config
  try { ({ admin, url, anonKey } = makeClients()); config = r2Config() } catch (error) {
    return jsonResponse(503, { error: error instanceof Error ? error.message : 'Configuration serveur incomplète.' })
  }
  try {
    const identity = await requireUser(url, anonKey, token)
    if (identity instanceof Response) return identity

    const body = await request.json() as Payload
    const documentId = body.document_id?.trim()
    if (!documentId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(documentId)) {
      return jsonResponse(400, { error: 'Identifiant de document requis.' })
    }

    // Contrôle dans le contexte de l'utilisateur (RLS + matrice bibliothèque).
    const { data: allowed, error: gateError } = await userClient(url, anonKey, token)
      .rpc('document_download_allowed', { p_document_id: documentId })
    if (gateError) return jsonResponse(503, { error: 'Contrôle de permission indisponible.' })
    if (allowed !== true) return jsonResponse(403, { error: 'Consultation de ce document non autorisée.' })

    const { data: document, error: docError } = await admin.from('documents')
      .select('id, storage_path, deleted_at, content_hash, metadata')
      .eq('id', documentId).maybeSingle<DocumentRow>()
    if (docError) return jsonResponse(503, { error: 'Consultation du document impossible.' })
    if (!document) return jsonResponse(404, { error: 'Document introuvable.' })
    if (document.deleted_at !== null) return jsonResponse(409, { error: 'Ce document est dans la corbeille.' })

    const mimeType = typeof document.metadata?.mime_type === 'string' ? document.metadata.mime_type : undefined
    const presigned = await presignGet(config, document.storage_path, 600, mimeType)
    await admin.from('document_access_logs').insert({
      document_id: document.id, actor_id: identity.id, action: 'download',
      metadata: { via: 'edge', mime_type: mimeType ?? null },
    })
    return jsonResponse(200, {
      url: presigned.url, expires_at: presigned.expiresAt,
      content_hash: document.content_hash, mime_type: mimeType ?? null,
    })
  } catch (error) {
    return jsonResponse(409, { error: error instanceof Error ? error.message : 'Téléchargement impossible.' })
  }
})
