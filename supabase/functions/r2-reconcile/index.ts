// Réconciliation stock R2 ↔ PostgreSQL : orphelins (objet sans ligne),
// manquants (ligne sans objet), incohérences de taille, dépôts périmés.
// Réservé aux administrateurs avec second facteur (aal2 + admin_caller_gate).
import { corsHeaders, jsonResponse, makeClients, bearerToken, requireUser, userClient, decodeJwtPayload, r2Config } from '../_shared/edge.ts'
import { listObjects, headObject, type R2Config } from '../_shared/r2client.ts'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.3'

interface DocumentRow { id: string; storage_path: string; deleted_at: string | null; metadata: Record<string, unknown> | null }
interface UploadRow { id: string; storage_path: string; status: string; size_bytes: number | null; uploaded_at: string }

const MAX_HEADS = 50
const STALE_STAGING_MS = 24 * 60 * 60 * 1000

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
    const payload = decodeJwtPayload(token)
    if (payload?.aal !== 'aal2') return jsonResponse(403, { error: 'Second facteur (MFA) requis pour la réconciliation.' })
    const { data: gate, error: gateError } = await userClient(url, anonKey, token).rpc('admin_caller_gate')
    if (gateError || gate !== true) return jsonResponse(403, { error: 'Administrateur habilité avec second facteur requis.' })

    const inventory = await listObjects(config, 'library/')
    const objectKeys = new Set(inventory.keys)
    const now = Date.now()

    const { data: documents, error: docsError } = await admin.from('documents')
      .select('id, storage_path, deleted_at, metadata').eq('document_type', 'library_document')
    if (docsError) return jsonResponse(503, { error: "Consultation de la bibliothèque impossible." })
    const { data: uploads, error: uploadsError } = await admin.from('document_uploads')
      .select('id, storage_path, status, size_bytes, uploaded_at').eq('bucket_id', 'r2-library')
    if (uploadsError) return jsonResponse(503, { error: 'Consultation des dépôts impossible.' })
    const docRows = (documents ?? []) as DocumentRow[]
    const uploadRows = (uploads ?? []) as UploadRow[]

    const rows: { bucket_id: string; storage_path: string; status: string; notes?: string }[] = []
    const docPaths = new Set(docRows.map(row => row.storage_path))
    const stagedPaths = new Set(uploadRows.filter(row => row.status === 'staged').map(row => row.storage_path))

    // Manquants : enregistrés et actifs, mais absents du stock.
    for (const doc of docRows) {
      if (doc.deleted_at === null && !objectKeys.has(doc.storage_path)) {
        rows.push({ bucket_id: config.bucket, storage_path: doc.storage_path, status: 'missing', notes: 'document actif sans objet R2' })
      }
    }
    // Orphelins : objets sans document et sans dépôt en cours.
    for (const key of objectKeys) {
      if (!docPaths.has(key) && !stagedPaths.has(key)) {
        rows.push({ bucket_id: config.bucket, storage_path: key, status: 'orphan', notes: 'objet R2 sans enregistrement' })
      }
    }
    // Incohérences de taille (échantillon plafonné pour rester léger).
    let heads = 0
    for (const doc of docRows) {
      if (heads >= MAX_HEADS) break
      const declared = typeof doc.metadata?.size_bytes === 'number' ? doc.metadata.size_bytes : null
      if (doc.deleted_at !== null || declared === null || !objectKeys.has(doc.storage_path)) continue
      heads += 1
      const head = await headObject(config, doc.storage_path)
      if (head.exists && head.size !== null && head.size !== declared) {
        rows.push({ bucket_id: config.bucket, storage_path: doc.storage_path, status: 'hash_mismatch', notes: `taille attendue ${declared}, trouvée ${head.size}` })
      }
    }
    // Dépôts en staging périmés sans objet (upload jamais achevé).
    let staleStaged = 0
    for (const upload of uploadRows) {
      if (upload.status !== 'staged') continue
      const age = now - new Date(upload.uploaded_at).getTime()
      if (age < STALE_STAGING_MS) continue
      const head = await headObject(config, upload.storage_path)
      if (!head.exists) {
        await admin.from('document_uploads').update({ status: 'orphan' }).eq('id', upload.id)
        staleStaged += 1
      }
    }

    if (rows.length > 0) {
      const { error: upsertError } = await admin.from('document_reconciliation').upsert(rows, { onConflict: 'storage_path' })
      if (upsertError) return jsonResponse(503, { error: 'Enregistrement du rapport impossible.' })
    }
    return jsonResponse(200, {
      objects_scanned: objectKeys.size, truncated: inventory.truncated,
      missing: rows.filter(row => row.status === 'missing').length,
      orphans: rows.filter(row => row.status === 'orphan').length,
      size_mismatches: rows.filter(row => row.status === 'hash_mismatch').length,
      stale_staged: staleStaged,
    })
  } catch (error) {
    return jsonResponse(409, { error: error instanceof Error ? error.message : 'Réconciliation impossible.' })
  }
})
