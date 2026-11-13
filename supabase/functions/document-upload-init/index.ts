// Étape 1 du dépôt : staging PostgreSQL + URL pré-signée PUT R2.
// Le fichier lui-même ne transite jamais par la fonction ; le navigateur
// calcule le SHA-256 puis pousse vers l'URL pré-signée (expiration courte).
import { corsHeaders, jsonResponse, makeClients, bearerToken, requireUser, userClient, r2Config } from '../_shared/edge.ts'
import { libraryPath, presignPut, type R2Config } from '../_shared/r2client.ts'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.3'

const MIME_RE = /^[\w.+-]+\/[\w.+-]+$/
const SHA_RE = /^[a-f0-9]{64}$/

interface Payload {
  file_name?: string
  content_type?: string
  size_bytes?: number
  sha256?: string
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
    const fileName = body.file_name?.trim()
    const contentType = body.content_type?.trim()
    const sha256 = body.sha256?.trim().toLowerCase()
    const sizeBytes = body.size_bytes
    if (!fileName || fileName.length > 200) return jsonResponse(400, { error: 'Nom de fichier requis (200 caractères maximum).' })
    if (!contentType || !MIME_RE.test(contentType)) return jsonResponse(400, { error: 'Type de fichier invalide.' })
    if (!Number.isInteger(sizeBytes) || (sizeBytes as number) < 1 || (sizeBytes as number) > 1_099_511_627_776) {
      return jsonResponse(400, { error: 'Taille de fichier invalide.' })
    }
    if (!sha256 || !SHA_RE.test(sha256)) return jsonResponse(400, { error: 'Empreinte SHA-256 requise (64 caractères hexadécimaux).' })

    // Permission bibliothèque (insertion) dans le contexte de l'utilisateur.
    const { data: allowed, error: permitError } = await userClient(url, anonKey, token)
      .rpc('user_permits', { p_module: 'bibliotheque', p_action: 'insert' })
    if (permitError) return jsonResponse(503, { error: 'Contrôle de permission indisponible.' })
    if (allowed !== true) return jsonResponse(403, { error: 'Permission de dépôt requise (bibliothèque).' })

    const uploadId = crypto.randomUUID()
    const storagePath = libraryPath(uploadId, fileName)
    const presigned = await presignPut(config, storagePath, contentType)
    const { error: insertError } = await admin.from('document_uploads').insert({
      bucket_id: 'r2-library', storage_path: storagePath, sha256,
      mime_type: contentType, size_bytes: sizeBytes, uploaded_by: identity.id,
      status: 'staged',
    })
    if (insertError) return jsonResponse(503, { error: 'Staging impossible.' })
    return jsonResponse(200, {
      upload_id: uploadId, storage_path: storagePath,
      upload_url: presigned.url, expires_at: presigned.expiresAt,
    })
  } catch (error) {
    return jsonResponse(409, { error: error instanceof Error ? error.message : 'Dépôt impossible.' })
  }
})
