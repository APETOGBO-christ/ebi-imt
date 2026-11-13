// Étape 2 du dépôt : vérification de l'objet R2 puis enregistrement définitif.
// L'Edge relit l'objet (HEAD + SHA-256 si la taille le permet), crée la ligne
// documents, pose les liens (société / contact) et journalise le dépôt.
import { corsHeaders, jsonResponse, makeClients, bearerToken, requireUser, userClient, r2Config, isUuid } from '../_shared/edge.ts'
import { headObject, getObjectSha256, type R2Config } from '../_shared/r2client.ts'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.3'

interface Payload {
  upload_id?: string
  title?: string
  company_id?: string
  contact_id?: string
  supersedes_id?: string
}

interface StagingRow {
  id: string
  bucket_id: string
  storage_path: string
  sha256: string | null
  mime_type: string | null
  size_bytes: number | null
  uploaded_by: string
  status: string
}

interface DocumentRow {
  id: string
  family_key: string | null
  document_version: number | null
  deleted_at: string | null
}

async function markOrphan(admin: SupabaseClient, uploadId: string): Promise<void> {
  await admin.from('document_uploads').update({ status: 'orphan' }).eq('id', uploadId)
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
    if (!isUuid(body.upload_id)) return jsonResponse(400, { error: 'Identifiant de dépôt requis.' })
    if (body.company_id !== undefined && body.company_id !== null && !isUuid(body.company_id)) return jsonResponse(400, { error: 'Société invalide.' })
    if (body.contact_id !== undefined && body.contact_id !== null && !isUuid(body.contact_id)) return jsonResponse(400, { error: 'Contact invalide.' })
    if (body.supersedes_id !== undefined && body.supersedes_id !== null && !isUuid(body.supersedes_id)) return jsonResponse(400, { error: 'Version précédente invalide.' })

    const { data: allowed, error: permitError } = await userClient(url, anonKey, token)
      .rpc('user_permits', { p_module: 'bibliotheque', p_action: 'insert' })
    if (permitError) return jsonResponse(503, { error: 'Contrôle de permission indisponible.' })
    if (allowed !== true) return jsonResponse(403, { error: 'Permission de dépôt requise (bibliothèque).' })

    const { data: staging, error: stagingError } = await admin.from('document_uploads')
      .select('id, bucket_id, storage_path, sha256, mime_type, size_bytes, uploaded_by, status')
      .eq('id', body.upload_id!).maybeSingle<StagingRow>()
    if (stagingError) return jsonResponse(503, { error: 'Consultation du dépôt impossible.' })
    if (!staging || staging.uploaded_by !== identity.id) return jsonResponse(404, { error: 'Dépôt introuvable.' })
    if (staging.status !== 'staged') return jsonResponse(409, { error: 'Ce dépôt a déjà été traité.' })
    if (staging.sha256 === null || staging.size_bytes === null) return jsonResponse(409, { error: 'Dépôt incomplet.' })

    // Vérification stock : l'objet doit exister et correspondre à la taille déclarée.
    const head = await headObject(config, staging.storage_path)
    if (!head.exists) return jsonResponse(409, { error: "Fichier introuvable dans le stock de l'entreprise." })
    if (head.size !== staging.size_bytes) {
      await markOrphan(admin, staging.id)
      return jsonResponse(409, { error: "La taille du fichier téléversé diffère de la déclaration." })
    }

    // Intégrité SHA-256 côté serveur (dans la limite de vérification configurée).
    let verifiedHash: string | null = null
    const serverHash = await getObjectSha256(config, staging.storage_path, config.verifyMaxBytes)
    if (serverHash !== null) {
      if (serverHash !== staging.sha256) {
        await markOrphan(admin, staging.id)
        return jsonResponse(409, { error: "L'empreinte du fichier ne correspond pas à la déclaration." })
      }
      verifiedHash = serverHash
    }

    // Versionnement : une nouvelle version remplace un document de bibliothèque.
    let familyKey: string
    let version: number
    let supersedesId: string | null = null
    if (body.supersedes_id) {
      const { data: parent } = await admin.from('documents')
        .select('id, family_key, document_version, deleted_at, metadata')
        .eq('id', body.supersedes_id).maybeSingle<DocumentRow & { metadata: Record<string, unknown> }>()
      if (!parent || parent.deleted_at !== null) return jsonResponse(409, { error: 'Version précédente introuvable ou supprimée.' })
      if (typeof parent.metadata?.family_key !== 'string') {
        return jsonResponse(409, { error: 'Seuls les documents de bibliothèque acceptent des versions.' })
      }
      supersedesId = parent.id
      familyKey = parent.family_key ?? parent.id
      const { data: latest } = await admin.from('documents')
        .select('document_version')
        .eq('family_key', familyKey)
        .order('document_version', { ascending: false })
        .limit(1).maybeSingle<{ document_version: number | null }>()
      version = (latest?.document_version ?? 0) + 1
    } else {
      familyKey = `lib-${crypto.randomUUID()}`
      version = 1
    }

    const { data: inserted, error: insertError } = await admin.from('documents').insert({
      document_type: 'library_document',
      storage_path: staging.storage_path,
      content_hash: verifiedHash ?? staging.sha256,
      metadata: {
        title: body.title?.trim() || null,
        mime_type: staging.mime_type,
        size_bytes: staging.size_bytes,
        company_id: body.company_id ?? null,
        contact_id: body.contact_id ?? null,
        verify_mode: verifiedHash ? 'server_sha256' : 'declared_sha256',
        family_key: familyKey,
      },
      created_by: identity.id,
      family_key: familyKey,
      document_version: version,
      supersedes_id: supersedesId,
    }).select('id').single<{ id: string }>()
    if (insertError || !inserted) return jsonResponse(503, { error: 'Enregistrement définitif impossible.' })

    const links: { document_id: string; entity_table: string; entity_id: string; link_role: string; created_by: string }[] = []
    if (body.company_id) links.push({ document_id: inserted.id, entity_table: 'companies', entity_id: body.company_id, link_role: 'attachment', created_by: identity.id })
    if (body.contact_id) links.push({ document_id: inserted.id, entity_table: 'contacts', entity_id: body.contact_id, link_role: 'attachment', created_by: identity.id })
    if (links.length > 0) await admin.from('document_links').insert(links)

    await admin.from('document_access_logs').insert({
      document_id: inserted.id, actor_id: identity.id, action: 'upload',
      metadata: { storage_path: staging.storage_path, verify_mode: verifiedHash ? 'server_sha256' : 'declared_sha256' },
    })
    await admin.from('document_uploads').update({ status: 'attached', document_id: inserted.id }).eq('id', staging.id)
    return jsonResponse(200, {
      document_id: inserted.id, family_key: familyKey, document_version: version,
      verify_mode: verifiedHash ? 'server_sha256' : 'declared_sha256',
    })
  } catch (error) {
    return jsonResponse(409, { error: error instanceof Error ? error.message : 'Confirmation impossible.' })
  }
})
